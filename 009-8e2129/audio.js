/**
 * audio.js — PachiAudio
 * ブラウザ版パチンコ台シミュレータ用・依存ゼロの Web Audio サウンドモジュール。
 * 全音を合成で作る（オシレータ／共有ノイズバッファ／エンベロープ）。外部アセット・fetch 無し。
 *
 *   PachiAudio.init()                 // ユーザー操作の中で呼ぶ（AudioContext 生成＋resume）。冪等。
 *   PachiAudio.play('nail', {v: 0.7}) // 単発音（fire-and-forget）
 *   PachiAudio.startBgm('normal')     // ループBGM。モード切替はクロスフェード
 *   PachiAudio.speak('リーチ')         // 日本語TTS（ja ボイスがある時のみ）
 *
 * init() 前・非ブラウザ環境でも安全（黙って何もしない・例外を投げない）。
 * window が無い環境では globalThis に PachiAudio を生やす。
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ 環境ガード
  var hasWindow = typeof window !== 'undefined';
  var host = hasWindow ? window : root;
  var AC = hasWindow ? (window.AudioContext || window.webkitAudioContext || null) : null;

  var EPS = 0.0001;                 // exponentialRamp は 0 を受け付けない
  var ctx = null;                   // AudioContext
  var master = null, comp = null, sfxBus = null, bgmBus = null;
  var noiseBuf = null;              // 共有ホワイトノイズ（1回だけ生成・全ノイズ音が使い回す）
  var enabled = true, volume = 0.8, speechOn = true;
  var inited = false;               // init() が一度でも呼ばれたか（TTS もこれをゲートにする）

  // ------------------------------------------------------------------ 小道具
  function noop() {}
  function num(v, d) { if (v == null) return d; v = +v; return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function nowMs() { return (hasWindow && window.performance && window.performance.now) ? window.performance.now() : Date.now(); }
  function T() { return ctx.currentTime; }
  function safeF(f) { return clamp(num(f, 440), 20, ctx.sampleRate / 2 - 100); }
  function ready() { return !!(ctx && ctx.state === 'running'); }

  // ------------------------------------------------------------------ グラフ構築
  // sfxBus ─┐
  //         ├→ compressor(soft) → master → destination
  // bgmBus ─┘
  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
    comp = null;
    try {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 3;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      comp.connect(master);
    } catch (e) { comp = null; }
    var sink = comp || master;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(sink);
    bgmBus = ctx.createGain(); bgmBus.gain.value = 1; bgmBus.connect(sink);

    var len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    try { ctx.onstatechange = onStateChange; } catch (e) {}
  }

  function onStateChange() {
    if (!ready()) return;
    if (bgm.pending) { var m = bgm.pending; bgm.pending = null; startBgm(m); }
  }

  function init() {
    try {
      inited = true;
      if (!AC) return false;
      if (ctx && ctx.state === 'closed') ctx = null;
      if (!ctx) {
        ctx = new AC();
        buildGraph();
        // iOS 向けアンロック: 無音バッファを1発鳴らす
        try {
          var s = ctx.createBufferSource();
          s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          s.connect(ctx.destination); s.start(0);
        } catch (e) {}
      }
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(onStateChange, noop);
      }
      return ctx.state === 'running';
    } catch (e) { return false; }
  }

  function applyMaster() {
    if (!master) return;
    try {
      var t = T();
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(enabled ? volume : 0, t, 0.02);
    } catch (e) {}
  }
  function setEnabled(on) { enabled = !!on; applyMaster(); if (!enabled) cancelSpeech(); }
  function setVolume(v) { volume = clamp(num(v, 0.8), 0, 1); applyMaster(); }

  // ------------------------------------------------------------------ 物理音の制限
  // nail/wall 合算で 30 発/秒までのトークンバケット＋同時発音ソース数の上限
  var PHYS_RATE = 30, PHYS_BURST = 6, PHYS_MAX = 24;
  var physTokens = PHYS_BURST, physLast = 0, physActive = 0;
  function physOk() {
    var t = nowMs();
    physTokens = Math.min(PHYS_BURST, physTokens + (t - physLast) * PHYS_RATE / 1000);
    physLast = t;
    if (physTokens < 1 || physActive >= PHYS_MAX) return false;
    physTokens -= 1;
    return true;
  }
  function physFree() { return physActive < PHYS_MAX; }
  function track(src, phys) {
    if (!phys) return;
    physActive++;
    src.onended = function () { physActive = Math.max(0, physActive - 1); };
  }

  // ------------------------------------------------------------------ 基本ボイス
  // attack(線形) → hold → release(指数) のエンベロープ
  function env(p, t0, peak, atk, hold, rel) {
    peak = Math.max(EPS, peak);
    p.setValueAtTime(EPS, t0);
    p.linearRampToValueAtTime(peak, t0 + atk);
    p.setValueAtTime(peak, t0 + atk + hold);
    p.exponentialRampToValueAtTime(EPS, t0 + atk + hold + rel);
  }

  // オシレータ1本（任意でローパス）＋エンベロープ
  // o: { t, f, f2, slide, type, detune, atk, hold, rel, peak, lp, lp2, lpTime, q, dest, phys }
  function tone(o) {
    var t0 = o.t, atk = Math.max(0.001, num(o.atk, 0.004)), hold = Math.max(0, num(o.hold, 0)), rel = Math.max(0.005, num(o.rel, 0.1));
    var dur = atk + hold + rel;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(safeF(o.f), t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(safeF(o.f2), t0 + (o.slide || dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    var last = osc;
    if (o.lp) {
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(safeF(o.lp), t0);
      if (o.lp2) flt.frequency.exponentialRampToValueAtTime(safeF(o.lp2), t0 + (o.lpTime || dur));
      flt.Q.value = num(o.q, 0.7);
      osc.connect(flt);
      last = flt;
    }
    var g = ctx.createGain();
    env(g.gain, t0, num(o.peak, 0.2), atk, hold, rel);
    last.connect(g);
    g.connect(o.dest || sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    track(osc, o.phys);
    return osc;
  }

  // 共有ノイズ → Biquad → エンベロープ（バッファは使い回し・開始位置だけ乱数）
  // o: { t, atk, hold, rel, peak, type(filter), f, f2, slide, q, dest, phys }
  function noise(o) {
    var t0 = o.t, atk = Math.max(0.001, num(o.atk, 0.002)), hold = Math.max(0, num(o.hold, 0)), rel = Math.max(0.005, num(o.rel, 0.05));
    var dur = atk + hold + rel;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var flt = ctx.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.setValueAtTime(safeF(num(o.f, 2000)), t0);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(safeF(o.f2), t0 + (o.slide || dur));
    flt.Q.value = num(o.q, 1);
    var g = ctx.createGain();
    env(g.gain, t0, num(o.peak, 0.2), atk, hold, rel);
    src.connect(flt); flt.connect(g); g.connect(o.dest || sfxBus);
    src.start(t0, Math.random() * (noiseBuf.duration - 0.5));
    src.stop(t0 + dur + 0.03);
    track(src, o.phys);
    return src;
  }

  // LFO を AudioParam に足す（ビブラート／トレモロ）
  function lfo(param, t, dur, rate, depth, type) {
    var l = ctx.createOscillator(); l.type = type || 'sine'; l.frequency.value = rate;
    var g = ctx.createGain(); g.gain.value = depth;
    l.connect(g); g.connect(param);
    l.start(t); l.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ 複合ボイス
  // 鐘っぽいチャイム（基音＋2倍音＋3倍音）
  function chime(f, t, rel, peak, dest) {
    tone({ f: f, t: t, atk: 0.003, rel: rel, peak: peak, dest: dest });
    tone({ f: f * 2.0, t: t, atk: 0.003, rel: rel * 0.6, peak: peak * 0.3, dest: dest });
    tone({ f: f * 3.01, t: t, atk: 0.003, rel: rel * 0.35, peak: peak * 0.15, dest: dest });
  }
  // ブラス風（デチューンした鋸波2本＋ローパスのアタックスイープ）
  function brass(f, t, dur, peak, dest) {
    var atk = 0.015, rel = Math.max(0.06, dur * 0.35), hold = Math.max(0, dur - rel);
    for (var i = -1; i <= 1; i += 2) {
      tone({ type: 'sawtooth', f: f, t: t, atk: atk, hold: hold, rel: rel, peak: peak * 0.5, detune: i * 6,
        lp: 700, lp2: 3200, lpTime: 0.06, q: 1.2, dest: dest });
    }
  }
  function chordHit(freqs, t, dur, peak, dest) { for (var i = 0; i < freqs.length; i++) brass(freqs[i], t, dur, peak, dest); }
  // 低域インパクト（ピッチ落下サイン＋ローパスノイズ）
  function impact(t, peak, f0, f1, rel, dest) {
    tone({ f: f0, f2: f1, slide: rel * 0.4, t: t, atk: 0.003, rel: rel, peak: peak, dest: dest });
    noise({ t: t, rel: 0.09, peak: peak * 0.4, type: 'lowpass', f: 1500, dest: dest });
  }
  // 玉同士のカチン
  function clink(t, peak, m) {
    var f = 3400 * m;
    tone({ f: f, t: t, atk: 0.001, rel: 0.05, peak: peak });
    tone({ f: f * 2.37, t: t, atk: 0.001, rel: 0.025, peak: peak * 0.35 });
    noise({ t: t, rel: 0.01, peak: peak * 0.5, type: 'bandpass', f: f * 1.4, q: 4 });
  }
  // 玉がジャラジャラ流れる（n 個・長さは ~1.5s で頭打ち）
  function trayBurst(t, n) {
    var dur = clamp(0.25 + n * 0.006, 0.3, 1.5);
    var k = Math.min(Math.round(n * 0.6) + 2, 36);
    var hold = Math.max(0, dur - 0.35);
    noise({ t: t, atk: 0.05, hold: hold, rel: 0.3, peak: 0.05 + Math.min(0.12, n * 0.0006), type: 'bandpass', f: 3200, f2: 2600, q: 1.2 });
    noise({ t: t, atk: 0.05, hold: hold, rel: 0.3, peak: 0.04, type: 'lowpass', f: 900 });
    for (var i = 0; i < k; i++) clink(t + Math.random() * dur * 0.9, 0.12 * rnd(0.5, 1), rnd(0.75, 1.3));
  }
  // キラキラ（高域サインを散らす）
  function shimmer(t, dur, peak, k, dest) {
    for (var i = 0; i < k; i++) {
      var f = 2200 * Math.pow(2, Math.random() * 1.6);
      tone({ f: f, t: t + Math.random() * dur * 0.5, atk: 0.01, rel: dur * rnd(0.4, 0.9), peak: peak * rnd(0.5, 1), dest: dest });
    }
  }

  // ------------------------------------------------------------------ 単発音テーブル（name → function(opts)）
  var C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1567.98, C7 = 2093;
  var SFX = {
    // ---- 物理（頻発・軽量・レート制限あり） ----
    nail: function (o) {                                  // 鋼球が真鍮釘に当たる
      if (!physOk()) return;
      var v = clamp(num(o.v, 0.5), 0, 1), t = T();
      var f = 5000 * rnd(0.8, 1.2), peak = 0.03 + 0.3 * v * v;
      tone({ f: f, t: t, atk: 0.002, rel: 0.012 + 0.01 * v, peak: peak, phys: true });
      noise({ t: t, rel: 0.008, peak: peak * 0.5, type: 'bandpass', f: f * 1.5, q: 6, phys: true });
    },
    wall: function (o) {                                  // プラ部品・レール
      if (!physOk()) return;
      var v = clamp(num(o.v, 0.5), 0, 1), t = T();
      var f = 700 * rnd(0.85, 1.15), peak = 0.03 + 0.25 * v;
      tone({ type: 'triangle', f: f, f2: f * 0.7, slide: 0.03, t: t, atk: 0.002, rel: 0.02 + 0.015 * v, peak: peak, lp: 2500, phys: true });
      noise({ t: t, rel: 0.015, peak: peak * 0.7, type: 'bandpass', f: 1100 * rnd(0.9, 1.1), q: 1.5, phys: true });
    },
    windmill: function () {                               // 風車: ラチェット風ダブルティック
      if (!physFree()) return;
      var t = T(), f = 2600 * rnd(0.9, 1.1);
      for (var i = 0; i < 2; i++) {
        var ti = t + i * 0.038;
        tone({ type: 'triangle', f: f * (i ? 0.85 : 1), t: ti, atk: 0.002, rel: 0.014, peak: 0.16, phys: true });
        noise({ t: ti, rel: 0.008, peak: 0.08, type: 'bandpass', f: 4000, q: 3, phys: true });
      }
    },
    launch: function () {                                 // 発射「コン」: 打撃＋バネの余韻
      if (!physFree()) return;
      var t = T();
      tone({ f: 190, f2: 55, slide: 0.06, t: t, atk: 0.003, rel: 0.12, peak: 0.5, phys: true });
      noise({ t: t, rel: 0.025, peak: 0.25, type: 'lowpass', f: 1600, phys: true });
      tone({ type: 'sawtooth', f: 1150, f2: 880, slide: 0.09, t: t + 0.012, atk: 0.003, rel: 0.09, peak: 0.07, lp: 2600, q: 4, phys: true });
    },
    stage: function () {                                  // ステージに乗る（柔らかい転がり）
      if (!physFree()) return;
      var t = T();
      noise({ t: t, atk: 0.005, rel: 0.035, peak: 0.09, type: 'lowpass', f: 2200, phys: true });
      tone({ f: 1500 * rnd(0.9, 1.1), t: t, atk: 0.002, rel: 0.02, peak: 0.05, phys: true });
    },

    // ---- 入賞・払い出し ----
    heso: function () { var t = T(); chime(E6, t, 0.28, 0.32); chime(1760, t + 0.09, 0.4, 0.32); },
    dencyu: function () { var t = T(); chime(C6, t, 0.28, 0.3); chime(G6, t + 0.09, 0.4, 0.3); },
    general: function () { chime(880, T(), 0.35, 0.22); },
    gate: function () { tone({ type: 'square', f: 2000, f2: 2600, slide: 0.03, t: T(), atk: 0.002, rel: 0.035, peak: 0.1, lp: 5000 }); },
    attacker: function (o) {                              // opts.n が大きいほど高く
      var n = clamp(Math.round(num(o.n, 1)), 1, 10), m = 1 + (n - 1) * 0.07, t = T();
      tone({ f: 200 * m, f2: 55, slide: 0.07, t: t, atk: 0.003, rel: 0.18, peak: 0.6 });
      noise({ t: t, rel: 0.04, peak: 0.25, type: 'bandpass', f: 2800, q: 1 });
      tone({ type: 'square', f: 880 * m, t: t, atk: 0.003, rel: 0.07, peak: 0.12, lp: 3500 });
      tone({ f: 1760 * m, t: t + 0.01, atk: 0.002, rel: 0.12, peak: 0.1 });
    },
    payout: function (o) {                                // n 個の玉が受け皿に落ちる（n×35ms）
      var n = clamp(Math.round(num(o.n, 5)), 1, 15), t = T();
      for (var i = 0; i < n; i++) clink(t + i * 0.035 + rnd(-0.008, 0.008), 0.18 * rnd(0.7, 1), rnd(0.8, 1.25));
    },
    tray: function (o) { trayBurst(T(), clamp(Math.round(num(o.n, 50)), 1, 300)); },
    lend: function () {                                   // カードユニット: ピッピッ＋玉
      var t = T();
      tone({ type: 'square', f: 2100, t: t, atk: 0.003, hold: 0.06, rel: 0.02, peak: 0.12, lp: 6000 });
      tone({ type: 'square', f: 2100, t: t + 0.11, atk: 0.003, hold: 0.06, rel: 0.02, peak: 0.12, lp: 6000 });
      trayBurst(t + 0.3, 40);
    },

    // ---- リール・演出 ----
    reel_start: function () {
      var t = T();
      noise({ t: t, atk: 0.04, hold: 0.05, rel: 0.2, peak: 0.28, type: 'bandpass', f: 500, f2: 3500, q: 2 });
      tone({ type: 'sawtooth', f: 220, f2: 660, slide: 0.25, t: t, atk: 0.03, hold: 0.05, rel: 0.17, peak: 0.06, lp: 1800 });
    },
    reel_stop: function () {                              // 「ドン」
      var t = T();
      tone({ f: 160, f2: 42, slide: 0.09, t: t, atk: 0.003, rel: 0.3, peak: 0.75 });
      noise({ t: t, rel: 0.05, peak: 0.3, type: 'lowpass', f: 900 });
      tone({ type: 'triangle', f: 240, f2: 180, slide: 0.05, t: t, atk: 0.003, rel: 0.06, peak: 0.25, lp: 1200 });
    },
    reach: function () {                                  // 上昇4音（~0.6s）
      var t = T(), notes = [C5, E5, G5, C6];
      for (var i = 0; i < 4; i++) brass(notes[i], t + i * 0.1, i === 3 ? 0.32 : 0.1, 0.28);
      chime(C7, t + 0.3, 0.45, 0.14);
    },
    sp_start: function () {                               // 上昇スイープ → インパクト（~1s）
      var t = T(), rise = 0.6, ti = t + rise;
      noise({ t: t, atk: rise * 0.9, rel: 0.1, peak: 0.35, type: 'bandpass', f: 250, f2: 6000, slide: rise, q: 1.5 });
      tone({ type: 'sawtooth', f: 110, f2: 880, slide: rise, t: t, atk: rise * 0.9, rel: 0.1, peak: 0.12, lp: 600, lp2: 4000, lpTime: rise });
      impact(ti, 0.9, 90, 30, 0.45);
      noise({ t: ti, rel: 0.25, peak: 0.3, type: 'highpass', f: 3000 });
      chordHit([C5, E5, G5, C6], ti, 0.35, 0.2);
    },
    cutin: function (o) {                                 // level 1(白)〜5(金虹)
      var lv = clamp(Math.round(num(o.level, 1)), 1, 5), t = T();
      noise({ t: t, atk: 0.004, rel: 0.12 + lv * 0.07, peak: 0.12 + lv * 0.05, type: 'highpass', f: 3500 + lv * 700, q: 0.8 });
      tone({ f: 3200 + lv * 350, t: t, atk: 0.003, rel: 0.15 + lv * 0.08, peak: 0.16 });
      if (lv >= 2) { chime(E6, t + 0.02, 0.25, 0.2); chime(1975.5, t + 0.1, 0.35, 0.2); }
      if (lv >= 3) { chime(2637, t + 0.18, 0.5, 0.18); chordHit([E5, G5, 987.77], t + 0.05, 0.3, 0.1); }
      if (lv >= 4) {
        impact(t, 0.55 + (lv - 4) * 0.3, 80, 32, 0.4 + (lv - 4) * 0.4);
        noise({ t: t, rel: 0.2, peak: 0.3, type: 'bandpass', f: 1500, q: 0.7 });
        chordHit([C5, E5, G5, C6], t + 0.05, 0.45, 0.16);
      }
      if (lv >= 5) {
        shimmer(t + 0.05, 1.2, 0.09, 10);
        tone({ f: 40, t: t, atk: 0.01, hold: 0.5, rel: 0.5, peak: 0.5 });
      }
    },
    zone: function () {                                   // 「ドドン」＋サイレン上昇
      var t = T();
      impact(t, 0.7, 120, 40, 0.3);
      impact(t + 0.2, 0.95, 110, 35, 0.5);
      noise({ t: t + 0.2, rel: 0.3, peak: 0.25, type: 'highpass', f: 2500 });
      var osc = tone({ type: 'triangle', f: 380, f2: 1500, slide: 0.9, t: t + 0.35, atk: 0.05, hold: 0.6, rel: 0.35, peak: 0.16, lp: 3000 });
      lfo(osc.frequency, t + 0.35, 1.0, 11, 25);
    },
    countdown: function () {
      var t = T();
      tone({ type: 'square', f: 1400, t: t, atk: 0.002, hold: 0.03, rel: 0.03, peak: 0.13, lp: 5000 });
      tone({ f: 2800, t: t, atk: 0.002, rel: 0.05, peak: 0.08 });
    },
    jackpot: function () {                                // ファンファーレ（~2.6s）
      var t = T(), G4 = 392;
      var seq = [[0, G4, 0.11], [0.14, G4, 0.11], [0.28, G4, 0.11], [0.42, C5, 0.42], [0.9, E5, 0.13], [1.05, G5, 0.13], [1.2, C6, 0.55]];
      for (var i = 0; i < seq.length; i++) brass(seq[i][1], t + seq[i][0], seq[i][2], 0.3);
      impact(t, 0.5, 130, 45, 0.2); impact(t + 0.42, 0.55, 130, 45, 0.25); impact(t + 1.2, 0.55, 130, 45, 0.25);
      for (var j = 0; j < 8; j++) noise({ t: t + 1.5 + j * 0.04, rel: 0.05, peak: 0.08 + j * 0.02, type: 'bandpass', f: 1800, q: 0.8 });
      var tc = t + 1.85;
      chordHit([C5, E5, G5, C6, E6], tc, 0.8, 0.2);
      impact(tc, 0.9, 120, 40, 0.5);
      noise({ t: tc, atk: 0.005, rel: 0.9, peak: 0.28, type: 'highpass', f: 5000 });
      shimmer(tc + 0.05, 1.0, 0.07, 8);
      chime(C7, tc, 0.7, 0.12);
    },
    lose: function () {                                   // 下降の短い音
      var t = T();
      tone({ type: 'triangle', f: 620, f2: 400, slide: 0.3, t: t, atk: 0.02, hold: 0.1, rel: 0.3, peak: 0.2, lp: 2000 });
      tone({ f: 310, f2: 200, slide: 0.3, t: t, atk: 0.02, hold: 0.1, rel: 0.3, peak: 0.1 });
    },
    revival: function () {                                // 復活: フラッシュノイズ＋短い勝利音
      var t = T(), n = [C5, E5, G5];
      noise({ t: t, atk: 0.003, rel: 0.3, peak: 0.55, type: 'highpass', f: 6000, f2: 800, slide: 0.3, q: 0.7 });
      impact(t, 0.6, 100, 35, 0.35);
      for (var i = 0; i < 3; i++) brass(n[i], t + 0.12 + i * 0.08, 0.08, 0.28);
      chordHit([C6, E6, G6, C7], t + 0.36, 0.5, 0.18);
      chime(C7, t + 0.36, 0.5, 0.15);
    },
    round: function (o) {                                 // ラウンド開始 2音・n で少し上がる
      var n = clamp(Math.round(num(o.n, 1)), 1, 16), m = Math.pow(2, (n - 1) / 36), t = T();
      chime(G5 * m, t, 0.2, 0.28); chime(C6 * m, t + 0.13, 0.45, 0.3);
    },
    ending: function () {
      var t = T();
      brass(G5, t, 0.13, 0.28); brass(E5, t + 0.15, 0.13, 0.28);
      chordHit([C5, E5, G5, C6], t + 0.3, 0.9, 0.2);
      impact(t + 0.3, 0.8, 120, 40, 0.5);
      noise({ t: t + 0.3, atk: 0.005, rel: 0.9, peak: 0.25, type: 'highpass', f: 5000 });
    },
    rush_in: function () {                                // RUSH 突入（~1.2s）
      var t = T(), arp = [C5, E5, G5, C6, E6, G6], tc = t + 0.48;
      noise({ t: t, atk: 0.4, rel: 0.1, peak: 0.25, type: 'bandpass', f: 400, f2: 5000, slide: 0.45, q: 1.5 });
      for (var i = 0; i < arp.length; i++) tone({ type: 'square', f: arp[i], t: t + i * 0.075, atk: 0.003, hold: 0.04, rel: 0.08, peak: 0.1, lp: 4000 });
      chordHit([C6, E6, G6, C7], tc, 0.65, 0.17);
      impact(tc, 0.7, 110, 38, 0.4);
      shimmer(tc, 0.7, 0.07, 8);
      chime(C7, tc, 0.6, 0.12);
    },
    rush_end: function () {                               // 下降3音
      var t = T(), n = [E5, C5, 440];
      for (var i = 0; i < 3; i++) {
        var last = i === 2;
        tone({ type: 'triangle', f: n[i], t: t + i * 0.22, atk: 0.01, hold: last ? 0.3 : 0.12, rel: last ? 0.4 : 0.1, peak: 0.22, lp: 2500 });
        tone({ f: n[i] / 2, t: t + i * 0.22, atk: 0.01, hold: last ? 0.3 : 0.12, rel: last ? 0.4 : 0.1, peak: 0.12 });
      }
    },
    alert: function () {                                  // 「ピンポン」×2
      var t = T();
      for (var i = 0; i < 2; i++) {
        chime(E6, t + i * 0.55, 0.3, 0.3);
        chime(C6, t + i * 0.55 + 0.2, 0.4, 0.3);
      }
    },
    lamp: function (o) {                                  // 保留変化 level 1..5
      var lv = clamp(Math.round(num(o.level, 1)), 1, 5), t = T(), k = 2 + lv;
      for (var i = 0; i < k; i++) {
        tone({ f: (1800 + lv * 350) * Math.pow(1.19, i), t: t + i * 0.028, atk: 0.003, rel: 0.09 + lv * 0.05, peak: 0.07 + lv * 0.025 });
      }
      if (lv >= 3) noise({ t: t, rel: 0.1 + lv * 0.05, peak: 0.05 + lv * 0.03, type: 'highpass', f: 6000 });
      if (lv >= 4) chime(G6 * (lv === 5 ? 1.335 : 1), t + k * 0.028, 0.4, 0.18);
    },
    button: function () {
      var t = T();
      tone({ type: 'square', f: 1200, t: t, atk: 0.002, hold: 0.012, rel: 0.02, peak: 0.1, lp: 4000 });
      noise({ t: t, rel: 0.012, peak: 0.08, type: 'highpass', f: 3000 });
    },
    error: function () {                                  // ブザー（トレモロ付き）
      var t = T();
      var g = ctx.createGain(); g.gain.value = 0.5; g.connect(sfxBus);
      lfo(g.gain, t, 0.4, 26, 0.5, 'square');
      tone({ type: 'sawtooth', f: 170, t: t, atk: 0.01, hold: 0.32, rel: 0.05, peak: 0.2, lp: 1200, dest: g });
      tone({ type: 'square', f: 85, t: t, atk: 0.01, hold: 0.32, rel: 0.05, peak: 0.12, lp: 800, dest: g });
    }
  };

  function play(name, opts) {
    try {
      if (!enabled || !ready()) return;
      var fn = SFX.hasOwnProperty(name) ? SFX[name] : null;
      if (!fn) return;
      fn((opts && typeof opts === 'object') ? opts : {});
    } catch (e) {}
  }

  // ------------------------------------------------------------------ BGM 定義
  // 1 小節 = 16 ステップ（16分）。prog は [root(MIDI), chord intervals] を小節ごとに並べる。
  //   bass: root からの半音（null=休符）／ pad, hat, kick, snare: 'x'=打, 'o'=アクセント, '.'=休
  //   arp : コード構成音のインデックス（3 以上は上のオクターブ）
  var _ = null;
  var BGM = {
    normal: {                                             // ホール風の静かなパッド
      bpm: 100, vol: 0.16,
      prog: [[48, [0, 4, 7, 11]], [45, [0, 3, 7, 10]], [41, [0, 4, 7, 11]], [43, [0, 4, 7, 9]]],
      bass: [0, _, _, _, _, _, _, _, 0, _, _, _, _, _, 7, _],
      pad: 'x...............', padLen: 16, padType: 'triangle', padCut: 1200, padAtk: 0.35, padLevel: 0.11,
      hat: '..x...x...x...x.', hatLevel: 0.06,
      bassType: 'sine', bassLevel: 0.45, bassCut: 500
    },
    reach: {                                              // 短調のパルス
      bpm: 120, vol: 0.2,
      prog: [[45, [0, 3, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]], [40, [0, 4, 7]]],
      bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _],
      pad: '....x.......x...', padLen: 3, padType: 'sawtooth', padCut: 1500, padAtk: 0.01, padLevel: 0.07,
      hat: 'x.x.x.x.x.x.x.x.', hatLevel: 0.1, kick: 'x.......x.......', snare: '....x.......x...',
      bassType: 'sawtooth', bassLevel: 0.35, bassCut: 700
    },
    sp: {                                                 // 速い・鋸波ベース
      bpm: 150, vol: 0.22,
      prog: [[40, [0, 3, 7]], [48, [0, 4, 7]], [50, [0, 4, 7]], [40, [0, 3, 7]]],
      bass: [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12],
      pad: 'x.......x.......', padLen: 6, padType: 'sawtooth', padCut: 2200, padAtk: 0.01, padLevel: 0.07,
      hat: 'o.xxo.xxo.xxo.xx', hatLevel: 0.12, kick: 'x...x...x...x...', snare: '....x.......x...',
      bassType: 'sawtooth', bassLevel: 0.4, bassCut: 900
    },
    jackpot: {                                            // 明るい長調 I-V-vi-IV
      bpm: 130, vol: 0.22,
      prog: [[48, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]]],
      bass: [0, _, _, _, 0, _, 12, _, 0, _, _, _, 7, _, 12, _],
      pad: 'x.......x.......', padLen: 8, padType: 'sawtooth', padCut: 2500, padAtk: 0.02, padLevel: 0.07,
      arp: [0, _, 1, _, 2, _, 3, _, 2, _, 1, _, 0, _, 1, _], arpType: 'square', arpLevel: 0.06,
      hat: 'x.x.x.x.x.x.x.x.', hatLevel: 0.1, kick: 'x...x...x...x...', snare: '....x.......x...',
      bassType: 'triangle', bassLevel: 0.5, bassCut: 800
    },
    rush: {                                               // アルペジオ主体のアップテンポ
      bpm: 140, vol: 0.22,
      prog: [[45, [0, 3, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [43, [0, 4, 7]]],
      bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _],
      pad: 'x...............', padLen: 16, padType: 'sawtooth', padCut: 1800, padAtk: 0.05, padLevel: 0.06,
      arp: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1], arpType: 'square', arpLevel: 0.07,
      hat: 'o.x.o.x.o.x.o.x.', hatLevel: 0.12, kick: 'x...x...x...x...', snare: '....x.......x...',
      bassType: 'sawtooth', bassLevel: 0.38, bassCut: 800
    },
    jitan: {                                              // 落ち着いた中速
      bpm: 110, vol: 0.17,
      prog: [[41, [0, 4, 7, 11]], [43, [0, 4, 7]], [40, [0, 3, 7, 10]], [45, [0, 3, 7, 10]]],
      bass: [0, _, _, _, _, _, 0, _, 0, _, _, _, _, _, 7, _],
      pad: 'x...............', padLen: 16, padType: 'triangle', padCut: 1500, padAtk: 0.2, padLevel: 0.1,
      arp: [0, _, 2, _, 3, _, 2, _, 0, _, 2, _, 3, _, 2, _], arpType: 'sine', arpLevel: 0.08,
      hat: '..x...x...x...x.', hatLevel: 0.07, kick: 'x.......x.......',
      bassType: 'triangle', bassLevel: 0.42, bassCut: 600
    }
  };

  // ------------------------------------------------------------------ BGM ボイス
  function bgmKick(d, t, g) { tone({ f: 150, f2: 45, slide: 0.07, t: t, atk: 0.002, rel: 0.16, peak: num(d.kickLevel, 0.55), dest: g }); }
  function bgmSnare(d, t, g) {
    noise({ t: t, atk: 0.001, rel: 0.11, peak: num(d.snareLevel, 0.22), type: 'bandpass', f: 1900, q: 0.7, dest: g });
    tone({ f: 200, f2: 120, slide: 0.05, t: t, atk: 0.002, rel: 0.07, peak: 0.2, dest: g });
  }
  function bgmHat(d, t, acc, g) {
    noise({ t: t, atk: 0.001, rel: acc ? 0.07 : 0.035, peak: num(d.hatLevel, 0.1) * (acc ? 1 : 0.65), type: 'highpass', f: 7500, q: 0.7, dest: g });
  }
  function bgmBass(d, midi, t, dur, g) {
    tone({ type: d.bassType || 'triangle', f: mtof(midi), t: t, atk: 0.006, hold: Math.max(0.02, dur * 0.8 - 0.05), rel: 0.05,
      peak: num(d.bassLevel, 0.4), lp: d.bassCut || 800, q: 1, dest: g });
  }
  function bgmPad(d, notes, t, dur, g) {
    var atk = d.padAtk || 0.05, rel = Math.max(0.05, dur * 0.25), hold = Math.max(0, dur - atk - rel);
    for (var i = 0; i < notes.length; i++) {
      tone({ type: d.padType || 'sine', f: mtof(notes[i]), t: t, atk: atk, hold: hold, rel: rel, peak: num(d.padLevel, 0.1),
        lp: d.padCut || 1500, q: 0.5, detune: (i % 2 ? 4 : -4), dest: g });
    }
  }
  function bgmArp(d, midi, t, dur, g) {
    tone({ type: d.arpType || 'square', f: mtof(midi), t: t, atk: 0.003, hold: dur * 0.35, rel: 0.06, peak: num(d.arpLevel, 0.07), lp: 3200, dest: g });
  }

  function hit(pat, s) { if (!pat) return 0; var c = pat.charAt(s); return c === 'o' ? 2 : (c === 'x' ? 1 : 0); }
  function gate(arr, s) { var n = 1; while (n < 16 && arr[(s + n) % 16] == null) n++; return Math.min(n, 8); }
  function chordTone(root, chord, idx) { return root + chord[idx % chord.length] + 12 * Math.floor(idx / chord.length); }

  function scheduleStep(L, step, t) {
    var d = L.def, s = step % 16, pc = d.prog[Math.floor(step / 16) % d.prog.length];
    var root = pc[0], chord = pc[1], sd = L.stepDur, g = L.gain, h;
    if (hit(d.kick, s)) bgmKick(d, t, g);
    if (hit(d.snare, s)) bgmSnare(d, t, g);
    if ((h = hit(d.hat, s))) bgmHat(d, t, h === 2, g);
    var b = d.bass ? d.bass[s] : null;
    if (b != null) bgmBass(d, root + b, t, sd * gate(d.bass, s), g);
    if (hit(d.pad, s)) {
      var notes = [];
      for (var i = 0; i < chord.length; i++) notes.push(root + 12 + chord[i]);
      bgmPad(d, notes, t, sd * (d.padLen || 16), g);
    }
    if (d.arp) { var a = d.arp[s]; if (a != null) bgmArp(d, chordTone(root + 24, chord, a), t, sd, g); }
  }

  // ------------------------------------------------------------------ BGM シーケンサ（lookahead 方式）
  var LOOKAHEAD = 0.3, TICK_MS = 100, XFADE = 0.4;
  var bgm = { mode: null, pending: null, layers: [], timer: null };

  function createLayer(mode) {
    var def = BGM[mode];
    var g = ctx.createGain(); g.gain.value = 0; g.connect(bgmBus);
    return { mode: mode, def: def, gain: g, step: 0, total: def.prog.length * 16, stepDur: 60 / def.bpm / 4,
      nextTime: T() + 0.05, stopping: false, killAt: 0 };
  }

  function fadeOutLayers(t) {
    for (var i = 0; i < bgm.layers.length; i++) {
      var L = bgm.layers[i];
      if (L.stopping) continue;
      L.stopping = true;
      try {
        L.gain.gain.cancelScheduledValues(t);
        L.gain.gain.setValueAtTime(L.gain.gain.value, t);
        L.gain.gain.linearRampToValueAtTime(0, t + XFADE);
      } catch (e) {}
      L.killAt = t + XFADE + 0.1;
    }
  }

  function tick() {
    try {
      if (!ctx) return;
      var now = T(), horizon = now + LOOKAHEAD;
      for (var i = bgm.layers.length - 1; i >= 0; i--) {
        var L = bgm.layers[i];
        if (L.stopping) {
          if (now >= L.killAt) { try { L.gain.disconnect(); } catch (e) {} bgm.layers.splice(i, 1); }
          continue;
        }
        if (ctx.state !== 'running') continue;
        if (L.nextTime < now - 0.25) L.nextTime = now + 0.02;      // 停止明け: 溜まった分は捨てて前に進む
        while (L.nextTime < horizon) {
          if (enabled) scheduleStep(L, L.step, L.nextTime);        // ミュート中は時間だけ進める
          L.step = (L.step + 1) % L.total;
          L.nextTime += L.stepDur;
        }
      }
      if (!bgm.layers.length && bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
    } catch (e) {}
  }

  function startBgm(mode) {
    try {
      if (!BGM.hasOwnProperty(mode) || !ctx) return;
      if (ctx.state !== 'running') { bgm.pending = mode; return; }   // resume 完了後に自動開始
      if (bgm.mode === mode) return;
      var t = T();
      fadeOutLayers(t);
      var L = createLayer(mode);
      L.gain.gain.setValueAtTime(0, t);
      L.gain.gain.linearRampToValueAtTime(L.def.vol, t + XFADE);
      bgm.layers.push(L);
      bgm.mode = mode;
      bgm.pending = null;
      if (!bgm.timer) { tick(); bgm.timer = setInterval(tick, TICK_MS); }
    } catch (e) {}
  }

  function stopBgm() {
    try {
      bgm.pending = null;
      bgm.mode = null;
      if (ctx) fadeOutLayers(T());
    } catch (e) {}
  }

  // ------------------------------------------------------------------ 音声合成（日本語TTS）
  var jaVoice = null, voicesHooked = false;
  function synth() { return (hasWindow && window.speechSynthesis) ? window.speechSynthesis : null; }
  function findJaVoice() {
    var ss = synth();
    if (!ss || typeof ss.getVoices !== 'function') return null;
    var vs = ss.getVoices() || [], cand = [];
    for (var i = 0; i < vs.length; i++) if (/^ja/i.test(vs[i].lang || '')) cand.push(vs[i]);
    if (!cand.length) return null;
    for (var j = 0; j < cand.length; j++) if (/Kyoko|O-ren|Nanami|Otoya|Hattori|日本語/i.test(cand[j].name || '')) return cand[j];
    return cand[0];
  }
  function hookVoices() {
    if (voicesHooked) return;
    voicesHooked = true;
    var ss = synth();
    if (!ss) return;
    var refresh = function () { jaVoice = findJaVoice(); };
    try {
      if (typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', refresh);
      else ss.onvoiceschanged = refresh;
    } catch (e) {}
    refresh();
  }
  function cancelSpeech() { try { var ss = synth(); if (ss) ss.cancel(); } catch (e) {} }
  function speak(text) {
    try {
      if (!inited || !speechOn || !enabled) return;
      var ss = synth();
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
      hookVoices();
      if (!jaVoice) jaVoice = findJaVoice();
      if (!jaVoice) return;
      var s = String(text == null ? '' : text);
      if (!s) return;
      ss.cancel();
      var u = new SpeechSynthesisUtterance(s);
      u.voice = jaVoice; u.lang = jaVoice.lang || 'ja-JP';
      u.rate = 1.1; u.pitch = 1.0; u.volume = volume;
      ss.speak(u);
    } catch (e) {}
  }
  function setSpeech(on) { speechOn = !!on; if (!speechOn) cancelSpeech(); }
  if (hasWindow) { try { hookVoices(); } catch (e) {} }

  // ------------------------------------------------------------------ 公開 API
  function status() {
    return { hasAudio: !!AC, ready: ready(), state: ctx ? ctx.state : 'none', enabled: enabled, volume: volume,
      speech: speechOn, bgm: bgm.mode, layers: bgm.layers.length, physActive: physActive };
  }

  var PachiAudio = {
    version: '1.0.0',
    init: init,
    isReady: ready,
    setEnabled: setEnabled,
    setVolume: setVolume,
    play: play,
    startBgm: startBgm,
    stopBgm: stopBgm,
    speak: speak,
    setSpeech: setSpeech,
    status: status,
    names: Object.keys(SFX),          // 対応する単発音名（自己テスト用）
    bgmModes: Object.keys(BGM)        // 対応する BGM モード
  };

  host.PachiAudio = PachiAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);

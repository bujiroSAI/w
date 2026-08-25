// おとはた — 音源エンジン（Web Audio）
// ピアノ: 倍音加算合成（インハーモニシティ＋ハンマーノイズ）。和音は完全同時発音（分散禁止）。
// 効果音: すべて非音程（ノイズベース）。訓練中の音空間にピッチを混ぜないための設計。

'use strict';

const Piano = (() => {
  let ctx = null;
  let master = null;
  let comp = null;
  let noiseBuf = null;
  let volume = 0.8;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp);
      comp.connect(ctx.destination);
      // 共有ノイズバッファ（2秒）
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // iOSはタブ切替・スリープで 'interrupted'（Safari独自状態）に落ちて自動復帰しない
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  // 画面復帰時に interrupted からの再開を試みる
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume();
  });

  // iOSのオーディオアンロック（最初のユーザー操作で呼ぶ）
  let silentEl = null;
  function unlock() {
    ensure();
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    // 消音スイッチ対策: <audio>再生でオーディオセッションをplayback系へ昇格させる
    try {
      if (!silentEl) {
        silentEl = document.createElement('audio');
        silentEl.setAttribute('playsinline', '');
        silentEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      }
      const p = silentEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 対応外なら無視 */ }
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  function midiToFreq(midi, a4) {
    return (a4 || 442) * Math.pow(2, (midi - 69) / 12);
  }

  // 1音。倍音10本＋弦のわずかな伸び（inharmonicity）＋打鍵ノイズ。
  function note(midi, when, dur, vel, a4) {
    const t0 = when;
    const f0 = midiToFreq(midi, a4);
    const B = 0.00025; // インハーモニシティ係数
    const nyq = ctx.sampleRate / 2 * 0.9;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(master);

    const nPartials = 10;
    for (let n = 1; n <= nPartials; n++) {
      const fn = n * f0 * Math.sqrt(1 + B * n * n);
      if (fn > nyq) break;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = fn;
      const g = ctx.createGain();
      // 倍音振幅: 1/n^1.7、偶数倍音をわずかに抑えて木質感
      let amp = Math.pow(1 / n, 1.7) * (n % 2 === 0 ? 0.85 : 1) * vel * 0.22;
      // 減衰: 高次倍音ほど速く消える
      const tau = Math.max(0.06, 0.85 * Math.pow(0.7, n - 1)) * (dur / 1.8);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.006);
      g.gain.setTargetAtTime(0, t0 + 0.006, tau);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.5);
      // 第2弦のデチューン（豊かさ・低次のみ）
      if (n <= 4) {
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = fn * Math.pow(2, 1.2 / 1200); // +1.2セント
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0, t0);
        g2.gain.linearRampToValueAtTime(amp * 0.55, t0 + 0.008);
        g2.gain.setTargetAtTime(0, t0 + 0.008, tau * 0.9);
        osc2.connect(g2);
        g2.connect(out);
        osc2.start(t0);
        osc2.stop(t0 + dur + 0.5);
      }
    }
    // 打鍵ノイズ（アタックの説得力）
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(3000, f0 * 8);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.12, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    nz.connect(bp); bp.connect(ng); ng.connect(out);
    nz.start(t0, 0.1, 0.05);
  }

  // 和音（完全同時・ジャーン）。durは響かせる長さ。
  function chord(midis, opts) {
    ensure();
    const o = opts || {};
    const t = ctx.currentTime + (o.delay || 0.05);
    const dur = o.dur || 1.9;
    const vels = [0.95, 0.88, 0.92, 0.85];
    midis.forEach((m, i) => note(m, t, dur, vels[i % vels.length], o.a4));
    return dur;
  }

  // ---- 効果音（全て非音程・ノイズベース） ----

  function noiseHit(opts) {
    const t = ctx.currentTime + 0.01;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random());
    s.stop(t + opts.dur + 0.1);
  }

  // 正解: シャラッ（上昇シマー）
  function sfxCorrect() {
    ensure();
    noiseHit({ f0: 1800, f1: 7000, dur: 0.38, gain: 0.20, q: 2.5 });
    setTimeout(() => noiseHit({ f0: 4000, f1: 8000, dur: 0.25, gain: 0.12, q: 3 }), 90);
  }

  // 不正解: ごく小さな「ぽふ」（叱らない音）
  function sfxSoft() {
    ensure();
    noiseHit({ type: 'lowpass', f0: 260, dur: 0.13, gain: 0.10, q: 0.7 });
  }

  // タップ音: ごく短いチッ
  function sfxTap() {
    ensure();
    noiseHit({ f0: 2600, dur: 0.035, gain: 0.06, q: 1.5 });
  }

  // セッション完了ファンファーレ: シェイカー連打＋長いシマー（非音程）
  function sfxFanfare() {
    ensure();
    [0, 140, 280].forEach((ms, i) => {
      setTimeout(() => noiseHit({ f0: 2500 + i * 900, f1: 6500, dur: 0.18, gain: 0.16, q: 2 }), ms);
    });
    setTimeout(() => noiseHit({ f0: 2000, f1: 9000, dur: 1.1, gain: 0.15, q: 2.5 }), 460);
  }

  return { ensure, unlock, setVolume, chord, sfxCorrect, sfxSoft, sfxTap, sfxFanfare,
           get ctx() { return ctx; }, get master() { return master; } };
})();

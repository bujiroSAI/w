/* main.js — 起動・ループ・入力・UI 配線・保存 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const SAVE_KEY = 'pachinko.save.v1', SET_KEY = 'pachinko.settings.v1';
  const settings = Object.assign({ sound: true, volume: 0.8, speech: true, turbo: false, autoRefill: true, spec: 'middle' }, load(SET_KEY) || {});
  if (qs.get('spec')) settings.spec = qs.get('spec');

  const seed = qs.get('seed') ? +qs.get('seed') : (Date.now() & 0xffffff);
  const world = new PachiPhysics.World({ seed });
  const L = PachiBoard.buildBoard(world);
  const spec = Object.assign({}, PachiSpec.SPECS[settings.spec] || PachiSpec.SPECS.middle);
  if (qs.get('p')) { spec.pLow = +qs.get('p'); spec.pHigh = Math.min(0.9, spec.pLow * 3.2); }
  const SAY = { jackpot: '大当り。右打ちしてください', right: '右打ちしてください', left: '左打ちに戻してください', rush: 'ラッシュ突入', jitan: '時短突入', lend_fail: '残高が足りません' };
  const hooks = { sfx: (n, o) => PachiAudio.play(n, o), bgm: m => PachiAudio.startBgm(m), say: k => PachiAudio.speak(SAY[k] || k) };
  const game = new PachiGame.Game(world, L, spec, hooks);
  game.turbo = !!settings.turbo; game.launch.autoRefill = !!settings.autoRefill;
  const saved = load(SAVE_KEY);
  if (saved && saved.spec === spec.id && !qs.get('fresh')) game.load(saved);

  const canvas = document.getElementById('machine');
  const lcd = new PachiLCD.LCD();
  const renderer = new PachiRender.Renderer(canvas, world, L, game, lcd);
  const LY = PachiRender.LAYOUT;
  PachiAudio.setEnabled(settings.sound); PachiAudio.setVolume(settings.volume); PachiAudio.setSpeech(settings.speech);

  // ---- ループ ----
  let last = performance.now(), running = true, bgmStarted = false;
  const auto = qs.get('auto') === '1', fast = Math.max(1, Math.min(20, +(qs.get('fast') || 1)));
  function step(dt) {
    if (auto) { game.setStrength(game.wantRight() ? 0.9 : 0.42); if (game.totalBalls() === 0) { if (game.money.balance < 500) game.insertMoney(1000); game.lend(); } }
    game.update(dt); world.step(dt); PachiBoard.updateBalls(world, L, dt);
    let nailSfx = 0;
    for (const e of world.drainEvents()) {
      if (e.type === 'zone') game.onZone(e.zone.id, e.ball);
      else if (e.type === 'nail') { if (e.v > 220 && nailSfx++ < 4) PachiAudio.play('nail', { v: Math.min(1, e.v / 1600) }); }
      else if (e.type === 'wall') { if (e.v > 500 && nailSfx++ < 4) PachiAudio.play('wall', { v: Math.min(1, e.v / 2500) }); }
      else if (e.type === 'spinner') PachiAudio.play('windmill');
    }
  }
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    if (running) { for (let i = 0; i < fast; i++) step(dt); }
    renderer.draw(dt);
    requestAnimationFrame(frame);
  }
  if (qs.get('test') === '1') { // ヘッドレス検証: 仮想時間で進むようタイマー駆動
    let vt = 0; setInterval(() => { vt += 16.7; const dt = 1 / 60; if (running) for (let i = 0; i < fast; i++) step(dt); renderer.draw(dt); }, 16);
  } else requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); if (!running) save(); });

  // ---- 入力（ハンドル・ボタン） ----
  let dragging = false, stopHeld = false;
  function machineXY(ev) { const r = canvas.getBoundingClientRect(); return renderer.toMachine(ev.clientX - r.left, ev.clientY - r.top); }
  function inCircle(p, c, pad) { return Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r + (pad || 0); }
  function handleAngleToStrength(p) {
    let a = Math.atan2(p[1] - LY.handle.y, p[0] - LY.handle.x) * 180 / Math.PI; if (a < 0) a += 360; // 0=右 90=下 180=左 270=上
    if (a >= 180) return Math.max(0, Math.min(1, (a - 180) / 180));
    if (a < 60) return 1; if (a > 120) return 0; return null;
  }
  const zone = document.getElementById('handleZone');
  const onDown = ev => {
    audioInit(); const p = machineXY(ev);
    if (inCircle(p, LY.stop, 6)) { stopHeld = true; game.setStop(true); ev.currentTarget.setPointerCapture(ev.pointerId); }
    else if (inCircle(p, LY.handle, 18)) { dragging = true; ev.currentTarget.setPointerCapture(ev.pointerId); const s = handleAngleToStrength(p); if (s != null) game.setStrength(s); }
    else if (inCircle(p, LY.chance, 6)) game.pressButton();
    else if (inCircle(p, LY.lend, 8)) game.lend();
    else if (inCircle(p, LY.ret, 8)) game.returnCard();
    else return;
    ev.preventDefault();
  };
  const onMove = ev => { if (!dragging) return; const s = handleAngleToStrength(machineXY(ev)); if (s != null) game.setStrength(s); syncUI(); };
  const release = ev => { dragging = false; if (stopHeld) { stopHeld = false; game.setStop(false); } };
  for (const el of [canvas, zone]) { el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); }
  function placeZone() { // ハンドル周りだけタッチでのスクロールを止める（他は縦スクロール可）
    const h = LY.handle, pad = 20, sc = renderer.scale; if (!zone || !sc) return;
    zone.style.left = (renderer.ox + (h.x - h.r - pad) * sc) + 'px'; zone.style.top = (renderer.oy + (LY.stop.y - LY.stop.r - 8) * sc) + 'px';
    zone.style.width = ((h.r + pad) * 2 * sc) + 'px'; zone.style.height = ((h.y + h.r + pad - (LY.stop.y - LY.stop.r - 8)) * sc) + 'px';
  }
  canvas.addEventListener('wheel', ev => { const p = machineXY(ev); if (inCircle(p, LY.handle, 30)) { game.setStrength(game.launch.strength - Math.sign(ev.deltaY) * 0.01); syncUI(); ev.preventDefault(); } }, { passive: false });
  window.addEventListener('keydown', ev => {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
    audioInit();
    const s = game.launch.strength;
    switch (ev.key) {
      case 'ArrowRight': game.setStrength(s + 0.01); break;
      case 'ArrowLeft': game.setStrength(s - 0.01); break;
      case 'ArrowUp': game.setStrength(s + 0.05); break;
      case 'ArrowDown': game.setStrength(s - 0.05); break;
      case ' ': game.setStop(true); ev.preventDefault(); break;
      case 'Enter': case 'b': case 'B': game.pressButton(); break;
      case 'l': case 'L': game.setStrength(0.42); break;
      case 'r': case 'R': game.setStrength(0.9); break;
      case '0': game.setStrength(0); break;
      case 'k': case 'K': game.lend(); break;
      case 'u': case 'U': game.liftLower(); break;
      default: return;
    }
    syncUI();
  });
  window.addEventListener('keyup', ev => { if (ev.key === ' ') game.setStop(false); });

  // ---- DOM UI ----
  const $ = id => document.getElementById(id);
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', ev => { audioInit(); fn(ev); syncUI(); }); };
  on('btnMoney', () => game.insertMoney(1000));
  on('btnLend', () => game.lend());
  on('btnLift', () => game.liftLower());
  on('btnBox', () => game.boxLower());
  on('btnLeft', () => game.setStrength(0.42));
  on('btnRight', () => game.setStrength(0.9));
  on('btnOff', () => game.setStrength(0));
  on('btnPush', () => game.pressButton());
  on('btnReset', () => { if (confirm('遊技データ（玉・収支・履歴・確変状態）を全て消して新台にしますか？')) { game.resetAll(); save(); } });
  on('btnFull', () => { try { const el = document.documentElement; if (!document.fullscreenElement) { const f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) f.call(el); } else document.exitFullscreen(); } catch (e) { /* iframe 内など */ } });
  on('btnHelp', () => $('help').classList.toggle('open'));
  const range = $('strength'); if (range) { range.addEventListener('input', () => { audioInit(); game.setStrength(range.value / 100); }); }
  const chk = (id, key, fn) => { const el = $(id); if (!el) return; el.checked = !!settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; fn(el.checked); save(); }); };
  chk('optSound', 'sound', v => PachiAudio.setEnabled(v));
  chk('optSpeech', 'speech', v => PachiAudio.setSpeech(v));
  chk('optTurbo', 'turbo', v => { game.turbo = v; });
  chk('optAuto', 'autoRefill', v => { game.launch.autoRefill = v; });
  const vol = $('optVolume'); if (vol) { vol.value = Math.round(settings.volume * 100); vol.addEventListener('input', () => { settings.volume = vol.value / 100; PachiAudio.setVolume(settings.volume); save(); }); }
  const selSpec = $('optSpec'); if (selSpec) { selSpec.value = spec.id; selSpec.addEventListener('change', () => { settings.spec = selSpec.value; save(); location.href = location.pathname + '?spec=' + selSpec.value; }); }
  const stopBtn = $('btnStop'); if (stopBtn) { const dn = ev => { audioInit(); game.setStop(true); ev.preventDefault(); }, up = () => game.setStop(false); stopBtn.addEventListener('pointerdown', dn); stopBtn.addEventListener('pointerup', up); stopBtn.addEventListener('pointerleave', up); stopBtn.addEventListener('pointercancel', up); }

  function syncUI() {
    if (range && Math.abs(range.value / 100 - game.launch.strength) > 0.005) range.value = Math.round(game.launch.strength * 100);
    const st = game.stats, set = (id, v) => { const el = $(id); if (el && el.textContent !== String(v)) el.textContent = v; };
    set('sBalance', game.money.balance); set('sInvest', game.money.invested); set('sBalls', game.totalBalls()); set('sTray', game.balls.tray); set('sLower', game.balls.lower); set('sBox', game.balls.box);
    const d = game.diff(); set('sDiff', (d >= 0 ? '+' : '') + d); set('sYen', (d >= 0 ? '+' : '') + (d * spec.ballYen).toLocaleString());
    set('sSpins', st.totalSpins); set('sHits', st.hits); set('sRate', st.launched ? (250 * st.hesoIn / st.launched).toFixed(1) : '-');
    set('sMode', game.phase === 'jackpot' ? '大当り中' : game.mode === 'kakuhen' ? `確変（ST残${game.stLeft}）` : game.mode === 'jitan' ? `時短（残${game.jitanLeft}）` : '通常');
    set('sStrength', Math.round(game.launch.strength * 100) + '%');
    const el = $('sHits'); if (el) el.parentElement.classList.toggle('hot', game.phase === 'jackpot');
  }
  setInterval(syncUI, 250); syncUI();

  // ---- 音の初期化（ユーザー操作内） ----
  function audioInit() {
    if (PachiAudio.init() && !bgmStarted) { bgmStarted = true; PachiAudio.startBgm(game.phase === 'jackpot' ? 'jackpot' : game.mode === 'kakuhen' ? 'rush' : game.mode === 'jitan' ? 'jitan' : 'normal'); }
  }
  window.addEventListener('pointerdown', audioInit, { once: false });

  // ---- 保存 ----
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* private mode 等 */ } }
  function load(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  setInterval(save, 5000); window.addEventListener('beforeunload', save);

  // ---- リサイズ ----
  const ro = new ResizeObserver(() => { renderer.resize(); placeZone(); }); ro.observe(canvas); renderer.resize(); placeZone();

  // ---- テスト用フック ----
  window.__pachi = { game, world, L, renderer, spec, settings };
  if (qs.get('test') === '1') {
    const pre = document.createElement('pre'); pre.id = 'testlog'; pre.style.cssText = 'position:fixed;left:0;top:0;font-size:8px;color:#0f0;background:#000;z-index:9;max-height:40vh;overflow:auto;margin:0';
    document.body.appendChild(pre);
    setInterval(() => { const st = game.stats; pre.textContent = JSON.stringify({ t: +game.t.toFixed(1), phase: game.phase, mode: game.mode, stLeft: game.stLeft, balls: game.balls, money: game.money, hold1: game.hold1.length, hold2: game.hold2.length, spins: st.totalSpins, hits: st.hits, hesoIn: st.hesoIn, launched: st.launched, attackerIn: st.attackerIn, dencyuIn: st.dencyuIn, out: st.out, foul: st.foul, inFlight: world.balls.length, tulip: game.tulipOpen, attacker: game.attackerOpen, spin: game.spin ? { t: +game.spin.t.toFixed(1), dur: game.spin.dur, win: game.spin.win, sp: game.spin.sp } : null, jackpot: game.jackpot ? { stage: game.jackpot.stage, round: game.jackpot.round, payout: game.jackpot.payout } : null, errors: window.__errors || [], view: [window.innerWidth, window.innerHeight, canvas.clientWidth, canvas.clientHeight, document.getElementById('side').scrollWidth, document.documentElement.scrollWidth] }); }, 500);
    window.addEventListener('error', e => { (window.__errors = window.__errors || []).push(String(e.message)); });
  }
})();

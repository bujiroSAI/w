// おとはた — 外部入力（物理ボタン試作・道A）
// BLEキーボードとして振る舞う自作ボタン（ESP32）や、iOSにペアリングしたゲームパッドからの入力を
// 画面上の色ボタンのタップに変換する。アプリ本体（app.js）の判定ロジックには一切触れない。
//   キーボード: 数字キー 1〜9（テンキー含む）= 左から n 番目のボタン
//   ゲームパッド: ボタン index 0〜8 = 左から n 番目のボタン（押した瞬間だけ・押しっぱなしは1回）
// 2026-10-06 新設。技術構想_2026-08.md §3-2「キーボードのふりをするボタン」の受け側。

'use strict';

const Input = (() => {
  let last = null; // { src: 'key'|'pad', t }

  // いま押せる色ボタン群（プレイ中は #flags、じぶんでならす中は #free-flags）
  function targets() {
    const screen = document.querySelector('.screen.active');
    if (!screen) return [];
    const box = screen.querySelector('#flags, #free-flags');
    if (!box || box.classList.contains('lock')) return []; // きくじかん中はロック
    return Array.from(box.querySelectorAll('.flag'));
  }

  // n 番目のキー／ポッド ＝ 導入順 n 番目の色（CHORDS[n-1]）に固定。画面に出ていない色のポッドは無視する（UX-24）
  function press(index, src) {
    const c = typeof CHORDS !== 'undefined' ? CHORDS[index] : null;
    if (!c) return false;
    const el = targets().find(f => f.dataset.chord === c.id);
    if (!el) return false;
    last = { src, t: Date.now() };
    // app.js は版によって pointerdown / click のどちらかで拾う。実タップと同じ順で両方発火させる。
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  // 直前の試行がどこから来たか（logTrial が src に記録する。タッチなら null）
  function lastSource(withinMs) {
    if (!last) return null;
    return Date.now() - last.t <= (withinMs || 1500) ? last.src : null;
  }

  // ---- キーボード ----
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const m = /^(?:Digit|Numpad)?([1-9])$/.exec(e.code) || /^([1-9])$/.exec(e.key);
    if (m) { if (press(parseInt(m[1], 10) - 1, 'key')) e.preventDefault(); return; }
    // Enter／Space＝親の操作: ホームなら「あそぶ」、プレイ中は「つぎへ」（親子共同モード）／再聴（UX-26）
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      const screen = document.querySelector('.screen.active');
      if (!screen) return;
      const btn = screen.id === 'screen-home' ? screen.querySelector('#btn-play') : screen.id === 'screen-play' ? screen.querySelector('#char-btn') : screen.id === 'screen-reward' ? screen.querySelector('#btn-finish') : null;
      if (btn) { last = { src: 'key', t: Date.now() }; btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); e.preventDefault(); }
    }
  });

  // ---- ゲームパッド（接続中だけポーリング） ----
  const prev = new Map(); // gamepad.index → 前回の押下配列
  let timer = null;
  // rAF でなく setInterval で回す: 非表示タブ・ヘッドレス検証（仮想時間）でも止まらない。20ms = 実用上十分
  function poll() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (!pads.length) { clearInterval(timer); timer = null; prev.clear(); return; }
    for (const gp of pads) {
      const was = prev.get(gp.index) || [];
      const now = gp.buttons.map(b => b.pressed);
      now.forEach((p, i) => { if (p && !was[i] && i < 9) press(i, 'pad'); });
      prev.set(gp.index, now);
    }
  }
  window.addEventListener('gamepadconnected', () => { if (!timer) timer = setInterval(poll, 20); });
  window.addEventListener('gamepaddisconnected', () => { /* 次の poll で pads が空になり自然に止まる */ });

  return { press, lastSource, targets };
})();

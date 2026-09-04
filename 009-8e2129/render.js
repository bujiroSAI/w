/* render.js — 台の描画（枠・データランプ・盤面・玉・役物・皿・ハンドル）。座標は「台の単位」(≒mm)。 */
(function (root) {
  'use strict';
  const LAYOUT = {
    W: 560, H: 880,
    counter: { x: 20, y: 6, w: 520, h: 70 },
    board: { x: 50, y: 96, w: 460, h: 480 },
    upperTray: { x: 70, y: 592, w: 330, h: 68 },
    lowerTray: { x: 70, y: 674, w: 330, h: 70 },
    chance: { x: 150, y: 626, r: 24 },
    lend: { x: 432, y: 606, r: 12 }, ret: { x: 476, y: 606, r: 12 },
    handle: { x: 478, y: 790, r: 58 }, stop: { x: 478, y: 722, r: 11 },
  };

  function sprite(size, fn) { const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size); return c; }

  class Renderer {
    constructor(canvas, world, L, game, lcd) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.world = world; this.L = L; this.game = game; this.lcd = lcd;
      this.scale = 1; this.dpr = 1; this.ox = 0; this.oy = 0;
      this.staticLayer = null; this.t = 0;
      this.ballSprite = sprite(64, (g, s) => {
        const r = s / 2 - 1; const grd = g.createRadialGradient(s * 0.36, s * 0.34, r * 0.1, s / 2, s / 2, r);
        grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, '#e6ebf2'); grd.addColorStop(0.6, '#9aa3b0'); grd.addColorStop(0.85, '#5b6470'); grd.addColorStop(1, '#2b3038');
        g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, r, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(s * 0.38, s * 0.3, r * 0.22, r * 0.14, -0.6, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(s * 0.62, s * 0.74, r * 0.25, r * 0.1, 0.5, 0, 6.283); g.fill();
      });
      this.nailSprite = sprite(24, (g, s) => {
        const grd = g.createRadialGradient(s * 0.4, s * 0.38, 1, s / 2, s / 2, s / 2 - 1);
        grd.addColorStop(0, '#fff3c4'); grd.addColorStop(0.5, '#d4a53a'); grd.addColorStop(1, '#6b4a10');
        g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1.5, 0, 6.283); g.fill();
      });
    }

    resize() {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
      if (!cw || !ch) return;
      this.dpr = dpr; this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr);
      this.scale = Math.min(cw / LAYOUT.W, ch / LAYOUT.H);
      this.ox = (cw - LAYOUT.W * this.scale) / 2; this.oy = (ch - LAYOUT.H * this.scale) / 2;
      this.buildStatic();
    }
    // 画面px → 台の単位
    toMachine(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }

    setTransform(ctx) { ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy); }

    // ---- 静的レイヤー（枠・盤面の動かない部分） ----
    buildStatic() {
      const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height;
      const g = c.getContext('2d'); this.setTransform(g);
      const LY = LAYOUT, bd = LY.board;
      // 背景（枠の外）
      g.fillStyle = '#0b0b10'; g.fillRect(-2000, -2000, 5000, 5000);
      // 枠本体
      roundRect(g, 8, 82, LY.W - 16, LY.H - 90, 22); const fg = g.createLinearGradient(0, 80, 0, LY.H); fg.addColorStop(0, '#2a1f3d'); fg.addColorStop(0.5, '#1c1430'); fg.addColorStop(1, '#0f0b1c'); g.fillStyle = fg; g.fill();
      g.strokeStyle = '#8a6d2e'; g.lineWidth = 3; g.stroke();
      roundRect(g, 16, 90, LY.W - 32, LY.H - 106, 18); g.strokeStyle = 'rgba(255,215,120,0.25)'; g.lineWidth = 1.5; g.stroke();
      // データランプ台座
      roundRect(g, LY.counter.x, LY.counter.y, LY.counter.w, LY.counter.h, 8); g.fillStyle = '#141414'; g.fill(); g.strokeStyle = '#444'; g.lineWidth = 2; g.stroke();
      // 盤面窓の縁
      roundRect(g, bd.x - 8, bd.y - 8, bd.w + 16, bd.h + 16, 14); g.fillStyle = '#3a2a10'; g.fill();
      const bez = g.createLinearGradient(bd.x, bd.y, bd.x + bd.w, bd.y + bd.h); bez.addColorStop(0, '#e8c56a'); bez.addColorStop(0.5, '#8a6a22'); bez.addColorStop(1, '#f0d27a'); g.strokeStyle = bez; g.lineWidth = 5; g.stroke();
      // 盤面
      g.save(); g.translate(bd.x, bd.y); this.drawBoardStatic(g); g.restore();
      // 上皿・下皿
      this.drawTrayBase(g, LY.upperTray, '上皿'); this.drawTrayBase(g, LY.lowerTray, '下皿');
      // ボタン台座
      for (const b of [LY.lend, LY.ret]) { g.beginPath(); g.arc(b.x, b.y, b.r + 4, 0, 6.283); g.fillStyle = '#222'; g.fill(); }
      g.fillStyle = '#ccc'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText('玉貸', LY.lend.x, LY.lend.y + 24); g.fillText('返却', LY.ret.x, LY.ret.y + 24);
      // ハンドル台座
      const h = LY.handle; g.beginPath(); g.arc(h.x, h.y, h.r + 14, 0, 6.283); g.fillStyle = '#15121f'; g.fill(); g.strokeStyle = '#6b5a2a'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#9a8a5a'; g.font = '9px sans-serif'; g.textAlign = 'center'; g.fillText('弱', h.x - h.r - 22, h.y + 10); g.fillText('強', h.x + h.r + 22, h.y + 10);
      // 銘板
      g.fillStyle = '#c9b06a'; g.font = 'bold 13px serif'; g.textAlign = 'left'; g.fillText(this.game.spec.label, 90, LY.H - 40);
      g.fillStyle = '#7a6a45'; g.font = '9px sans-serif'; g.fillText(`大当り確率 1/${(1 / this.game.spec.pLow).toFixed(1)} → 1/${(1 / this.game.spec.pHigh).toFixed(1)}　賞球 ${this.game.spec.payout.heso}&${this.game.spec.payout.dencyu}&${this.game.spec.payout.general}&${this.game.spec.payout.attacker}　${this.game.spec.attackerCount}C`, 90, LY.H - 24);
      this.staticLayer = c;
    }

    drawBoardStatic(g) {
      const L = this.L, B = L.board, w = this.world;
      // 遊技盤の面: 外側（レールの外）は暗い化粧板、内側（遊技領域）は印刷面
      const outer = g.createLinearGradient(0, 0, 460, 480); outer.addColorStop(0, '#1a1024'); outer.addColorStop(1, '#0d0816'); g.fillStyle = outer; g.fillRect(0, 0, 460, 480);
      g.save();
      g.beginPath(); g.arc(B.cx, B.cy, B.rOut, Math.PI, 2 * Math.PI); g.lineTo(B.cx + B.rOut, 480); g.lineTo(B.cx - B.rOut, 480); g.closePath(); g.clip();
      const bg = g.createRadialGradient(230, 200, 20, 230, 240, 300); bg.addColorStop(0, '#2b2f6b'); bg.addColorStop(0.5, '#171a45'); bg.addColorStop(1, '#0a0b22'); g.fillStyle = bg; g.fillRect(0, 0, 460, 480);
      // 盤面の印刷装飾（波紋）
      g.strokeStyle = 'rgba(120,160,255,0.10)'; g.lineWidth = 1;
      for (let r = 40; r < 320; r += 26) { g.beginPath(); g.arc(230, 250, r, 0, 6.283); g.stroke(); }
      g.strokeStyle = 'rgba(255,200,90,0.12)';
      for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(230, 250); const a = i / 12 * 6.283; g.lineTo(230 + 400 * Math.cos(a), 250 + 400 * Math.sin(a)); g.stroke(); }
      g.restore();
      // レール類（線分を鋼色で）
      for (const s of w.segments) {
        let col = '#9aa3b4', lw = 2.2;
        if (s.tag === 'rail') { col = '#c8ced8'; lw = 3; }
        else if (s.tag === 'floor') { col = '#6c7484'; lw = 3; }
        else if (s.tag === 'frame') { continue; }
        else if (s.tag === 'warp') { col = 'rgba(140,220,255,0.55)'; lw = 1.6; }
        else if (s.tag === 'stage') { col = 'rgba(180,240,255,0.7)'; lw = 2; }
        else if (s.tag === 'michi') { continue; }
        else if (s.tag === 'flap') { col = '#e0b050'; lw = 2; }
        else if (s.tag === 'divider') { col = 'rgba(200,210,230,0.7)'; lw = 2; }
        else if (s.tag === 'gate') { col = '#7fd0ff'; lw = 2; }
        else if (s.tag === 'pocket' || s.tag === 'tulip' || s.tag === 'attacker') { col = '#d8d0c0'; lw = 1.8; }
        g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
      }
      // センター役物（液晶枠）
      const F = L.frame;
      g.beginPath(); g.moveTo(F.eaveL[0], F.eaveL[1]); g.lineTo(F.apex[0], F.apex[1]); g.lineTo(F.eaveR[0], F.eaveR[1]); g.lineTo(F.wallR, F.wallBot); g.lineTo(F.wallL, F.wallBot); g.closePath();
      const fr = g.createLinearGradient(F.wallL, 90, F.wallR, 270); fr.addColorStop(0, '#6b1e1e'); fr.addColorStop(0.5, '#3a0f14'); fr.addColorStop(1, '#5a1a1a'); g.fillStyle = fr; g.fill();
      g.strokeStyle = '#e3b455'; g.lineWidth = 3; g.stroke();
      // 液晶（黒）— 中身は毎フレーム
      const R = this.lcdRect(); roundRect(g, R.x, R.y, R.w, R.h, 3); g.fillStyle = '#000'; g.fill(); g.strokeStyle = '#222'; g.lineWidth = 1; g.stroke();
      // ワープ入口の目印
      g.fillStyle = 'rgba(140,220,255,0.35)'; g.fillRect(F.wallL - 1, F.warpY0, 4, F.warpY1 - F.warpY0);
      g.fillStyle = '#9fe0ff'; g.font = '6px sans-serif'; g.textAlign = 'right'; g.fillText('WARP', F.wallL - 3, F.warpY0 - 2);
      // ステージの皿（半透明）
      g.beginPath(); g.moveTo(F.wallL, 272); for (const p of L.stageL) g.lineTo(p[0], p[1]); g.lineTo(223, 304); g.lineTo(237, 304); for (const p of L.stageR) g.lineTo(p[0], p[1]); g.lineTo(F.wallR, 296); g.lineTo(F.wallL, 296); g.closePath();
      g.fillStyle = 'rgba(120,200,255,0.16)'; g.fill();
      // 釘
      for (const n of L.nails) g.drawImage(this.nailSprite, n.x - 2.2, n.y - 2.2, 4.4, 4.4);
      // 入賞口の装飾とラベル
      for (const p of L.pockets) {
        const col = p.kind === 'start' ? '#ffd24a' : '#7cf0c8';
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(p.x - p.w / 2, p.y, p.w, 12);
        g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(p.x - p.w / 2, p.y - 4, p.w, 16);
        if (p.kind === 'start') { g.fillStyle = col; g.font = 'bold 6px sans-serif'; g.textAlign = 'center'; g.fillText('START', p.x, p.y + 22); }
      }
      // 電チュー本体・アタッカー本体
      const T = L.tulip; g.fillStyle = '#301a30'; g.fillRect(T.x - T.half - 1, T.bodyTop, T.half * 2 + 2, T.bodyBot - T.bodyTop); g.strokeStyle = '#f08aff'; g.lineWidth = 1; g.strokeRect(T.x - T.half - 1, T.bodyTop, T.half * 2 + 2, T.bodyBot - T.bodyTop);
      g.fillStyle = '#f0a8ff'; g.font = 'bold 5px sans-serif'; g.textAlign = 'center'; g.fillText('電チュー', T.x, T.bodyBot + 7);
      const A = L.attacker; g.fillStyle = '#3a1010'; g.fillRect(A.x1, A.top, A.x2 - A.x1, A.bot - A.top); g.strokeStyle = '#ff7a5a'; g.lineWidth = 1.2; g.strokeRect(A.x1, A.top, A.x2 - A.x1, A.bot - A.top);
      g.fillStyle = '#ffb090'; g.font = 'bold 6px sans-serif'; g.fillText('大入賞口', (A.x1 + A.x2) / 2, A.bot + 8);
      // ゲート
      const G = L.gate; g.fillStyle = 'rgba(127,208,255,0.25)'; g.fillRect(G.x, G.y, G.w, G.h); g.fillStyle = '#bfe8ff'; g.font = '5px sans-serif'; g.fillText('GATE', G.x + G.w / 2, G.y - 2);
      // アウト口
      g.fillStyle = '#000'; g.fillRect(212, 470, 36, 10); g.fillStyle = '#666'; g.font = '5px sans-serif'; g.fillText('OUT', 230, 468);
      // 風車の軸台
      for (const s of L.spinners) { g.beginPath(); g.arc(s.x, s.y, s.r + 1.5, 0, 6.283); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill(); }
    }

    lcdRect() { const F = this.L.frame; return { x: F.wallL + 6, y: F.eaveL[1] + 8, w: F.wallR - F.wallL - 12, h: F.wallBot - F.eaveL[1] - 14 }; }

    drawTrayBase(g, r, label) {
      roundRect(g, r.x, r.y, r.w, r.h, 16); const grd = g.createLinearGradient(0, r.y, 0, r.y + r.h); grd.addColorStop(0, '#3d3352'); grd.addColorStop(1, '#1a1426'); g.fillStyle = grd; g.fill(); g.strokeStyle = '#8a7a4a'; g.lineWidth = 2; g.stroke();
      roundRect(g, r.x + 8, r.y + 8, r.w - 16, r.h - 16, 12); g.fillStyle = '#0e0a16'; g.fill();
      g.fillStyle = '#9a8a5a'; g.font = '9px sans-serif'; g.textAlign = 'left'; g.fillText(label, r.x + 10, r.y - 3);
    }

    // ---- 毎フレーム ----
    draw(dt) {
      this.t += dt;
      const ctx = this.ctx, LY = LAYOUT, game = this.game;
      if (!this.staticLayer) this.resize();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.staticLayer, 0, 0);
      this.setTransform(ctx);
      this.drawCounter(ctx);
      this.drawFrameLamps(ctx);
      // 盤面の動くもの
      ctx.save(); ctx.translate(LY.board.x, LY.board.y);
      ctx.beginPath(); ctx.rect(-6, -6, 472, 492); ctx.clip();
      this.drawBoardDynamic(ctx, dt);
      ctx.restore();
      this.drawTrays(ctx);
      this.drawHandle(ctx);
      this.drawButtons(ctx);
    }

    drawBoardDynamic(g, dt) {
      const L = this.L, w = this.world, game = this.game, t = this.t;
      // 液晶
      const R = this.lcdRect(); this.lcd.draw(g, R, game, t, dt);
      // ランプ（入賞口の光）
      const lamp = (x, y, r, col, v) => { if (v <= 0) return; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = col; g.globalAlpha = Math.min(1, v * 2); g.fill(); g.globalAlpha = 1; };
      for (const p of L.pockets) lamp(p.x, p.y + 6, 9, p.kind === 'start' ? '#ffd24a' : '#7cf0c8', game.lamps[p.id]);
      const T = L.tulip; lamp(T.x, T.bodyTop + 8, 10, '#f08aff', game.lamps.dencyu);
      const A = L.attacker; lamp((A.x1 + A.x2) / 2, A.top + 8, 22, '#ff8a5a', game.lamps.attacker);
      const G = L.gate; lamp(G.x + G.w / 2, G.y + G.h / 2, 12, '#7fd0ff', game.lamps.gate);
      // 電チューの羽根
      const tul = w.dynamic.tulip || [];
      for (const s of tul) { g.strokeStyle = game.tulipOpen ? '#ff9cff' : '#c070d0'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); }
      if (game.tulipOpen) { g.fillStyle = 'rgba(255,140,255,0.25)'; g.fillRect(T.x - T.half, T.bodyTop - 4, T.half * 2, 8); }
      // アタッカー（開: 前に倒れた蓋を描く／閉: 蓋）
      if (game.attackerOpen) {
        g.fillStyle = 'rgba(255,120,80,0.35)'; g.fillRect(A.x1, A.top - 6, A.x2 - A.x1, A.bot - A.top + 6);
        g.strokeStyle = '#ffd0b0'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(A.x1, A.top); g.lineTo(A.x1 - 10, A.top + 14); g.stroke();
        if (game.jackpot && game.jackpot.stage === 'round') { g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText(`${game.jackpot.roundBalls}/${game.spec.attackerCount}`, (A.x1 + A.x2) / 2, A.top - 8); }
      } else {
        const cov = (w.dynamic.attacker || [])[0];
        if (cov) { g.strokeStyle = '#b03030'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(cov.x1, cov.y1); g.lineTo(cov.x2, cov.y2); g.stroke(); }
      }
      // 風車
      for (const s of w.spinners) {
        g.save(); g.translate(s.x, s.y); g.rotate(s.angle);
        for (let i = 0; i < s.blades; i++) { g.rotate(6.283 / s.blades); g.fillStyle = i % 2 ? '#ff5a5a' : '#ffe066'; g.beginPath(); g.moveTo(0, 0); g.lineTo(s.r, -2.2); g.lineTo(s.r, 2.2); g.closePath(); g.fill(); }
        g.beginPath(); g.arc(0, 0, 2.5, 0, 6.283); g.fillStyle = '#ddd'; g.fill(); g.restore();
      }
      // 道釘は釘を上に重ねる（玉がレールの上を転がって見えるように）
      // 玉
      const sp = this.ballSprite, d = 11.6;
      for (const b of w.balls) {
        g.globalAlpha = 0.35; g.fillStyle = '#000'; g.beginPath(); g.arc(b.x + 1.2, b.y + 1.6, 5.4, 0, 6.283); g.fill(); g.globalAlpha = 1;
        g.drawImage(sp, b.x - d / 2, b.y - d / 2, d, d);
      }
      // 右打ち/左打ち矢印（盤面上に点滅）
      if (game.wantRight() && Math.floor(t * 3) % 2 === 0) { g.fillStyle = '#ffe14a'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillText('→ 右打ち →', 400, 60); }
      // ガラスの反射
      const gl = g.createLinearGradient(0, 0, 460, 480); gl.addColorStop(0, 'rgba(255,255,255,0.10)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.02)'); gl.addColorStop(0.6, 'rgba(255,255,255,0.0)'); gl.addColorStop(1, 'rgba(255,255,255,0.06)');
      g.fillStyle = gl; g.fillRect(0, 0, 460, 480);
    }

    drawCounter(g) {
      const C = LAYOUT.counter, st = this.game.stats, game = this.game;
      g.save(); g.translate(C.x, C.y);
      const seg = (label, val, x, w, col) => {
        g.fillStyle = '#888'; g.font = '8px sans-serif'; g.textAlign = 'left'; g.fillText(label, x + 4, 12);
        g.fillStyle = '#1a0000'; g.fillRect(x + 2, 15, w - 4, 28);
        g.fillStyle = col || '#ff3b2f'; g.font = 'bold 22px "Courier New", monospace'; g.textAlign = 'right'; g.fillText(String(val), x + w - 6, 38);
      };
      seg('大当り', st.hits, 0, 70); seg('初当り', st.firstHits, 72, 62); seg('回転', st.sinceHit, 136, 74, '#ffb02f'); seg('前回', st.history[0] != null ? st.history[0] : '-', 212, 62); seg('前々回', st.history[1] != null ? st.history[1] : '-', 276, 62); seg('連荘', st.renchan, 340, 52, '#5aff6a'); seg('総回転', st.totalSpins, 394, 66);
      // スランプグラフ（差玉）
      const gx = 464, gw = 54, gy = 15, gh = 28; g.fillStyle = '#101010'; g.fillRect(gx, gy, gw, gh);
      const sl = st.slump; if (sl.length > 1) {
        let mn = Math.min(0, ...sl), mx = Math.max(0, ...sl); if (mx - mn < 200) { mx += 100; mn -= 100; }
        const yOf = v => gy + gh - (v - mn) / (mx - mn) * gh;
        g.strokeStyle = '#444'; g.beginPath(); g.moveTo(gx, yOf(0)); g.lineTo(gx + gw, yOf(0)); g.stroke();
        g.strokeStyle = sl[sl.length - 1] >= 0 ? '#5aff6a' : '#ff5a5a'; g.lineWidth = 1.2; g.beginPath();
        sl.forEach((v, i) => { const x = gx + i / (sl.length - 1) * gw; i ? g.lineTo(x, yOf(v)) : g.moveTo(x, yOf(v)); }); g.stroke();
      }
      g.fillStyle = '#888'; g.font = '8px sans-serif'; g.textAlign = 'left'; g.fillText('差玉', gx + 2, 12);
      // 状態行
      g.fillStyle = game.mode === 'kakuhen' ? '#ff6a6a' : game.mode === 'jitan' ? '#c58aff' : '#8fd3ff'; g.font = 'bold 10px sans-serif'; g.textAlign = 'left';
      const modeTxt = game.phase === 'jackpot' ? `大当り中 ${game.jackpot.type.name}` : game.mode === 'kakuhen' ? `確変中 ST残り${game.stLeft}回` : game.mode === 'jitan' ? `時短中 残り${game.jitanLeft}回` : '通常';
      g.fillText(modeTxt, 4, 60);
      g.fillStyle = '#aaa'; g.font = '9px sans-serif'; g.textAlign = 'right';
      g.fillText(`最高連荘 ${st.maxRenchan}　出玉 ${st.totalOut}　持ち玉 ${game.totalBalls()}　差玉 ${game.diff() >= 0 ? '+' : ''}${game.diff()}`, C.w - 4, 60);
      g.restore();
    }

    drawFrameLamps(g) {
      const game = this.game, t = this.t, LY = LAYOUT;
      const mode = game.phase === 'jackpot' ? 3 : game.spin && game.spin.reach ? 2 : game.mode !== 'normal' ? 1 : 0;
      const speed = [0.6, 2.0, 3.5, 6][mode];
      const pts = [];
      for (let y = 112; y <= 560; y += 34) { pts.push([30, y]); pts.push([530, y]); }
      for (let x = 60; x <= 500; x += 40) pts.push([x, 88]);
      pts.forEach((p, i) => {
        const ph = (t * speed + i * 0.35) % 1;
        const hue = mode === 3 ? (t * 200 + i * 30) % 360 : mode === 1 ? 0 : mode === 2 ? 45 : 265;
        const a = mode === 0 ? 0.25 + 0.2 * Math.sin(ph * 6.283) : 0.25 + 0.75 * Math.max(0, Math.sin(ph * 6.283));
        g.fillStyle = `hsla(${hue},95%,60%,${a})`; g.beginPath(); g.arc(p[0], p[1], 4.5, 0, 6.283); g.fill();
        if (a > 0.7) { g.fillStyle = `hsla(${hue},95%,75%,${(a - 0.7) * 0.8})`; g.beginPath(); g.arc(p[0], p[1], 9, 0, 6.283); g.fill(); }
      });
    }

    drawTrays(g) {
      const game = this.game, LY = LAYOUT;
      const heap = (r, n, cap) => {
        const cols = Math.floor((r.w - 24) / 9), rows = 3;
        let k = Math.min(cap, n); const d = 9;
        for (let i = 0; i < k; i++) { const row = Math.floor(i / cols), col = i % cols; if (row >= rows) break; g.drawImage(this.ballSprite, r.x + 12 + col * d + (row % 2) * 4, r.y + r.h - 16 - row * 7, d, d); }
        g.fillStyle = '#ffd24a'; g.font = 'bold 14px "Courier New", monospace'; g.textAlign = 'right'; g.fillText(String(n), r.x + r.w - 12, r.y + 24);
      };
      heap(LY.upperTray, game.balls.tray, 120); heap(LY.lowerTray, game.balls.lower, 96);
      if (game.balls.box > 0) { g.fillStyle = '#e0c070'; g.font = 'bold 12px sans-serif'; g.textAlign = 'left'; g.fillText(`箱 ${game.balls.box}玉`, LY.lowerTray.x + LY.lowerTray.w + 12, LY.lowerTray.y + 30); }
      if (game.balls.tray === 0 && (game.balls.lower > 0 || game.balls.box > 0) && Math.floor(this.t * 2) % 2 === 0) { g.fillStyle = '#ff8a8a'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('上皿が空です — 下皿→上皿', LY.upperTray.x + LY.upperTray.w / 2, LY.upperTray.y + 40); }
      else if (game.totalBalls() === 0 && Math.floor(this.t * 2) % 2 === 0) { g.fillStyle = '#ffd24a'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('玉がありません — 玉貸ボタン', LY.upperTray.x + LY.upperTray.w / 2, LY.upperTray.y + 40); }
    }

    drawHandle(g) {
      const h = LAYOUT.handle, s = this.game.launch.strength;
      g.save(); g.translate(h.x, h.y);
      // 目盛り
      for (let i = 0; i <= 10; i++) { const a = Math.PI + i / 10 * Math.PI; g.strokeStyle = i === 0 || i === 10 ? '#c9b06a' : '#6b5a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo((h.r + 6) * Math.cos(a), (h.r + 6) * Math.sin(a)); g.lineTo((h.r + 11) * Math.cos(a), (h.r + 11) * Math.sin(a)); g.stroke(); }
      g.rotate(Math.PI * s - Math.PI / 2);
      const grd = g.createRadialGradient(-10, -14, 6, 0, 0, h.r); grd.addColorStop(0, '#5a4a7a'); grd.addColorStop(0.7, '#2a1f3d'); grd.addColorStop(1, '#120c1c');
      g.beginPath(); g.arc(0, 0, h.r, 0, 6.283); g.fillStyle = grd; g.fill(); g.strokeStyle = '#a08a4a'; g.lineWidth = 3; g.stroke();
      // 指掛け（3枚の羽根）
      for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * 2.094 - Math.PI / 2); g.fillStyle = '#c9b06a'; roundRect(g, -7, -h.r + 4, 14, 28, 6); g.fill(); g.restore(); }
      g.beginPath(); g.arc(0, 0, 14, 0, 6.283); g.fillStyle = '#e8d090'; g.fill();
      g.restore();
      g.fillStyle = '#ffd24a'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText(`${Math.round(s * 100)}%`, h.x, h.y + h.r + 26);
      // ストップボタン
      const st = LAYOUT.stop; g.beginPath(); g.arc(st.x, st.y, st.r, 0, 6.283); g.fillStyle = this.game.launch.stop ? '#ff3030' : '#8a1a1a'; g.fill(); g.strokeStyle = '#ffb0b0'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 7px sans-serif'; g.fillText('STOP', st.x, st.y + 2.5);
    }

    drawButtons(g) {
      const LY = LAYOUT, game = this.game, t = this.t;
      // チャンスボタン（演出中は光る）
      const c = LY.chance, hot = game.buttonHot();
      const grd = g.createRadialGradient(c.x - 6, c.y - 8, 4, c.x, c.y, c.r); grd.addColorStop(0, hot ? '#fff' : '#ff8080'); grd.addColorStop(1, hot ? '#ff2020' : '#7a1010');
      g.beginPath(); g.arc(c.x, c.y, c.r, 0, 6.283); g.fillStyle = grd; g.fill(); g.strokeStyle = '#ffd0d0'; g.lineWidth = 2; g.stroke();
      if (hot) { g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12); g.beginPath(); g.arc(c.x, c.y, c.r + 6, 0, 6.283); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.globalAlpha = 1; }
      g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText('PUSH', c.x, c.y + 3);
      for (const [b, col] of [[LY.lend, '#3a9a3a'], [LY.ret, '#3a6a9a']]) { g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.283); g.fillStyle = col; g.fill(); g.strokeStyle = '#ddd'; g.lineWidth = 1.5; g.stroke(); }
      // 残高表示（サンド）
      g.fillStyle = '#0a1a0a'; g.fillRect(410, 640, 92, 18); g.fillStyle = '#5aff6a'; g.font = 'bold 12px "Courier New", monospace'; g.textAlign = 'right'; g.fillText(`¥${game.money.balance}`, 498, 654); g.fillStyle = '#8a8'; g.font = '7px sans-serif'; g.textAlign = 'left'; g.fillText('残高', 412, 652);
    }
  }

  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  root.PachiRender = { Renderer, LAYOUT, roundRect };
})(typeof window !== 'undefined' ? window : globalThis);

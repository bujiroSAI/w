/* lcd.js — 液晶演出（図柄リール・予告・リーチ・大当り画面・保留表示）。描画面は 180×136 の論理座標。 */
(function (root) {
  'use strict';
  const W = 180, H = 136;
  const LV_COLOR = ['#ffffff', '#3d8bff', '#2fd36a', '#ff3b3b', '#ffd400', null]; // 5=虹
  const LV_TEXT = ['チャンス', 'チャンスアップ', '期待大！', '激アツ!!', '超激アツ!!!', 'PREMIUM'];
  const FIG_COLOR = { 1: '#4fc3f7', 2: '#a5d6a7', 3: '#ffb74d', 4: '#90caf9', 5: '#f48fb1', 6: '#b39ddb', 7: '#ff5252', 8: '#80cbc4', 9: '#ffd54f' };

  class LCD {
    constructor() { this.flash = 0; this.shake = 0; this.particles = []; }

    draw(g, R, game, t, dt) {
      g.save();
      g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
      g.translate(R.x, R.y); g.scale(R.w / W, R.h / H);
      const sp = game.spin, jp = game.jackpot;
      let shake = 0;
      if (sp) { const e = this.activeFx(sp, 'spsp'); if (e) shake = 1.5; }
      if (shake) g.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
      this.drawBackground(g, game, t);
      if (jp) this.drawJackpot(g, game, t);
      else { this.drawReels(g, game, t); if (sp) this.drawFx(g, game, t, dt); }
      this.drawHud(g, game, t);
      g.restore();
    }

    activeFx(sp, type) { for (const e of sp.fx) if (e.type === type && sp.t >= e.t && sp.t < e.t + e.dur) return e; return null; }
    isReaching(sp) { return sp && sp.reach && sp.t >= sp.stopT[1]; }

    drawBackground(g, game, t) {
      const sp = game.spin, jp = game.jackpot;
      let c0 = '#0a1a4a', c1 = '#03071c', hue = 220;
      if (jp) { c0 = '#5a3a00'; c1 = '#1a0f00'; hue = 45; }
      else if (game.mode === 'kakuhen') { c0 = '#5a0a14'; c1 = '#140205'; hue = 350; }
      else if (game.mode === 'jitan') { c0 = '#2a0a4a'; c1 = '#0a0214'; hue = 275; }
      if (sp && this.isReaching(sp) && sp.sp >= 2) { c0 = '#2a0a2a'; c1 = '#050005'; hue = 300; }
      if (sp && sp.premium && sp.t > 1.2) { const h = (t * 120) % 360; c0 = `hsl(${h},80%,35%)`; c1 = `hsl(${(h + 60) % 360},80%,15%)`; }
      const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, c0); grd.addColorStop(1, c1); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      // 光の筋（モードで速さが変わる）
      const speed = jp ? 60 : game.mode !== 'normal' ? 40 : 12;
      g.globalAlpha = 0.18;
      for (let i = 0; i < 6; i++) { const x = ((t * speed + i * 37) % (W + 60)) - 30; g.fillStyle = `hsl(${hue},80%,70%)`; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 14, 0); g.lineTo(x - 20, H); g.lineTo(x - 34, H); g.closePath(); g.fill(); }
      g.globalAlpha = 1;
      // リーチ中はスポットライト
      if (sp && this.isReaching(sp)) { const rg = g.createRadialGradient(W / 2, H * 0.45, 5, W / 2, H * 0.45, 90); rg.addColorStop(0, 'rgba(255,255,255,0.18)'); rg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    }

    reelPos(sp, i, t) { // 図柄ストリップ上の位置（図柄単位・連続値）
      const stop = sp.stopT[i], speed = 14, target = sp.figures[i] - 1;
      let tgt = target;
      if (i === 1 && sp.revival && sp.t < sp.stopT[2] + 2.0) tgt = sp.missFigure - 1;
      const pre = Math.max(0.3, stop - 0.55);
      if (sp.t < pre) return { p: sp.t * speed, spinning: true };
      const pFree = pre * speed;
      let D = ((tgt - pFree) % 9 + 9) % 9 + 9; // 最低1周してから止まる
      if (sp.t < stop) { const u = (sp.t - pre) / (stop - pre); return { p: pFree + D * (1 - (1 - u) * (1 - u)), spinning: true, slowing: true }; }
      const dtS = sp.t - stop; const bounce = 0.18 * Math.sin(dtS * 22) * Math.exp(-dtS * 7);
      return { p: tgt + bounce, spinning: false, stopped: dtS };
    }

    drawFigure(g, n, x, y, size, alpha, glow) {
      g.save(); g.globalAlpha = alpha; g.translate(x, y);
      if (glow) { g.shadowColor = glow; g.shadowBlur = 8; }
      g.beginPath(); g.arc(0, 0, size / 2, 0, 6.283); g.fillStyle = FIG_COLOR[n] || '#fff'; g.fill();
      g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = n === 7 ? '#fff' : '#111'; g.font = `bold ${size * 0.72}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 0, 1);
      g.restore();
    }

    drawReels(g, game, t) {
      const sp = game.spin;
      const xs = [W * 0.24, W * 0.5, W * 0.76], cy = H * 0.5, size = 30, cell = 34;
      const figs = sp ? null : (game.lastResult ? game.lastResult.figures : [7, 3, 7]);
      for (let i = 0; i < 3; i++) {
        g.save(); g.beginPath(); g.rect(xs[i] - 22, cy - 42, 44, 84); g.clip();
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(xs[i] - 22, cy - 42, 44, 84);
        if (!sp) { this.drawFigure(g, figs[i], xs[i], cy, size, 1, game.lastResult && game.lastResult.win ? '#ffd400' : null); g.restore(); continue; }
        const rp = this.reelPos(sp, i, t);
        const k = Math.floor(rp.p), f = rp.p - k;
        for (let d = -1; d <= 2; d++) {
          const n = ((k + d) % 9 + 9) % 9 + 1, y = cy + (d - f) * cell;
          const a = rp.spinning && !rp.slowing ? 0.55 : 1;
          this.drawFigure(g, n, xs[i], y, size, a * (d === 0 || d === 1 ? 1 : 0.5), (!rp.spinning && sp.win && sp.t > sp.stopT[2]) ? '#ffd400' : null);
        }
        if (rp.spinning && !rp.slowing) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(xs[i] - 22, cy - 42, 44, 84); }
        g.restore();
        if (!sp.reach || i === 1) continue;
        // テンパイ図柄の枠
        if (!rp.spinning) { g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.strokeRect(xs[i] - 21, cy - 20, 42, 40); }
      }
      // 当たりライン
      g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 1; g.beginPath(); g.moveTo(10, cy); g.lineTo(W - 10, cy); g.stroke();
      // 大当り確定表示
      if (sp && sp.win && sp.t > (sp.revival ? sp.stopT[2] + 2.0 : sp.stopT[2]) + 0.1) this.bigText(g, '大当り!!', W / 2, H * 0.22, 22, '#ffd400', t, true);
      else if (sp && !sp.win && sp.reach && sp.t > sp.stopT[2] + 0.1) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText('残念…', W / 2, H * 0.22); }
    }

    bigText(g, text, x, y, size, col, t, pulse) {
      g.save(); g.translate(x, y); const s = pulse ? 1 + 0.08 * Math.sin(t * 14) : 1; g.scale(s, s);
      g.font = `bold ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, 0, 0); g.fillStyle = col; g.fillText(text, 0, 0); g.restore();
    }

    drawFx(g, game, t, dt) {
      const sp = game.spin;
      for (const e of sp.fx) {
        if (sp.t < e.t || sp.t >= e.t + e.dur) continue;
        const u = (sp.t - e.t) / e.dur;
        switch (e.type) {
          case 'step': { g.fillStyle = '#ffd400'; g.font = 'bold 9px sans-serif'; g.textAlign = 'left'; g.fillText('★'.repeat(e.level) + ' STEP' + e.level, 6, 14); break; }
          case 'cutin': {
            const col = e.level === 5 ? `hsl(${(t * 300) % 360},90%,60%)` : LV_COLOR[e.level];
            const x = u < 0.15 ? -W + (u / 0.15) * W : u > 0.85 ? ((u - 0.85) / 0.15) * W : 0;
            g.save(); g.translate(x, 0); g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, H * 0.36, W, 30); g.fillStyle = col; g.fillRect(0, H * 0.36, W, 3); g.fillRect(0, H * 0.36 + 27, W, 3);
            this.bigText(g, LV_TEXT[e.level], W / 2, H * 0.36 + 15, e.level >= 3 ? 16 : 13, col, t, e.level >= 4); g.restore();
            if (u < 0.2 && e.level >= 3) { g.fillStyle = `rgba(255,255,255,${(0.2 - u) * 2})`; g.fillRect(0, 0, W, H); }
            break;
          }
          case 'group': { for (let i = 0; i < 24; i++) { const x = W + 40 - u * (W + 120) + (i % 6) * 22, y = 12 + Math.floor(i / 6) * 26 + Math.sin(t * 6 + i) * 6; g.fillStyle = i % 2 ? '#ffd400' : '#ff7a3b'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('★', x, y); } this.bigText(g, '群予告!!', W / 2, H * 0.8, 12, '#ff9a3b', t, true); break; }
          case 'reach': { const s = Math.min(1, u * 4); g.save(); g.translate(W / 2, H * 0.18); g.scale(s, s); this.bigText(g, e.rush ? 'CHANCE' : 'リーチ！', 0, 0, 20, '#ff3b3b', t, false); g.restore(); break; }
          case 'sp': { g.fillStyle = `rgba(80,0,120,${0.6 * (1 - u)})`; g.fillRect(0, 0, W, H); this.bigText(g, e.level >= 3 ? 'SPリーチ発展!!' : 'SPリーチ!', W / 2, H * 0.2, 16, '#c58aff', t, true); break; }
          case 'spsp': { if (Math.floor(t * 8) % 2 === 0) { g.fillStyle = 'rgba(255,0,0,0.25)'; g.fillRect(0, 0, W, H); } this.bigText(g, '激アツ MAX', W / 2, H * 0.2, 18, '#ff2020', t, true); break; }
          case 'countdown': { const n = 3 - Math.floor(u * 3); this.bigText(g, String(n), W * 0.5, H * 0.82, 20, '#fff', t, false); break; }
          case 'premium': { this.bigText(g, 'PREMIUM', W / 2, H * 0.2, 18, '#fff', t, true); break; }
          case 'revival': { if (u < 0.3) { g.fillStyle = `rgba(255,255,255,${1 - u / 0.3})`; g.fillRect(0, 0, W, H); } else this.bigText(g, '復活!!', W / 2, H * 0.22, 22, '#ffd400', t, true); break; }
        }
      }
      // SPリーチ中の演出タイトル（発展後ずっと）
      if (sp.reach && sp.sp >= 2 && sp.t > sp.stopT[1] + 6.5 && sp.t < sp.stopT[2] - 3.2) {
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
        g.fillText(sp.sp === 3 && sp.t > sp.stopT[1] + 16.5 ? '最終決戦' : 'SPリーチ', W / 2, H * 0.86);
      }
      // ボタン演出のプロンプト
      if (game.buttonHot()) this.bigText(g, 'PUSH!', W / 2, H * 0.8, 16, '#ff6060', t, true);
    }

    drawJackpot(g, game, t) {
      const jp = game.jackpot, sp = game.spec;
      if (jp.stage === 'fanfare') {
        const xs = [W * 0.24, W * 0.5, W * 0.76]; for (let i = 0; i < 3; i++) this.drawFigure(g, jp.figures[i], xs[i], H * 0.62, 30, 1, '#ffd400');
        this.bigText(g, '大当り!!', W / 2, H * 0.22, 26, '#ffd400', t, true);
        g.fillStyle = '#fff'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(jp.type.name, W / 2, H * 0.4);
        if (Math.floor(t * 3) % 2 === 0) this.bigText(g, '→ 右打ち →', W / 2, H * 0.9, 12, '#ffe14a', t, false);
      } else if (jp.stage === 'round' || jp.stage === 'interval') {
        this.bigText(g, `ROUND ${jp.round}`, W / 2, H * 0.2, 22, '#ffd400', t, false);
        g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText(`${jp.round} / ${jp.totalRounds}R`, W / 2, H * 0.36);
        // 入賞カウント
        for (let i = 0; i < sp.attackerCount; i++) { g.beginPath(); g.arc(W / 2 - (sp.attackerCount - 1) * 6.5 + i * 13, H * 0.5, 5, 0, 6.283); g.fillStyle = i < jp.roundBalls ? '#ff8a3b' : 'rgba(255,255,255,0.2)'; g.fill(); }
        this.bigText(g, `${jp.payout}発`, W / 2, H * 0.68, 18, '#fff', t, false);
        if (Math.floor(t * 3) % 2 === 0) this.bigText(g, '→ 右打ち →', W / 2, H * 0.9, 12, '#ffe14a', t, false);
      } else if (jp.stage === 'ending') {
        this.bigText(g, `TOTAL ${jp.payout}発`, W / 2, H * 0.28, 16, '#ffd400', t, false);
        const nxt = jp.type.kakuhen ? `RUSH突入！ ST${sp.stCount}回` : `時短${sp.jitanCount}回`;
        this.bigText(g, nxt, W / 2, H * 0.55, 14, jp.type.kakuhen ? '#ff6a6a' : '#c58aff', t, true);
        g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText('右打ち継続', W / 2, H * 0.8);
      }
    }

    drawHud(g, game, t) {
      // モードとST残り
      g.textAlign = 'left'; g.font = 'bold 9px sans-serif';
      if (game.mode === 'kakuhen') { g.fillStyle = '#ff6a6a'; g.fillText('RUSH', 6, 12); g.fillStyle = '#fff'; g.font = 'bold 8px sans-serif'; g.textAlign = 'right'; g.fillText(`残り ${game.stLeft}回`, W - 6, 12); }
      else if (game.mode === 'jitan') { g.fillStyle = '#c58aff'; g.fillText('時短', 6, 12); g.fillStyle = '#fff'; g.font = 'bold 8px sans-serif'; g.textAlign = 'right'; g.fillText(`残り ${game.jitanLeft}回`, W - 6, 12); }
      else if (!game.jackpot) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = 'bold 8px sans-serif'; g.fillText(game.spec.label, 6, 12); }
      // 保留（特図1 左・特図2 右）
      const dot = (x, y, lv, cur) => {
        g.beginPath(); g.arc(x, y, cur ? 4.5 : 3.6, 0, 6.283);
        g.fillStyle = lv === 5 ? `hsl(${(t * 300 + x * 5) % 360},90%,60%)` : LV_COLOR[lv] || '#fff';
        if (lv >= 3) { g.shadowColor = g.fillStyle; g.shadowBlur = 6; }
        g.fill(); g.shadowBlur = 0; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
      };
      const y = H - 8;
      for (let i = 0; i < 4; i++) { const h = game.hold1[i]; if (h) dot(10 + i * 10, y, h.pre, false); else { g.beginPath(); g.arc(10 + i * 10, y, 3.2, 0, 6.283); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.stroke(); } }
      for (let i = 0; i < 4; i++) { const h = game.hold2[i]; if (h) dot(W - 10 - i * 10, y, h.pre, false); else { g.beginPath(); g.arc(W - 10 - i * 10, y, 3.2, 0, 6.283); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.stroke(); } }
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '6px sans-serif'; g.textAlign = 'left'; g.fillText('特図1', 6, y - 7); g.textAlign = 'right'; g.fillText('特図2', W - 6, y - 7);
      if (game.spin) dot(W / 2, y, 0, true);
      // 通知
      if (game.notice) {
        const warn = game.notice.kind === 'warn';
        g.fillStyle = warn ? 'rgba(200,0,0,0.85)' : 'rgba(0,60,160,0.85)'; g.fillRect(0, 18, W, 16);
        g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(game.notice.text, W / 2, 26); g.textBaseline = 'alphabetic';
      }
    }
  }
  root.PachiLCD = { LCD };
})(typeof window !== 'undefined' ? window : globalThis);

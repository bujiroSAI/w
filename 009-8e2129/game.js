/* game.js — 遊技ロジック（保留・抽選・変動演出タイムライン・大当りラウンド・確変/時短・普図/電チュー・玉と金）
 * DOM 非依存。描画は render.js / lcd.js が this の状態を読むだけ。効果音・BGM は hooks 経由。
 */
(function (root) {
  'use strict';
  const B = root.PachiBoard || (typeof require !== 'undefined' ? require('./board.js') : null);
  const S = root.PachiSpec || (typeof require !== 'undefined' ? require('./spec.js') : null);

  const pick = (rand, table) => { // [{p, ...}] から重み抽選
    let r = rand(), acc = 0;
    for (const it of table) { acc += it.p; if (r < acc) return it; }
    return table[table.length - 1];
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Game {
    constructor(world, layout, spec, hooks) {
      this.world = world; this.L = layout; this.spec = spec; this.hooks = hooks || {};
      this.rand = world.rand;
      this.t = 0;
      this.mode = 'normal';           // normal | kakuhen | jitan
      this.stLeft = 0; this.jitanLeft = 0;
      this.phase = 'idle';            // idle | spin | jackpot
      this.hold1 = []; this.hold2 = [];
      this.spin = null; this.jackpot = null; this.lastResult = null;
      this.futsu = { hold: [], spin: null, openLeft: 0, openCount: 0, lampT: 0 };
      this.tulipOpen = false; this.attackerOpen = false;
      this.balls = { tray: 0, lower: 0, box: 0 };
      this.money = { balance: 0, invested: 0, lent: 0 };
      this.stats = { totalSpins: 0, sinceHit: 0, hits: 0, firstHits: 0, renchan: 0, maxRenchan: 0, history: [], totalOut: 0, launched: 0, hesoIn: 0, dencyuIn: 0, generalIn: 0, attackerIn: 0, foul: 0, out: 0, slump: [0], bestOut: 0, sessionOut: 0, hitLog: [] };
      this.launch = { strength: 0, stop: false, next: 0, autoRefill: true };
      this.turbo = false;
      this.notice = null; this.warnT = 0;
      this.lamps = { heso: 0, dencyu: 0, g1: 0, g2: 0, g3: 0, attacker: 0, gate: 0 };
      this.idleT = 0;
      this.log = [];
    }

    // ---- 外部イベント ----
    lend() { // 玉貸（500円=125玉）
      const sp = this.spec;
      if (this.money.balance < sp.lendYen) { this.say('lend_fail'); return false; }
      this.money.balance -= sp.lendYen; this.money.lent += sp.lendBalls;
      this.addBalls(sp.lendBalls, true);
      this.sfx('lend'); this.pushSlump();
      return true;
    }
    insertMoney(yen) { this.money.balance += yen; this.money.invested += yen; this.sfx('button'); }
    returnCard() { this.sfx('button'); }
    liftLower() { // 下皿→上皿
      const room = this.spec.trayMax - this.balls.tray, n = Math.min(room, this.balls.lower);
      if (n <= 0) return 0;
      this.balls.lower -= n; this.balls.tray += n; this.sfx('tray', { n }); return n;
    }
    boxLower() { // 下皿→箱（計数）
      const n = this.balls.lower; if (n <= 0) return 0; this.balls.lower = 0; this.balls.box += n; this.sfx('tray', { n }); return n;
    }
    fromBox() { // 箱→上皿（補給）
      const room = this.spec.trayMax - this.balls.tray, n = Math.min(room, this.balls.box);
      if (n <= 0) return 0; this.balls.box -= n; this.balls.tray += n; this.sfx('tray', { n }); return n;
    }
    addBalls(n, toTray) {
      if (toTray) { this.balls.tray += n; if (this.balls.tray > this.spec.trayMax) { this.balls.lower += this.balls.tray - this.spec.trayMax; this.balls.tray = this.spec.trayMax; } }
      else this.balls.lower += n;
      if (this.balls.lower > this.spec.lowerMax) { this.balls.box += this.balls.lower - this.spec.lowerMax; this.balls.lower = this.spec.lowerMax; }
    }
    pay(n, kind) { this.addBalls(n, true); this.stats.totalOut += n; this.stats.sessionOut += n; this.sfx('payout', { n }); this.pushSlump(); }
    totalBalls() { return this.balls.tray + this.balls.lower + this.balls.box; }
    diff() { return this.totalBalls() - this.money.lent; } // 差玉
    pushSlump() { const s = this.stats.slump, d = this.diff(); if (s[s.length - 1] !== d) { s.push(d); if (s.length > 600) s.shift(); } }

    setStrength(v) { this.launch.strength = clamp(v, 0, 1); }
    setStop(on) { this.launch.stop = !!on; }
    sfx(name, opts) { if (this.hooks.sfx) this.hooks.sfx(name, opts); }
    bgm(mode) { if (this.hooks.bgm) this.hooks.bgm(mode); }
    say(key) { if (this.hooks.say) this.hooks.say(key); }
    setNotice(text, sec, kind) { this.notice = { text, until: this.t + sec, kind: kind || 'info' }; }

    // ---- 物理イベント ----
    onZone(id, ball) {
      const st = this.stats;
      switch (id) {
        case 'heso':
          st.hesoIn++; this.lamps.heso = 0.6; this.pay(this.spec.payout.heso, 'heso'); this.sfx('heso');
          if (this.hold1.length < this.spec.holdMax) { const h = this.newHold(); this.hold1.push(h); if (h.pre) this.sfx('lamp', { level: h.pre }); }
          if (this.wantRight() && this.launch.strength < 0.75) this.warn('右打ちしてください', 'right');
          break;
        case 'dencyu':
          st.dencyuIn++; this.lamps.dencyu = 0.6; this.futsu.openCount++; this.pay(this.spec.payout.dencyu, 'dencyu'); this.sfx('dencyu');
          if (this.hold2.length < this.spec.holdMax) { const h = this.newHold(); this.hold2.push(h); if (h.pre) this.sfx('lamp', { level: h.pre }); }
          break;
        case 'gate':
          this.lamps.gate = 0.4; this.sfx('gate');
          if (this.futsu.hold.length < 4) this.futsu.hold.push({ r: this.rand() });
          if (!this.wantRight()) this.warn('左打ちに戻してください', 'left');
          break;
        case 'attacker':
          st.attackerIn++; this.lamps.attacker = 0.5;
          if (this.jackpot && this.jackpot.stage === 'round') { this.jackpot.roundBalls++; this.jackpot.payout += this.spec.payout.attacker; this.sfx('attacker', { n: this.jackpot.roundBalls }); }
          this.pay(this.spec.payout.attacker, 'attacker');
          break;
        case 'g1': case 'g2': case 'g3':
          st.generalIn++; this.lamps[id] = 0.6; this.pay(this.spec.payout.general, 'general'); this.sfx('general'); break;
        case 'out': st.out++; break;
        case 'foul': st.foul++; this.addBalls(1, false); break; // ファール玉は下皿へ戻る
        case 'warp': this.sfx('stage'); break;
        case 'stage_center': break;
      }
    }
    warn(text, kind) { if (this.t - this.warnT > 4) { this.warnT = this.t; this.setNotice(text, 3, 'warn'); this.sfx('alert'); this.say(kind === 'right' ? 'right' : 'left'); } }
    wantRight() { return this.phase === 'jackpot' || this.mode !== 'normal'; }
    newHold() { const r = this.rand(); return { r, pre: this.prejudge(r < this.currentP()) }; }
    currentP() { return this.mode === 'normal' ? this.spec.pLow : this.spec.pHigh; }
    prejudge(win) { // 先読み保留の色（0=通常 1=青 2=緑 3=赤 4=金 5=虹）
      const t = win ? [[0, 0.15], [1, 0.15], [2, 0.25], [3, 0.25], [4, 0.12], [5, 0.08]] : [[0, 0.962], [1, 0.024], [2, 0.010], [3, 0.003], [4, 0.001], [5, 0]];
      let r = this.rand(), acc = 0; for (const [lv, p] of t) { acc += p; if (r < acc) return lv; } return 0;
    }

    // ---- メインループ ----
    update(dt) {
      this.t += dt;
      for (const k in this.lamps) if (this.lamps[k] > 0) this.lamps[k] -= dt;
      if (this.notice && this.t > this.notice.until) this.notice = null;
      this.updateLaunch(dt);
      this.updateFutsu(dt);
      if (this.phase === 'idle') {
        this.idleT += dt;
        if (this.idleT > 0.25 && (this.hold2.length || this.hold1.length)) this.startSpin();
      } else if (this.phase === 'spin') this.updateSpin(dt);
      else if (this.phase === 'jackpot') this.updateJackpot(dt);
    }

    updateLaunch(dt) {
      const l = this.launch;
      if (l.strength < 0.03 || l.stop) { l.next = Math.max(l.next, this.t + 0.15); return; }
      if (this.t < l.next) return;
      if (this.balls.tray <= 0) {
        if (l.autoRefill) { if (this.balls.lower > 0) this.liftLower(); else if (this.balls.box > 0) this.fromBox(); }
        if (this.balls.tray <= 0) { l.next = this.t + 0.3; return; }
      }
      this.balls.tray--; this.stats.launched++; l.next = this.t + this.spec.launchInterval;
      B.spawnLaunch(this.world, l.strength); this.sfx('launch');
    }

    futsuTable() { return (this.mode !== 'normal' && this.phase !== 'jackpot') ? this.spec.futsu.sapo : this.spec.futsu.normal; }
    updateFutsu(dt) {
      const f = this.futsu, tb = this.futsuTable();
      if (this.tulipOpen) {
        f.openLeft -= dt;
        if (f.openLeft <= 0 || f.openCount >= tb.count) { this.tulipOpen = false; B.setTulip(this.world, this.L, false); }
        return;
      }
      if (f.spin) {
        f.spin.t += dt;
        if (f.spin.t >= f.spin.dur) {
          if (f.spin.win) { this.tulipOpen = true; f.openLeft = tb.open; f.openCount = 0; B.setTulip(this.world, this.L, true); this.sfx('wall', { v: 0.6 }); }
          f.spin = null;
        }
      } else if (f.hold.length) {
        const h = f.hold.shift();
        f.spin = { t: 0, dur: tb.spin, win: h.r < tb.p };
      }
    }

    // ---- 特図の変動 ----
    startSpin() {
      const useH2 = this.hold2.length > 0;
      const h = useH2 ? this.hold2.shift() : this.hold1.shift();
      const win = h.r < this.currentP();
      const holdsLeft = this.hold1.length + this.hold2.length;
      const pat = this.choosePattern(win, useH2, holdsLeft);
      pat.win = win; pat.tf = useH2 ? 2 : 1; pat.t = 0; pat.cueIdx = 0;
      pat.result = win ? pick(this.rand, useH2 ? this.spec.dist2 : this.spec.dist1) : null;
      this.assignFigures(pat);
      this.spin = pat; this.phase = 'spin'; this.idleT = 0;
      this.stats.totalSpins++; this.stats.sinceHit++;
      this.sfx('reel_start');
      if (this.mode === 'normal') this.bgm('normal');
      this.log.push({ t: this.t, ev: 'spin', win, sp: pat.sp, dur: pat.dur });
    }

    choosePattern(win, tf2, holdsLeft) {
      const r = this.rand, tb = this.turbo ? 0.4 : 1;
      const cues = [], fx = [];
      let dur, reach = false, sp = 0, premium = false, revival = false, stopT;
      const sapo = this.mode !== 'normal';
      if (sapo) { // 電サポ中（RUSH/時短）は高速変動
        if (win) { dur = 5.5; reach = true; sp = 1; stopT = [1.2, 1.9, 4.6]; }
        else if (r() < 0.06) { dur = 4.0; reach = true; sp = 1; stopT = [1.2, 1.9, 3.4]; }
        else { dur = 1.4; stopT = [0.6, 0.9, 1.15]; }
      } else if (win) {
        const k = pick(r, [{ p: 0.03, k: 'premium' }, { p: 0.52, k: 'spsp' }, { p: 0.33, k: 'sp' }, { p: 0.12, k: 'normal' }]).k;
        reach = true;
        if (k === 'premium') { premium = true; dur = 8; sp = 0; stopT = [2.4, 3.3, 7.2]; }
        else if (k === 'spsp') { sp = 3; dur = 34; }
        else if (k === 'sp') { sp = 2; dur = 23; }
        else { sp = 1; dur = 12; }
        if (sp >= 2 && r() < 0.07) { revival = true; dur += 3.5; }
      } else {
        const k = pick(r, [{ p: 0.87, k: 'none' }, { p: 0.085, k: 'normal' }, { p: 0.037, k: 'sp' }, { p: 0.008, k: 'spsp' }]).k;
        if (k === 'none') { dur = holdsLeft >= 3 ? 2.2 : holdsLeft >= 2 ? 3.6 : 5.2; stopT = [dur * 0.42, dur * 0.42 + 0.7, dur - 0.55]; }
        else { reach = true; sp = k === 'normal' ? 1 : k === 'sp' ? 2 : 3; dur = sp === 1 ? 12 : sp === 2 ? 23 : 34; }
      }
      if (!stopT) { // リーチ系の停止タイミング
        const tL = 2.4, tR = 3.4;
        stopT = [tL, tR, revival ? dur - 3.4 : dur - 1.1];
      }
      // 演出（予告）の組み立て
      if (!sapo) {
        const lvl = win ? pick(r, [{ p: 0.10, l: 1 }, { p: 0.22, l: 2 }, { p: 0.38, l: 3 }, { p: 0.20, l: 4 }, { p: 0.10, l: 5 }]).l
          : pick(r, [{ p: 0.72, l: 0 }, { p: 0.16, l: 1 }, { p: 0.08, l: 2 }, { p: 0.03, l: 3 }, { p: 0.008, l: 4 }, { p: 0.002, l: 5 }]).l;
        if (lvl > 0) { fx.push({ t: 1.6, type: 'cutin', level: lvl, dur: 1.6, button: 1 }); cues.push({ t: 1.6, sfx: 'cutin', opts: { level: lvl }, button: 1 }); }
        const step = win ? pick(r, [{ p: 0.15, s: 0 }, { p: 0.15, s: 1 }, { p: 0.3, s: 2 }, { p: 0.4, s: 3 }]).s : pick(r, [{ p: 0.6, s: 0 }, { p: 0.28, s: 1 }, { p: 0.1, s: 2 }, { p: 0.02, s: 3 }]).s;
        for (let i = 1; i <= step; i++) { fx.push({ t: 0.3 + i * 0.55, type: 'step', level: i, dur: 0.6 }); cues.push({ t: 0.3 + i * 0.55, sfx: 'countdown' }); }
        if ((win && r() < 0.3) || (!win && r() < 0.012)) { fx.push({ t: 1.6, type: 'group', dur: 1.8 }); cues.push({ t: 1.6, sfx: 'zone' }); }
        if (reach) {
          fx.push({ t: stopT[1], type: 'reach', dur: 1.5 }); cues.push({ t: stopT[1], sfx: 'reach' });
          if (sp >= 2) { fx.push({ t: stopT[1] + 4.5, type: 'sp', level: sp, dur: 2.0 }); cues.push({ t: stopT[1] + 4.5, sfx: 'sp_start' }); cues.push({ t: stopT[1] + 4.6, bgm: 'sp' }); }
          else cues.push({ t: stopT[1] + 0.1, bgm: 'reach' });
          if (sp === 3) { fx.push({ t: stopT[1] + 14, type: 'spsp', dur: 2.5 }); cues.push({ t: stopT[1] + 14, sfx: 'zone' }); }
          if (sp >= 2 && win && r() < 0.5) { const lv = r() < 0.5 ? 4 : 5; fx.push({ t: stopT[2] - 4.0, type: 'cutin', level: lv, dur: 1.8, final: true, button: 2 }); cues.push({ t: stopT[2] - 4.0, sfx: 'cutin', opts: { level: lv }, button: 2 }); }
          if (sp >= 2 && !win && r() < 0.12) { fx.push({ t: stopT[2] - 4.0, type: 'cutin', level: 3, dur: 1.8, final: true, button: 2 }); cues.push({ t: stopT[2] - 4.0, sfx: 'cutin', opts: { level: 3 }, button: 2 }); }
          fx.push({ t: stopT[2] - 3.2, type: 'countdown', dur: 3.0 });
          for (let i = 0; i < 3; i++) cues.push({ t: stopT[2] - 3.0 + i, sfx: 'countdown' });
        }
        if (premium) { fx.push({ t: 1.2, type: 'premium', dur: dur }); cues.push({ t: 1.2, sfx: 'cutin', opts: { level: 5 } }); cues.push({ t: 1.3, bgm: 'sp' }); }
      } else if (reach) {
        fx.push({ t: stopT[1], type: 'reach', dur: 1.2, rush: true }); cues.push({ t: stopT[1], sfx: 'reach' });
        if (win) { fx.push({ t: stopT[1] + 0.6, type: 'cutin', level: 4, dur: 1.5, rush: true }); cues.push({ t: stopT[1] + 0.6, sfx: 'cutin', opts: { level: 4 } }); }
      }
      cues.push({ t: stopT[0], sfx: 'reel_stop' }); cues.push({ t: stopT[1], sfx: 'reel_stop' }); cues.push({ t: stopT[2], sfx: 'reel_stop' });
      if (revival) { fx.push({ t: stopT[2] + 1.4, type: 'revival', dur: 1.6 }); cues.push({ t: stopT[2] + 1.4, sfx: 'revival' }); }
      if (win) cues.push({ t: revival ? stopT[2] + 2.0 : stopT[2] + 0.05, sfx: 'jackpot' });
      else if (reach) cues.push({ t: stopT[2] + 0.05, sfx: 'lose' });
      cues.sort((a, b) => a.t - b.t);
      // 演出短縮
      if (tb !== 1) { const f = v => Math.max(0, v * tb); dur = Math.max(1.2, dur * tb); stopT = stopT.map(f); for (const c of cues) c.t = f(c.t); for (const e of fx) { e.t = f(e.t); e.dur = e.dur * tb; } }
      // ボタン窓: button 印のついた演出は、窓の間に PUSH されれば即時に発火する（押さなければ窓の終わりに自動発火）
      const windows = [];
      for (const e of fx) if (e.button && !windows.find(w => w.id === e.button)) windows.push({ id: e.button, t0: Math.max(0.2, e.t - 1.2), t1: e.t, pressed: false });
      return { dur, reach, sp, premium, revival, stopT, cues, fx, holdsLeft, windows };
    }

    pressButton() { // チャンスボタン
      const sp = this.spin; this.sfx('button');
      if (!sp) return false;
      const w = sp.windows.find(w => !w.pressed && sp.t >= w.t0 && sp.t <= w.t1); if (!w) return false;
      w.pressed = true; const shift = sp.t + 0.05 - w.t1;
      for (const e of sp.fx) if (e.button === w.id) e.t += shift;
      for (const c of sp.cues) if (c.button === w.id) c.t += shift;
      sp.cues.sort((a, b) => a.t - b.t); sp.cueIdx = sp.cues.findIndex(c => c.t > sp.t); if (sp.cueIdx < 0) sp.cueIdx = sp.cues.length;
      return true;
    }
    buttonHot() { const sp = this.spin; if (!sp) return false; return !!sp.windows.find(w => !w.pressed && sp.t >= w.t0 && sp.t <= w.t1); }

    assignFigures(pat) {
      const r = this.rand;
      const odd = [1, 3, 5, 7, 9], even = [2, 4, 6, 8];
      let l, c, rr;
      if (pat.win) {
        const kak = pat.result.kakuhen;
        if (kak) l = r() < 0.4 ? 7 : odd[Math.floor(r() * 5)]; else l = even[Math.floor(r() * 4)];
        rr = l; c = l;
        if (pat.revival) pat.missFigure = ((l + (r() < 0.5 ? 1 : 8) - 1) % 9) + 1; // いったん外れて止まる図柄
      } else if (pat.reach) {
        l = 1 + Math.floor(r() * 9); rr = l;
        c = r() < 0.5 ? ((l % 9) + 1) : (((l + 7) % 9) + 1); // 前後1コマの「惜しい」外れ
      } else {
        l = 1 + Math.floor(r() * 9); rr = 1 + Math.floor(r() * 8); if (rr >= l) rr++;
        c = 1 + Math.floor(r() * 9);
      }
      pat.figures = [l, c, rr];
    }

    updateSpin(dt) {
      const sp = this.spin; sp.t += dt;
      while (sp.cueIdx < sp.cues.length && sp.cues[sp.cueIdx].t <= sp.t) {
        const c = sp.cues[sp.cueIdx++];
        if (c.sfx) this.sfx(c.sfx, c.opts);
        if (c.bgm) this.bgm(c.bgm);
      }
      if (sp.t >= sp.dur) this.endSpin();
    }

    endSpin() {
      const sp = this.spin;
      this.lastResult = { figures: sp.figures, win: sp.win, t: this.t };
      if (sp.win) { this.startJackpot(sp.result); return; }
      this.spin = null; this.phase = 'idle'; this.idleT = 0;
      if (this.mode === 'kakuhen') { if (--this.stLeft <= 0) this.endSapo(); }
      else if (this.mode === 'jitan') { if (--this.jitanLeft <= 0) this.endSapo(); }
      else this.bgm('normal');
    }
    endSapo() {
      this.mode = 'normal'; this.stLeft = 0; this.jitanLeft = 0;
      this.setNotice('RUSH終了 — 左打ちに戻してください', 5, 'info'); this.sfx('rush_end'); this.say('left'); this.bgm('normal');
      this.log.push({ t: this.t, ev: 'sapo_end' });
    }

    // ---- 大当り ----
    startJackpot(type) {
      const st = this.stats;
      st.hits++; if (this.mode === 'normal') { st.firstHits++; st.renchan = 1; } else st.renchan++;
      st.maxRenchan = Math.max(st.maxRenchan, st.renchan);
      st.history.unshift(st.sinceHit); if (st.history.length > 50) st.history.pop();
      st.hitLog.push({ n: st.hits, spins: st.sinceHit, type: type.name, mode: this.mode, t: this.t });
      st.sinceHit = 0;
      this.jackpot = { stage: 'fanfare', t: 0, type, round: 0, roundBalls: 0, roundT: 0, payout: 0, totalRounds: type.rounds, figures: this.spin.figures, prevMode: this.mode };
      this.spin = null; this.phase = 'jackpot';
      this.bgm('jackpot'); this.say('jackpot');
      this.log.push({ t: this.t, ev: 'jackpot', type: type.name });
    }
    updateJackpot(dt) {
      const j = this.jackpot, sp = this.spec; j.t += dt;
      const tb = this.turbo ? 0.5 : 1;
      if (j.stage === 'fanfare') {
        if (j.t >= 4.0 * tb) this.nextRound();
      } else if (j.stage === 'round') {
        j.roundT += dt;
        if (j.roundBalls >= sp.attackerCount || j.roundT >= sp.roundMaxSec) { this.attackerOpen = false; B.setAttacker(this.world, this.L, false); j.stage = 'interval'; j.t = 0; }
      } else if (j.stage === 'interval') {
        if (j.t >= sp.roundInterval * tb) { if (j.round < j.totalRounds) this.nextRound(); else { j.stage = 'ending'; j.t = 0; this.sfx('ending'); } }
      } else if (j.stage === 'ending') {
        if (j.t >= 4.0 * tb) this.finishJackpot();
      }
    }
    nextRound() {
      const j = this.jackpot; j.round++; j.roundBalls = 0; j.roundT = 0; j.stage = 'round'; j.t = 0;
      this.attackerOpen = true; B.setAttacker(this.world, this.L, true); this.sfx('round', { n: j.round });
    }
    finishJackpot() {
      const j = this.jackpot, sp = this.spec;
      this.stats.bestOut = Math.max(this.stats.bestOut, j.payout);
      if (j.type.kakuhen) { this.mode = 'kakuhen'; this.stLeft = sp.stCount; this.jitanLeft = 0; this.sfx('rush_in'); this.bgm('rush'); this.say('rush'); this.setNotice('RUSH突入！ 右打ち継続', 4, 'info'); }
      else { this.mode = 'jitan'; this.jitanLeft = sp.jitanCount; this.stLeft = 0; this.bgm('jitan'); this.say('jitan'); this.setNotice(`時短${sp.jitanCount}回 右打ち継続`, 4, 'info'); }
      this.lastJackpot = j; this.jackpot = null; this.phase = 'idle'; this.idleT = 0;
      this.log.push({ t: this.t, ev: 'jackpot_end', payout: j.payout, mode: this.mode });
    }

    // ---- 保存/復元（遊技状態と収支。飛んでいる玉は保存しない） ----
    toJSON() {
      return { v: 1, spec: this.spec.id, mode: this.mode, stLeft: this.stLeft, jitanLeft: this.jitanLeft, hold1: this.hold1, hold2: this.hold2, balls: this.balls, money: this.money, stats: this.stats, strength: this.launch.strength, autoRefill: this.launch.autoRefill, turbo: this.turbo };
    }
    load(o) {
      if (!o || o.v !== 1) return false;
      this.mode = o.mode || 'normal'; this.stLeft = o.stLeft || 0; this.jitanLeft = o.jitanLeft || 0;
      this.hold1 = o.hold1 || []; this.hold2 = o.hold2 || [];
      Object.assign(this.balls, o.balls || {}); Object.assign(this.money, o.money || {}); Object.assign(this.stats, o.stats || {});
      if (!this.stats.slump || !this.stats.slump.length) this.stats.slump = [this.diff()];
      this.launch.strength = o.strength || 0; if (o.autoRefill != null) this.launch.autoRefill = o.autoRefill; this.turbo = !!o.turbo;
      return true;
    }
    resetAll() { const g = new Game(this.world, this.L, this.spec, this.hooks); for (const k of Object.keys(g)) if (!['world', 'L', 'spec', 'hooks', 'rand'].includes(k)) this[k] = g[k]; this.tulipOpen = false; this.attackerOpen = false; B.setTulip(this.world, this.L, false); B.setAttacker(this.world, this.L, false); }
  }

  const api = { Game, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PachiGame = api;
})(typeof window !== 'undefined' ? window : globalThis);

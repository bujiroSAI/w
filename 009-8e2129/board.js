/* board.js — 盤面レイアウト（ゲージ）。物理ワールドに釘・レール・役物・センサーを配置し、描画用の地図を返す。
 * 座標は mm、原点=遊技盤左上、y 下向き。盤面 460×480。
 */
(function (root) {
  'use strict';
  const P = root.PachiPhysics || (typeof require !== 'undefined' ? require('./physics.js') : null);

  const BOARD = { w: 460, h: 480, cx: 230, cy: 240, rOut: 215, rIn: 200, laneX0: 15, laneX1: 30, laneBottom: 455, flapDeg: 215, launch: { x: 22.5, y: 448 } };

  function buildBoard(world, opts) {
    opts = opts || {};
    const L = { nails: [], groups: {}, pockets: [], spinners: [], zones: {}, board: BOARD };
    const nail = (x, y, g) => { const n = world.addNail(x, y); n.group = g || ''; L.nails.push(n); (L.groups[g] = L.groups[g] || []).push(n); return n; };
    const seg = (x1, y1, x2, y2, o) => world.addSegment(x1, y1, x2, y2, o);
    const poly = (pts, o) => world.addPolyline(pts, o);
    const { cx, cy, rOut, rIn } = BOARD;
    const rad = d => d * Math.PI / 180;
    const onArc = (r, d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];

    // ---- レール ----
    // 外レール: 左の直線 → 円弧(180°→360°) → 右の直線
    seg(BOARD.laneX0, BOARD.laneBottom + 10, BOARD.laneX0, cy, { tag: 'rail' });
    L.outerArc = world.addArc(cx, cy, rOut, 180, 360, { tag: 'rail', rest: 0.15, fric: 0.012 });
    seg(cx + rOut, cy, cx + rOut, 450, { tag: 'rail' });
    // 内レール: 左の直線 → 円弧(180°→215°)
    seg(BOARD.laneX1, BOARD.laneBottom + 10, BOARD.laneX1, cy, { tag: 'rail' });
    L.innerArc = world.addArc(cx, cy, rIn, 180, BOARD.flapDeg, { tag: 'rail' });
    // 戻り防止片（一方通行）: 内レール終端から外レールへ
    const f0 = onArc(rIn, BOARD.flapDeg), f1 = onArc(rOut - 0.5, BOARD.flapDeg);
    L.flap = seg(f0[0], f0[1], f1[0], f1[1], { oneWay: true, tag: 'flap' });
    // ファール口（レール下端）
    world.addZone({ id: 'foul', type: 'capture', x1: BOARD.laneX0, x2: BOARD.laneX1, y1: BOARD.laneBottom + 4, y2: BOARD.laneBottom + 30 });
    // 下辺（アウト口へ集める斜面）とアウト口
    seg(BOARD.laneX1, BOARD.laneBottom, 214, 472, { tag: 'floor' });
    seg(cx + rOut, 450, 246, 472, { tag: 'floor' });
    world.addZone({ id: 'out', type: 'out', x1: 205, x2: 255, y1: 470, y2: 500 });

    // ---- センター役物（液晶枠）: 屋根・側壁・ワープ・ステージ ----
    const F = { apex: [230, 90], eaveL: [134, 118], eaveR: [326, 118], wallL: 134, wallR: 326, wallBot: 270, warpY0: 150, warpY1: 166 };
    L.frame = F;
    poly([F.eaveL, F.apex, F.eaveR], { tag: 'frame', rest: 0.3 });
    seg(F.wallL, F.eaveL[1], F.wallL, F.warpY0, { tag: 'frame' });
    seg(F.wallL, F.warpY1, F.wallL, F.wallBot, { tag: 'frame' });
    seg(F.wallR, F.eaveR[1], F.wallR, F.wallBot, { tag: 'frame' });
    // ワープ: 受け口の唇 → 横穴 → 内部シュート（L字）→ ステージ左へ排出
    const lip = opts.warpLip != null ? opts.warpLip : 5;
    seg(F.wallL - lip, F.warpY1 - lip * 0.8, F.wallL, F.warpY1, { tag: 'warp' }); // 唇（穴へ下る受け）
    seg(F.wallL, F.warpY0, 170, F.warpY0, { tag: 'warp' });          // 入口天井
    seg(170, F.warpY0, 170, 262, { tag: 'warp' });                    // シュート右壁
    seg(F.wallL, F.warpY1, 158, 178, { tag: 'warp' });                // 入口床（右下がり）
    seg(152, 186, 152, 262, { tag: 'warp' });                         // シュート左壁（床の下から）
    // ステージ（枠壁で閉じた皿・V字で中央に落とし穴。前面へのこぼれは updateBalls で確率的に再現）
    const stageL = [[F.wallL, 272], [165, 283], [200, 289], [223, 292]];
    const stageR = [[237, 292], [260, 289], [295, 283], [F.wallR, 272]];
    L.stageL = stageL; L.stageR = stageR;
    poly(stageL, { tag: 'stage', rest: 0.18, fric: 0.02 });
    poly(stageR, { tag: 'stage', rest: 0.18, fric: 0.02 });
    // 中央スロット下のシュート（ヘソ直上へ落とす）
    seg(223, 292, 223, 304, { tag: 'stage' }); seg(237, 292, 237, 304, { tag: 'stage' });
    world.addZone({ id: 'stage_center', type: 'pass', x1: 224, x2: 236, y1: 296, y2: 303 });
    world.addZone({ id: 'warp', type: 'pass', x1: 153, x2: 169, y1: 200, y2: 210 });
    L.stageZone = { x1: F.wallL + 2, x2: F.wallR - 2, y1: 262, y2: 293 };

    // ---- 釘 ----
    for (let x = 150; x <= 310; x += 20) nail(x, 62, 'ten');                 // 天釘
    [[96, 118], [120, 104], [364, 104], [340, 118]].forEach(p => nail(p[0], p[1], 'kata')); // 肩釘
    // 左袖: ワープ上の釘・千鳥格子（玉をランダムウォークさせる）・風車
    nail(118, 134, 'warpTop'); // ワープ上の釘（壁との隙間15: 通った玉が唇へ）
    const spinL = world.addSpinner(78, 232, 10); L.spinners.push(spinL);   // 風車
    const gx = opts.latX || 17, gy = opts.latY || 21;
    for (let r = 0; r < 7; r++) {
      const y = 152 + r * gy, x0 = 46 + (r % 2) * (gx / 2);
      for (let x = x0; x <= 116; x += gx) {
        if (Math.hypot(x - spinL.x, y - spinL.y) < 26) continue;      // 風車の周り（釘と風車の間を玉が通れる距離）
        if (Math.hypot(x - cx, y - cy) > 185) continue;                 // 内レール際（レールとの間に玉が通る余地を残す）
        if (Math.hypot(x - 118, y - 134) < 12) continue;
        nail(x, y, 'lattice');
      }
    }
    nail(129, 258, 'blockL');  // 壁際ブロッカー（壁との隙間<玉径・法線は左向き）
    // 道釘（左）: 右へ緩く下る。間隔は玉が落ちない幅
    // 計測用の通過センサー（道釘に乗った／末端まで来た）
    world.addZone({ id: 'railL_on', type: 'pass', x1: 108, x2: 185, y1: 290, y2: 305 });
    world.addZone({ id: 'railL_end', type: 'pass', x1: 190, x2: 205, y1: 296, y2: 315 });
    world.addZone({ id: 'railR_on', type: 'pass', x1: 275, x2: 352, y1: 290, y2: 305 });
    world.addZone({ id: 'railR_end', type: 'pass', x1: 255, x2: 270, y1: 296, y2: 315 });
    const jdx = opts.jumpDX != null ? opts.jumpDX : 13, jdy = opts.jumpDY != null ? opts.jumpDY : 0; // ジャンプ釘: 道釘末端の12mm先・同じ高さ（手前の隙間が「こぼし」）
    michi('michiL', 108, 300, 8, 12.5, 1.7);
    nail(195.5 + jdx, 311.9 + jdy, 'jumpL');
    // 右袖: 仕切りと枠壁の間の細い通路。ぶっこみ右の玉が右道釘へ落ちる
    [[342, 150], [356, 168], [342, 190], [356, 212], [331, 258], [356, 264]].forEach(p => nail(p[0], p[1], 'rightSleeve')); // 331,258 は壁際ブロッカー
    // 道釘（右）: 鏡像
    michi('michiR', 340, 301.7, 7, -12.5, 1.7);
    nail(264.5 - jdx, 311.9 + jdy, 'jumpR');
    // 命釘（ヘソ釘）
    const hesoGap = opts.hesoGap || 14.4;
    nail(230 - hesoGap / 2, 330, 'inochi'); nail(230 + hesoGap / 2, 330, 'inochi');
    // ヘソ（スタートチャッカー）本体
    pocket('heso', 230, 340, 14, 'start');
    // ヘソ下・こぼれ帯
    [[150, 342], [176, 354], [206, 374], [254, 374], [284, 354], [310, 342]].forEach(p => nail(p[0], p[1], 'shita'));
    // 一般入賞口（左2・右1）とヨロイ釘
    generalPocket('g1', 90, 406); generalPocket('g2', 122, 422); generalPocket('g3', 322, 418);
    // 右打ちルート（仕切りはレール直下から）
    seg(372, 100, 372, 318, { tag: 'divider' }); nail(372, 94, 'dividerTop');
    [[394, 150], [394, 176], [438, 262]].forEach(p => nail(p[0], p[1], 'right'));
    // ゲート（スルーチャッカー）
    seg(414, 190, 414, 220, { tag: 'gate' });
    world.addZone({ id: 'gate', type: 'pass', x1: 418, x2: 445, y1: 202, y2: 208 });
    L.gate = { x: 414, y: 190, w: 31, h: 30 };
    // 電チュー（電動チューリップ）
    L.tulip = { x: 414, hingeY: 304, half: 8, len: 18, bodyTop: 304, bodyBot: 322, open: false };
    seg(406, 304, 406, 322, { tag: 'tulip' }); seg(422, 304, 422, 322, { tag: 'tulip' }); seg(406, 322, 422, 322, { tag: 'tulip' });
    world.addZone({ id: 'dencyu', type: 'capture', x1: 409, x2: 419, y1: 311, y2: 320 });
    // アタッカー（大入賞口）
    L.attacker = { x1: 386, x2: 440, top: 398, bot: 414, open: false };
    seg(386, 398, 386, 414, { tag: 'attacker' }); seg(386, 414, 440, 414, { tag: 'attacker' });
    world.addZone({ id: 'attacker', type: 'capture', x1: 388, x2: 444, y1: 403, y2: 412 });

    // 道釘: 実機は釘頭の上を転がる。物理はレール1本、釘は見た目（と端の当たり）
    function michi(g, x0, y0, n, dx, dy) {
      for (let i = 0; i < n; i++) { const nl = nail(x0 + i * dx, y0 + i * dy, g); nl.deco = true; }
      const x1 = x0 + (n - 1) * dx, y1 = y0 + (n - 1) * dy;
      seg(x0, y0 - 1, x1, y1 - 1, { tag: 'michi', rest: 0.35, fric: 0.03, hop: { spacing: Math.abs(dx), v: opts.hopV != null ? opts.hopV : 130 } });
    }
    function pocket(id, x, y, w, kind) {
      const h = w / 2;
      seg(x - h, y - 4, x - h, y + 12, { tag: 'pocket' }); seg(x + h, y - 4, x + h, y + 12, { tag: 'pocket' }); seg(x - h, y + 12, x + h, y + 12, { tag: 'pocket' });
      const z = world.addZone({ id, type: 'capture', x1: x - h + 1, x2: x + h - 1, y1: y + 3, y2: y + 11 });
      L.pockets.push({ id, x, y, w, kind }); L.zones[id] = z; return z;
    }
    function generalPocket(id, x, y) {
      nail(x - 7.5, y - 20, 'yoroi'); nail(x + 7.5, y - 20, 'yoroi'); nail(x - 17, y - 34, 'yoroi'); nail(x + 17, y - 34, 'yoroi');
      pocket(id, x, y, 14, 'general');
    }
    setTulip(world, L, false); setAttacker(world, L, false);
    world.build();
    return L;
  }

  function setTulip(world, L, open) {
    const t = L.tulip; t.open = open;
    // 羽根の傾き（外向き=正）。閉時は左右非対称に内へ倒して山形にし、玉が乗って止まらないようにする
    const aL = open ? 55 : -22, aR = open ? 55 : -30;
    const ang = (-90 - aL) * Math.PI / 180, ang2 = (-90 + aR) * Math.PI / 180;
    const lx = t.x - t.half, rx = t.x + t.half, y = t.hingeY;
    world.setDynamic('tulip', [
      { x1: lx, y1: y, x2: lx + t.len * Math.cos(ang), y2: y + t.len * Math.sin(ang), rest: 0.25, tag: 'tulipL' },
      { x1: rx, y1: y, x2: rx + t.len * Math.cos(ang2), y2: y + t.len * Math.sin(ang2), rest: 0.25, tag: 'tulipR' },
    ]);
  }
  function setAttacker(world, L, open) {
    const a = L.attacker; a.open = open;
    world.setDynamic('attacker', open ? [] : [{ x1: a.x2 + 2, y1: a.top - 10, x2: a.x1 - 8, y2: a.top, rest: 0.2, tag: 'attackerCover' }]);
  }

  // 発射: ハンドル強さ 0..1 → 初速。実機同様の「ぶれ」つき。
  function launchSpeed(strength, rand) {
    const s = Math.max(0, Math.min(1, strength));
    const v0 = 2450 + s * 800;           // 2450〜3250 mm/s（0.45〜0.6 がぶっこみ、0.8 以上で右打ち）
    const jitter = 1 + (rand() - 0.5) * 0.024;
    return v0 * jitter;
  }
  function spawnLaunch(world, strength, props) {
    const v = launchSpeed(strength, world.rand);
    return world.spawnBall(BOARD.launch.x, BOARD.launch.y, 0, -v, Object.assign({ lane: true, inPlay: false }, props || {}));
  }
  // 毎フレームの補助処理: ①レールを抜けた玉に inPlay を立てる（戻り防止片の通過判定）②ステージ前面へのこぼれ
  function updateBalls(world, L, dt) {
    const { cx, cy, flapDeg } = BOARD;
    const sz = L && L.stageZone, dropRate = (L && L.stageDropRate) || 4.0; // 1秒あたりのこぼれ確率
    for (const b of world.balls) {
      if (b.inPlay) {
        if (sz && b.x > sz.x1 && b.x < sz.x2 && b.y > sz.y1 && b.y < sz.y2 && Math.abs(b.x - 230) > 12 && world.rand() < dropRate * dt) {
          b.y = 300; b.vy = 40; b.vx *= 0.3; b.stageDrop = true; world.events.push({ type: 'stagedrop', ball: b });
        }
        continue;
      }
      let a = Math.atan2(b.y - cy, b.x - cx) * 180 / Math.PI; if (a < 0) a += 360;
      if (b.y < cy && a > flapDeg + 1.5) { b.inPlay = true; b.lane = false; }
      else if (b.x > BOARD.laneX1 + 6 && b.y > cy) { b.inPlay = true; b.lane = false; }
    }
  }

  const api = { BOARD, buildBoard, setTulip, setAttacker, launchSpeed, spawnLaunch, updateBalls };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PachiBoard = api;
})(typeof window !== 'undefined' ? window : globalThis);

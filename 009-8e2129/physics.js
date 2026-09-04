/* physics.js — パチンコ盤面の2D物理（単位: mm / 秒、原点=盤面左上、y は下向き）
 * ブラウザ（window.PachiPhysics）と Node（module.exports）の両方で動く。描画・遊技ロジックは持たない。
 */
(function (root) {
  'use strict';

  const BALL_R = 5.5;   // パチンコ玉 直径11mm
  const NAIL_R = 1.0;   // 釘 直径2mm

  // 乱数（seed 指定で再現可能）
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class World {
    constructor(opts) {
      opts = opts || {};
      this.g = opts.g || 9000;             // 盤面傾斜込みの実効重力
      this.dt = opts.dt || 1 / 1000;        // 固定サブステップ
      this.maxSpeed = opts.maxSpeed || 5000;
      this.width = opts.width || 460;
      this.height = opts.height || 480;
      this.cell = 24;
      this.rand = makeRng(opts.seed || 12345);
      this.nails = [];
      this.segments = [];
      this.dynamic = {};      // id -> segment[]（電チュー羽根・アタッカー等、毎フレーム差し替え）
      this.spinners = [];
      this.zones = [];
      this.balls = [];
      this.events = [];
      this.grid = null;
      this.time = 0;
      this.nextId = 1;
      this.restitution = { nail: 0.52, wall: 0.22, ball: 0.65, spinner: 0.45 };
      this.friction = { nail: 0.10, wall: 0.02, roll: 0.0002 }; // クーロン摩擦係数（法線インパルス比）
      this.nailJitter = 0.035;   // 釘の法線ゆらぎ（rad）
      this.stuckTime = 1.2;      // これ以上ほぼ静止していたら「玉詰まり」として小突く
    }

    // ---- 構築 ----
    addNail(x, y, r) { const n = { x, y, r: r || NAIL_R, id: this.nails.length }; this.nails.push(n); return n; }
    addSegment(x1, y1, x2, y2, o) {
      const s = Object.assign({ x1, y1, x2, y2, oneWay: false, rest: null, fric: null, tag: '' }, o || {});
      this.segments.push(s); return s;
    }
    addPolyline(pts, o) { for (let i = 0; i < pts.length - 1; i++) this.addSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o); }
    addArc(cx, cy, r, a0, a1, o) { // 角度は度（canvas系: 0=右, 90=下, 180=左, 270=上）
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 2.5));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      this.addPolyline(pts, o);
      return pts;
    }
    addSpinner(x, y, r) { const s = { x, y, r: r || 10, angle: this.rand() * 6.28, omega: 0, blades: 8, id: this.spinners.length }; this.spinners.push(s); return s; }
    addZone(z) { z = Object.assign({ type: 'capture', enabled: true, once: true }, z); this.zones.push(z); return z; }
    setDynamic(id, segs) { this.dynamic[id] = segs || []; }

    build() {
      const cell = this.cell, grid = new Map();
      const key = (cx, cy) => cx * 4096 + cy;
      const ins = (x0, y0, x1, y1, item) => {
        const cx0 = Math.floor(x0 / cell), cy0 = Math.floor(y0 / cell), cx1 = Math.floor(x1 / cell), cy1 = Math.floor(y1 / cell);
        for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy); let b = grid.get(k); if (!b) { b = { nails: [], segs: [] }; grid.set(k, b); }
          (item.r !== undefined ? b.nails : b.segs).push(item);
        }
      };
      const pad = BALL_R + 2;
      for (const n of this.nails) if (!n.deco) ins(n.x - n.r - pad, n.y - n.r - pad, n.x + n.r + pad, n.y + n.r + pad, n);
      for (const s of this.segments) ins(Math.min(s.x1, s.x2) - pad, Math.min(s.y1, s.y2) - pad, Math.max(s.x1, s.x2) + pad, Math.max(s.y1, s.y2) + pad, s);
      this.grid = grid; this._key = key;
    }

    // ---- 玉 ----
    spawnBall(x, y, vx, vy, props) {
      const b = Object.assign({ id: this.nextId++, x, y, vx, vy, r: BALL_R, inPlay: false, lane: true, age: 0, still: 0, zoneIn: new Set(), passed: new Set(), lastNail: -1, lastNailT: -1, hits: 0, tag: '' }, props || {});
      this.balls.push(b); return b;
    }
    removeBall(b) { const i = this.balls.indexOf(b); if (i >= 0) this.balls.splice(i, 1); }

    // ---- ステップ ----
    step(elapsed) {
      let n = Math.max(1, Math.round(elapsed / this.dt));
      if (n > 100) n = 100; // タブ復帰などで暴走しない
      for (let i = 0; i < n; i++) this._substep();
    }

    _substep() {
      const dt = this.dt, g = this.g, balls = this.balls;
      this.time += dt;
      for (const b of balls) {
        b.vy += g * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > this.maxSpeed) { const k = this.maxSpeed / sp; b.vx *= k; b.vy *= k; }
        b.x += b.vx * dt; b.y += b.vy * dt; b.age += dt;
      }
      // 風車の自由回転（減衰）
      for (const s of this.spinners) { s.angle += s.omega * dt; s.omega *= (1 - 0.6 * dt); }

      for (const b of balls) {
        const cx = Math.floor(b.x / this.cell), cy = Math.floor(b.y / this.cell);
        const bucket = this.grid.get(this._key(cx, cy));
        if (bucket) {
          for (const nl of bucket.nails) this._collideNail(b, nl);
          for (const sg of bucket.segs) this._collideSeg(b, sg);
        }
        for (const id in this.dynamic) { const arr = this.dynamic[id]; for (let i = 0; i < arr.length; i++) this._collideSeg(b, arr[i]); }
        for (const s of this.spinners) this._collideSpinner(b, s);
      }
      // 玉同士
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) this._collideBalls(balls[i], balls[j]);

      // センサー・場外・玉詰まり
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        let removed = false;
        for (const z of this.zones) {
          if (!z.enabled) { continue; }
          const inside = b.x >= z.x1 && b.x <= z.x2 && b.y >= z.y1 && b.y <= z.y2;
          if (inside) {
            if (z.type === 'capture' || z.type === 'out') {
              this.events.push({ type: 'zone', zone: z, ball: b });
              balls.splice(i, 1); removed = true; break;
            } else if (!b.zoneIn.has(z.id)) {
              b.zoneIn.add(z.id);
              if (!z.once || !b.passed.has(z.id)) { b.passed.add(z.id); this.events.push({ type: 'zone', zone: z, ball: b }); }
            }
          } else if (b.zoneIn.has(z.id)) b.zoneIn.delete(z.id);
        }
        if (removed) continue;
        if (b.y > this.height + 30 || b.x < -30 || b.x > this.width + 30 || b.y < -60) {
          this.events.push({ type: 'lost', ball: b }); balls.splice(i, 1); continue;
        }
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < 25 && b.age > 0.3) { b.still += dt; } else b.still = 0;
        if (b.still > this.stuckTime) { // 玉詰まり: ガラスを叩く相当の小突き
          b.vx += (this.rand() - 0.5) * 300; b.vy -= 120 + this.rand() * 120; b.still = 0;
          this.events.push({ type: 'stuck', ball: b });
        }
      }
    }

    _collideNail(b, n) {
      const dx = b.x - n.x, dy = b.y - n.y, rr = b.r + n.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      let nx = dx / d, ny = dy / d;
      // 法線ゆらぎ（釘の微細なばらつき・玉の回転の代用）
      const j = (this.rand() - 0.5) * 2 * this.nailJitter, c = Math.cos(j), s = Math.sin(j);
      const jx = nx * c - ny * s, jy = nx * s + ny * c;
      b.x = n.x + nx * rr; b.y = n.y + ny * rr;
      const vn = b.vx * jx + b.vy * jy;
      if (vn < 0) {
        const e = this.restitution.nail + (this.rand() - 0.5) * 0.12;
        b.vx -= (1 + e) * vn * jx; b.vy -= (1 + e) * vn * jy;
        // 接線減衰（クーロン: 法線インパルスに比例、接線速度を超えない）
        const tx = -jy, ty = jx, vt = b.vx * tx + b.vy * ty;
        const dvt = Math.min(Math.abs(vt), this.friction.nail * (1 + e) * (-vn)) * Math.sign(vt);
        b.vx -= dvt * tx; b.vy -= dvt * ty;
        b.hits++;
        if (-vn < 60 && jy < -0.9) b.vx += (this.rand() - 0.5) * 80; // 釘頭に静止しない（実機の釘頭は丸い）
        if (!(b.lastNail === n.id && this.time - b.lastNailT < 0.02)) this.events.push({ type: 'nail', ball: b, v: -vn, nail: n });
        b.lastNail = n.id; b.lastNailT = this.time;
      }
    }

    _collideSeg(b, s) {
      if (s.oneWay && !b.inPlay) return;
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
      const L2 = ex * ex + ey * ey; if (L2 === 0) return;
      let t = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = s.x1 + ex * t, py = s.y1 + ey * t;
      const dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy;
      if (d2 >= b.r * b.r || d2 === 0) return;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      b.x = px + nx * b.r; b.y = py + ny * b.r;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const e = s.rest != null ? s.rest : this.restitution.wall;
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty, f = s.fric != null ? s.fric : this.friction.wall;
        const dvt = Math.min(Math.abs(vt), f * (1 + e) * (-vn)) * Math.sign(vt);
        b.vx -= dvt * tx; b.vy -= dvt * ty;
        if (-vn > 120) this.events.push({ type: 'wall', ball: b, v: -vn, seg: s });
        if (s.hop) this._hop(b, s, t, L2, nx, ny);
      } else {
        if (s.hop) this._hop(b, s, t, L2, nx, ny);
        // 転がり抵抗（接触しつつ滑っている）
        const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty, f = this.friction.roll;
        b.vx -= vt * f * tx; b.vy -= vt * f * ty;
      }
    }

    _hop(b, s, t, L2, nx, ny) {
      const idx = Math.floor(t * Math.sqrt(L2) / s.hop.spacing);
      if (b.hopSeg === s && b.hopIdx === idx) return;
      b.hopSeg = s; b.hopIdx = idx;
      const v = s.hop.v * (0.5 + this.rand());
      b.vx += nx * v; b.vy += ny * v;
      b.vx += (this.rand() - 0.5) * s.hop.v * 0.3; // 横方向のばらつき
      this.events.push({ type: 'nail', ball: b, v: v * 0.8, nail: null });
    }

    _collideSpinner(b, s) {
      const dx = b.x - s.x, dy = b.y - s.y, rr = b.r + s.r;
      const d2 = dx * dx + dy * dy; if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      // 羽根の位相で法線を揺らす（羽根先端か谷かで弾き方が変わる）
      const ang = Math.atan2(dy, dx);
      const phase = ((ang - s.angle) * s.blades) % (2 * Math.PI);
      const j = Math.sin(phase) * 0.35 + (this.rand() - 0.5) * 0.2;
      const c = Math.cos(j), sn = Math.sin(j);
      const nx0 = dx / d, ny0 = dy / d, nx = nx0 * c - ny0 * sn, ny = nx0 * sn + ny0 * c;
      b.x = s.x + nx0 * rr; b.y = s.y + ny0 * rr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const e = this.restitution.spinner;
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        // 接線: 羽根の周速と玉の接線速度を交換ぎみに
        const tx = -ny0, ty = nx0;
        const vt = b.vx * tx + b.vy * ty, surf = s.omega * s.r;
        const dv = (surf - vt) * 0.45;
        b.vx += dv * tx; b.vy += dv * ty;
        s.omega -= dv / s.r * 0.9;
        this.events.push({ type: 'spinner', ball: b, v: -vn, spinner: s });
      }
    }

    _collideBalls(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = (rr - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const e = this.restitution.ball, jimp = -(1 + e) * vn / 2;
        a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
        if (-vn > 150) this.events.push({ type: 'ball', ball: a, other: b, v: -vn });
      }
    }

    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  const api = { World, BALL_R, NAIL_R, makeRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PachiPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);

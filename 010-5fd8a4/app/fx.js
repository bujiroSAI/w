// おとはた — WebGL演出レイヤー（依存ゼロ・GPUパーティクル）
// 正解の瞬間を「その色の光」で派手に祝う。色は学習内容なので、
// 使う色は当該ボタンの色と白だけに限定する（家訓: 彩度は旗=ボタンにのみ）。
'use strict';

const FX = (() => {
  const cv = document.getElementById('fx');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gl = null;
  try { gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true }); } catch (e) {}
  if (reduced) return { explode: () => {}, tap: () => {} };

  // ---- Canvas2D フォールバック（WebGLが取れない環境でも光は出す） ----
  if (!gl) {
    const cx2 = cv.getContext('2d');
    let P2 = [], raf2 = null, dpr2 = 1;
    function size2() {
      dpr2 = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr2; cv.height = innerHeight * dpr2;
      cx2.setTransform(dpr2, 0, 0, dpr2, 0, 0);
    }
    window.addEventListener('resize', size2);
    size2();
    function tick2() {
      raf2 = requestAnimationFrame(tick2);
      cx2.clearRect(0, 0, innerWidth, innerHeight);
      P2 = P2.filter(p => p.life > 0);
      if (P2.length === 0) { cancelAnimationFrame(raf2); raf2 = null; return; }
      cx2.globalCompositeOperation = 'lighter';
      for (const p of P2) {
        p.vy += p.grav; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx * 6; p.y += p.vy * 6;
        p.life -= p.decay; p.tw += p.twf;
        const twinkle = p.twf ? (0.6 + 0.4 * Math.sin(p.tw)) : 1;
        const a = Math.max(0, Math.min(1, p.life * 1.4)) * twinkle;
        cx2.globalAlpha = a;
        cx2.fillStyle = p.css;
        cx2.beginPath();
        cx2.arc(p.x, p.y, p.sz * (0.5 + p.life * 0.5), 0, Math.PI * 2);
        cx2.fill();
      }
      cx2.globalAlpha = 1;
      cx2.globalCompositeOperation = 'source-over';
    }
    function go2() { if (!raf2) raf2 = requestAnimationFrame(tick2); }
    function add2(css, x, y, n, speed, sizeMul, ring) {
      for (let i = 0; i < n; i++) {
        const a = ring ? (i / n) * Math.PI * 2 : Math.random() * Math.PI * 2;
        const sp = ring ? speed : (0.25 + Math.random() * Math.random()) * speed;
        P2.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (ring ? 0 : speed * 0.16),
          life: 1, decay: ring ? 0.03 : 0.01 + Math.random() * 0.014,
          sz: (ring ? 5 : 2.5 + Math.random() * 6) * sizeMul,
          tw: Math.random() * 6, twf: ring ? 0 : 0.3,
          css: Math.random() < 0.25 ? '#FFFFFF' : css, grav: ring ? 0 : 0.05, drag: ring ? 0.96 : 0.985 });
      }
      go2();
    }
    return {
      explode(color, x, y, power) {
        if (power >= 2) { add2('#FFFFFF', x, y, 1, 0, 26, false); add2(color, x, y, 320, 15, 1.2); add2(color, x, y, 70, 12, 1, true); }
        else if (power === 1) { add2(color, x, y, 190, 11, 1); add2(color, x, y, 50, 9, 1, true); }
        else { add2(color, x, y, 70, 7, 0.8); }
      },
      tap(color, x, y) { add2(color, x, y, 24, 4.5, 0.7); },
    };
  }

  const VS = `
attribute vec2 aPos; attribute float aSize; attribute vec4 aColor;
uniform vec2 uRes;
varying vec4 vColor;
void main(){
  vec2 clip = (aPos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}`;
  const FS = `
precision mediump float;
varying vec4 vColor;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  // 中心が眩しく、縁がすっと消える光の粒
  float a = smoothstep(0.5, 0.0, r);
  a = a * a;
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, vColor.a * a);
}`;
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    size: gl.getAttribLocation(prog, 'aSize'),
    color: gl.getAttribLocation(prog, 'aColor'),
    res: gl.getUniformLocation(prog, 'uRes'),
  };
  const buf = gl.createBuffer();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 加算寄りの光合成

  let dpr = 1;
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    gl.viewport(0, 0, cv.width, cv.height);
  }
  window.addEventListener('resize', size);
  size();

  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // 粒: {x,y,vx,vy,life,decay,sz,tw(明滅位相),twf,rgb,ring}
  let P = [];
  let raf = null;
  let last = 0;

  function spawnBurst(rgb, x, y, n, speed, sizeMul) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.25 + Math.random() * Math.random()) * speed;
      const white = Math.random() < 0.22;
      P.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.16,
        life: 1, decay: 0.008 + Math.random() * 0.014,
        sz: (3 + Math.random() * 9) * sizeMul,
        tw: Math.random() * Math.PI * 2, twf: 0.25 + Math.random() * 0.35,
        rgb: white ? [1, 1, 1] : rgb, grav: 0.05, drag: 0.985,
      });
    }
  }
  // 衝撃波: 円周に沿った粒が外向きに走る
  function spawnRing(rgb, x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      P.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 1, decay: 0.028, sz: 7, tw: 0, twf: 0,
        rgb: Math.random() < 0.5 ? [1, 1, 1] : rgb, grav: 0, drag: 0.96,
      });
    }
  }
  // 中心フラッシュ: 大きな白い1粒が急減衰
  function spawnFlash(x, y, sz) {
    P.push({ x, y, vx: 0, vy: 0, life: 1, decay: 0.07, sz, tw: 0, twf: 0, rgb: [1, 1, 1], grav: 0, drag: 1 });
  }

  const arr = new Float32Array(7 * 4096);
  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(2.2, (t - last) / 16.7) || 1;
    last = t;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    P = P.filter(p => p.life > 0);
    if (P.length === 0) { cancelAnimationFrame(raf); raf = null; return; }
    let k = 0;
    const n = Math.min(P.length, 4096);
    for (let i = 0; i < n; i++) {
      const p = P[i];
      p.vy += p.grav * dt;
      p.vx *= Math.pow(p.drag, dt); p.vy *= Math.pow(p.drag, dt);
      p.x += p.vx * dt * 6; p.y += p.vy * dt * 6;
      p.life -= p.decay * dt;
      p.tw += p.twf * dt;
      const twinkle = p.twf ? (0.6 + 0.4 * Math.sin(p.tw)) : 1;
      arr[k++] = p.x * dpr; arr[k++] = p.y * dpr;
      arr[k++] = p.sz * dpr * (0.5 + p.life * 0.5) * twinkle * 2.2;
      arr[k++] = p.rgb[0]; arr[k++] = p.rgb[1]; arr[k++] = p.rgb[2];
      arr[k++] = Math.max(0, Math.min(1, p.life * 1.5));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, k), gl.DYNAMIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.size);
    gl.vertexAttribPointer(loc.size, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(loc.color);
    gl.vertexAttribPointer(loc.color, 4, gl.FLOAT, false, stride, 12);
    gl.uniform2f(loc.res, cv.width, cv.height);
    gl.drawArrays(gl.POINTS, 0, k / 7);
  }
  function go() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

  // power: 0=ちいさく 1=正解 2=ビッグ
  function explode(color, x, y, power) {
    const rgb = hex(color);
    if (power >= 2) {
      spawnFlash(x, y, 260);
      spawnBurst(rgb, x, y, 620, 16, 1.25);
      spawnRing(rgb, x, y, 90, 13);
      setTimeout(() => { spawnRing(rgb, x, y, 70, 10); go(); }, 150);
    } else if (power === 1) {
      spawnFlash(x, y, 170);
      spawnBurst(rgb, x, y, 340, 12, 1);
      spawnRing(rgb, x, y, 64, 10);
    } else {
      spawnFlash(x, y, 90);
      spawnBurst(rgb, x, y, 130, 8, 0.8);
    }
    go();
  }
  // タップの手応え（小さな光の飛沫）
  function tap(color, x, y) {
    spawnBurst(hex(color), x, y, 40, 5, 0.7);
    go();
  }
  return { explode, tap };
})();

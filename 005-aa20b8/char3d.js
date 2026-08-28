// おとはた — キャラのLive2D風レンダラ（依存ゼロWebGL）
// 本体: 目を消したテクスチャをグリッドメッシュに貼り、下端固定で上ほど動く変形
// （呼吸のsquash&stretch・左右のしなり）をGPUで掛ける。
// 目: Canvas2Dオーバーレイでプログラム描画——視線がゆっくり泳ぎ、ときどきまばたきする。
// 歩幅の大きい動き（ステップダンス・ジャンプ）は既存CSSアニメがwrapperに掛かる二層構成。
// WebGLが取れない環境では app.js 側が従来の静止画表示に自動フォールバックする。
'use strict';

const Char3D = (() => {
  // 二層構成: 目レイヤー(Canvas2D)は全環境・メッシュ変形(WebGL)は可能な環境のみ上乗せ
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // neutral.png から機械計測した目の座標（uv・生成: 2026-08-28）
  const EYES = [
    { cx: 0.4658, cy: 0.1771, rx: 0.0479, ry: 0.0625, pr: 0.0297 },
    { cx: 0.7100, cy: 0.1802, rx: 0.0502, ry: 0.0656, pr: 0.0297 },
  ];
  const ASPECT = 438 / 480; // 基準テクスチャの縦横比

  const VS = `
attribute vec2 aUV;
uniform float uBend, uBreath, uAspectFit;
varying vec2 vUV;
// 下端(uv.y=1)固定・上ほど動く。呼吸は腹を中心に膨らむ。
vec2 deform(vec2 uv, float bend, float breath){
  float wy = 1.0 - uv.y;
  float x = uv.x + bend * wy * wy * 0.10;
  float cx = 0.5 + (uv.x - 0.5) * (1.0 + breath * 0.030 * (1.0 - wy * 0.5));
  x = mix(x, cx + (x - uv.x), 1.0);
  float y = uv.y - breath * 0.018 * wy;
  return vec2(x, y);
}
void main(){
  vUV = aUV;
  vec2 p = deform(aUV, uBend, uBreath);
  vec2 clip = vec2((p.x * uAspectFit + (1.0 - uAspectFit) * 0.5) * 2.0 - 1.0, 1.0 - p.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;
  const FS = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
void main(){ gl_FragColor = texture2D(uTex, vUV); }`;

  // JS側でシェーダと同じ変形を計算（目の追従用）
  function deformJS(u, v, bend, breath) {
    const wy = 1 - v;
    let x = u + bend * wy * wy * 0.10;
    x = 0.5 + (x - 0.5) * (1 + breath * 0.030 * (1 - wy * 0.5));
    const y = v - breath * 0.018 * wy;
    return [x, y];
  }

  const GRID = 24;
  const instances = [];
  let raf = null;

  function buildProgram(gl) {
    function sh(t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p); gl.useProgram(p);
    return p;
  }

  function buildMesh(gl) {
    const verts = [], idx = [];
    for (let y = 0; y <= GRID; y++) for (let x = 0; x <= GRID; x++) verts.push(x / GRID, y / GRID);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const a = y * (GRID + 1) + x, b = a + 1, c = a + GRID + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return { vb, ib, n: idx.length };
  }

  function loadTex(inst, name) {
    if (inst.tex[name]) return;
    const gl = inst.gl;
    const t = gl.createTexture();
    inst.tex[name] = { t, ready: false, w: 1, h: 1 };
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      inst.tex[name].ready = true;
      inst.tex[name].w = img.width; inst.tex[name].h = img.height;
    };
    img.src = 'char/' + (name === 'neutral' ? 'body' : name) + '.png';
  }

  function attach(wrapper) {
    const glc = wrapper.querySelector('.c3-gl');
    const eyec = wrapper.querySelector('.c3-eyes');
    let gl = null;
    try { gl = glc.getContext('webgl', { alpha: true, premultipliedAlpha: true }) || glc.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true }); } catch (e) {}
    let prog = null, mesh = null;
    if (gl) {
      prog = buildProgram(gl);
      mesh = buildMesh(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // WebGLなし: 本体は<img>で表示し、目レイヤーだけ動かす
      glc.style.display = 'none';
      const img = document.createElement('img');
      img.className = 'c3-body';
      img.src = 'char/body.png';
      img.draggable = false;
      wrapper.insertBefore(img, eyec);
    }
    const inst = {
      wrapper, glc, eyec, gl, prog, mesh,
      loc: gl ? {
        uv: gl.getAttribLocation(prog, 'aUV'),
        bend: gl.getUniformLocation(prog, 'uBend'),
        breath: gl.getUniformLocation(prog, 'uBreath'),
        fit: gl.getUniformLocation(prog, 'uAspectFit'),
        tex: gl.getUniformLocation(prog, 'uTex'),
      } : null,
      tex: {}, pose: 'neutral',
      t0: performance.now() + Math.random() * 2000, // 個体で位相をずらす
      blink: 0, nextBlink: performance.now() + 1500 + Math.random() * 3000,
      gaze: { x: 0, y: 0, tx: 0, ty: 0, next: 0 },
      sized: false,
    };
    if (gl) loadTex(inst, 'neutral');
    instances.push(inst);
    go();
    return inst;
  }

  function setPose(wrapper, name) {
    const inst = instances.find(i => i.wrapper === wrapper);
    if (!inst) return;
    inst.pose = name;
    if (inst.gl) { loadTex(inst, name); return; }
    const img = wrapper.querySelector('.c3-body');
    if (img) img.src = 'char/' + (name === 'neutral' ? 'body' : name) + '.png';
  }

  function sizeIf(inst) {
    const r = inst.wrapper.getBoundingClientRect();
    if (r.width < 4) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (inst.eyec.width !== W) {
      inst.eyec.width = W; inst.eyec.height = H;
      if (inst.gl) { inst.glc.width = W; inst.glc.height = H; inst.gl.viewport(0, 0, W, H); }
    }
    return true;
  }

  function drawEyes(inst, bend, breath, t) {
    const c = inst.eyec.getContext('2d');
    const W = inst.eyec.width, H = inst.eyec.height;
    c.clearRect(0, 0, W, H);
    if (inst.pose !== 'neutral') return;
    // まばたき
    let lid = 1;
    if (t > inst.nextBlink) {
      const ph = (t - inst.nextBlink) / 130;
      if (ph < 1) lid = 1 - ph; else if (ph < 2) lid = ph - 1;
      else { inst.nextBlink = t + 2200 + Math.random() * 4200; lid = 1; }
    }
    // 視線: ゆっくり泳ぐ
    const g = inst.gaze;
    if (t > g.next) { g.tx = (Math.random() - 0.5) * 1.1; g.ty = (Math.random() - 0.4) * 0.8; g.next = t + 1400 + Math.random() * 2600; }
    g.x += (g.tx - g.x) * 0.04; g.y += (g.ty - g.y) * 0.04;
    const fit = 1; // uv→px（幅フル・レターボックスなし: wrapperはASPECT固定）
    for (const e of EYES) {
      const [dx, dy] = deformJS(e.cx, e.cy, bend, breath);
      const cx = dx * W * fit, cy = dy * H;
      const rx = e.rx * W, ry = e.ry * H * Math.max(0.06, lid);
      // 白目
      c.fillStyle = '#FFFFFF';
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
      if (lid > 0.25) {
        // 黒目（視線ぶんオフセット・白目内にクランプ）
        const pr = e.pr * W;
        const ox = g.x * (rx - pr) * 0.8, oy = g.y * (ry - pr * 0.9) * 0.8;
        c.fillStyle = '#221C18';
        c.beginPath(); c.ellipse(cx + ox, cy + oy, pr, pr * Math.min(1, lid * 1.3), 0, 0, Math.PI * 2); c.fill();
        // ハイライト
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.beginPath(); c.arc(cx + ox - pr * 0.3, cy + oy - pr * 0.35, pr * 0.22, 0, Math.PI * 2); c.fill();
      }
      // 閉じ目の線
      if (lid <= 0.25) {
        c.strokeStyle = '#4A3B2E'; c.lineWidth = Math.max(2, W * 0.008); c.lineCap = 'round';
        c.beginPath(); c.moveTo(cx - rx * 0.7, cy); c.quadraticCurveTo(cx, cy + ry * 2.2, cx + rx * 0.7, cy); c.stroke();
      }
    }
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    let any = false;
    for (const inst of instances) {
      if (!inst.wrapper.isConnected || inst.wrapper.offsetParent === null) continue;
      if (!sizeIf(inst)) continue;
      any = true;
      const tt = (t - inst.t0) / 1000;
      const grooving = inst.wrapper.closest('.groove, .sing') !== null;
      // 呼吸としなり（grooveで速く・大きく）
      const breath = reduced ? 0 : Math.sin(tt * (grooving ? 6.4 : 2.1)) * (grooving ? 1.0 : 0.55);
      const bend = reduced ? 0 : Math.sin(tt * (grooving ? 3.2 : 0.9) + 1.3) * (grooving ? 0.5 : 0.22);
      if (!inst.gl) { drawEyes(inst, 0, 0, t); continue; }
      const tex = inst.tex[inst.pose] && inst.tex[inst.pose].ready ? inst.tex[inst.pose]
                : (inst.tex.neutral && inst.tex.neutral.ready ? inst.tex.neutral : null);
      if (!tex) continue;
      const gl = inst.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(inst.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst.mesh.vb);
      gl.enableVertexAttribArray(inst.loc.uv);
      gl.vertexAttribPointer(inst.loc.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, inst.mesh.ib);
      gl.uniform1f(inst.loc.bend, bend);
      gl.uniform1f(inst.loc.breath, breath);
      gl.uniform1f(inst.loc.fit, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.t);
      gl.uniform1i(inst.loc.tex, 0);
      gl.drawElements(gl.TRIANGLES, inst.mesh.n, gl.UNSIGNED_SHORT, 0);
      drawEyes(inst, bend, breath, t);
    }
    if (!any && instances.length === 0) { cancelAnimationFrame(raf); raf = null; }
  }
  function go() { if (!raf) raf = requestAnimationFrame(tick); }

  return { supported: true, attach, setPose, ASPECT };
})();

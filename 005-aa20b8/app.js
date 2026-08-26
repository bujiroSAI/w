// おとはた — アプリ本体
// 流れ: ホーム → セッション(12試行・約2分) → シール → おしまい
// 方法論: 和音は完全同時提示 / 間違いは叱らず正解旗を光らせて同じ和音を再提示 /
//         新しい和音は混ぜる前に単独導入 / 効果音は非音程

'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ============ キャラクター（ことりの指揮者・ピアノ台の上） ============
  const CHAR_SVG = `
  <svg viewBox="0 0 200 192" xmlns="http://www.w3.org/2000/svg">
    <!-- ピアノ台 -->
    <g>
      <rect x="34" y="128" width="132" height="52" rx="10" fill="#A9805A" stroke="#82603F" stroke-width="3"/>
      <rect x="42" y="136" width="116" height="18" rx="4" fill="#FFFDF6" stroke="#82603F" stroke-width="2.5"/>
      <g fill="#4A3B2E">
        <rect x="52" y="136" width="7" height="11" rx="1.5"/>
        <rect x="66" y="136" width="7" height="11" rx="1.5"/>
        <rect x="88" y="136" width="7" height="11" rx="1.5"/>
        <rect x="102" y="136" width="7" height="11" rx="1.5"/>
        <rect x="116" y="136" width="7" height="11" rx="1.5"/>
        <rect x="138" y="136" width="7" height="11" rx="1.5"/>
      </g>
      <rect x="42" y="162" width="116" height="6" rx="3" fill="#82603F" opacity="0.5"/>
    </g>
    <!-- おんぷ（うたうとき） -->
    <text class="note-puff" x="34" y="52" font-size="26" fill="#93836D">♪</text>
    <text class="note-puff" x="150" y="40" font-size="30" fill="#93836D" style="animation-delay:0.18s">♫</text>
    <!-- ことり -->
    <g stroke="#4A3B2E" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="100" cy="88" rx="41" ry="37" fill="#FFFDF6"/>
      <path d="M63 92 Q52 100 58 112 Q70 108 74 100" fill="#DCCBA6"/>
      <path d="M137 92 Q148 100 142 112 Q130 108 126 100" fill="#DCCBA6"/>
      <path d="M100 66 l-5 -10 l10 0 z" fill="#DCA95B"/>
      <ellipse cx="100" cy="99" rx="24" ry="18" fill="#F4EBD5" stroke="none"/>
      <path d="M92 108 l0 12 m-6 0 l6 0 l5 -3 M108 108 l0 12 m-6 0 l6 0 l5 -3" fill="none" stroke="#DCA95B"/>
    </g>
    <g fill="#4A3B2E">
      <circle cx="86" cy="84" r="4.6"/>
      <circle cx="114" cy="84" r="4.6"/>
    </g>
    <g fill="#EAD3B8">
      <circle cx="78" cy="94" r="6"/>
      <circle cx="122" cy="94" r="6"/>
    </g>
    <path d="M96 92 Q100 96 104 92" fill="none" stroke="#4A3B2E" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  // ============ 旗のしるし（色覚多様性への冗長コード・WCAG 1.4.1） ============
  // 色が見分けられなくても旗を同定できるようにする。2歳児は「見分けられない」と言えないため、
  // 気づかれないまま「才能がない」と誤解される事故を防ぐのが目的。
  const MARKS = {
    dot:    '<circle cx="12" cy="12" r="8"/>',
    star:   '<path d="M12 3l2.6 6.1 6.6.5-5 4.3 1.5 6.4L12 17l-5.7 3.3 1.5-6.4-5-4.3 6.6-.5z"/>',
    tri:    '<path d="M12 3.5l8.5 15h-17z"/>',
    sq:     '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
    heart:  '<path d="M12 20.5S3.5 15 3.5 9.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.5 1.8c0 5.6-8.5 11.1-8.5 11.1z"/>',
    dia:    '<path d="M12 2.5l9.5 9.5L12 21.5 2.5 12z"/>',
    cross:  '<path d="M9.4 3h5.2v6.4H21v5.2h-6.4V21H9.4v-6.4H3V9.4h6.4z"/>',
    flower: '<g><circle cx="12" cy="5.6" r="3.6"/><circle cx="12" cy="18.4" r="3.6"/><circle cx="5.6" cy="12" r="3.6"/><circle cx="18.4" cy="12" r="3.6"/></g>',
    pent:   '<path d="M12 2.5l9.5 6.9-3.6 11.1H6.1L2.5 9.4z"/>',
    hex:    '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/>',
    moon:   '<path d="M16.5 3a9.5 9.5 0 1 0 0 18 11 11 0 0 1 0-18z"/>',
    ring:   '<path d="M12 2.5A9.5 9.5 0 1 0 12 21.5 9.5 9.5 0 0 0 12 2.5zm0 5.2a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6z"/>',
    bar:    '<rect x="2.5" y="9" width="19" height="6" rx="2"/>',
    up:     '<path d="M12 2.5l8.5 9h-5v10h-7v-10h-5z"/>',
  };
  const markSvg = (id) =>
    `<svg class="flag-mark" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${MARKS[id] || MARKS.dot}</svg>`;

  const chordColor = (c) => (Store.data.settings.cudPalette && c.cud) ? c.cud : c.color;

  // ============ こえ（読み上げ） ============
  const Voice = (() => {
    let ja = null;
    function pick() {
      if (!('speechSynthesis' in window)) return;
      const vs = speechSynthesis.getVoices();
      ja = vs.find(v => v.lang === 'ja-JP' && /Kyoko/i.test(v.name)) ||
           vs.find(v => v.lang && v.lang.indexOf('ja') === 0) || null;
    }
    if ('speechSynthesis' in window) {
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
    function speak(text) {
      if (!Store.data.settings.voice) return;
      if (!('speechSynthesis' in window)) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (ja) u.voice = ja;
        u.lang = 'ja-JP';
        u.rate = 1.0;
        u.pitch = 1.1;
        u.volume = Math.min(1, Store.data.settings.volume + 0.15);
        speechSynthesis.speak(u);
      } catch (e) { /* 声はなくても遊べる */ }
    }
    return { speak };
  })();

  // ============ 紙吹雪（正解した旗の色だけで降らせる＝連合の強化） ============
  const Confetti = (() => {
    const cv = $('#confetti');
    const cx = cv.getContext('2d');
    let parts = [];
    let raf = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function size() {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * d;
      cv.height = innerHeight * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    }
    window.addEventListener('resize', size);
    size();

    function burst(color, x, y, n) {
      if (reduced) return;
      for (let i = 0; i < (n || 60); i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 8;
        parts.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 6,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          w: 7 + Math.random() * 8,
          h: 5 + Math.random() * 6,
          c: Math.random() < 0.28 ? '#FFFDF6' : color,
          life: 1,
        });
      }
      if (!raf) tick();
    }
    function tick() {
      raf = requestAnimationFrame(tick);
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.life > 0);
      if (parts.length === 0) { cancelAnimationFrame(raf); raf = null; return; }
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.011;
        cx.save();
        cx.translate(p.x, p.y);
        cx.rotate(p.rot);
        cx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
        cx.fillStyle = p.c;
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      }
    }
    return { burst };
  })();

  // ============ 画面切替 ============
  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  // ============ ホーム ============
  function renderHome() {
    const st = Store.data.settings;
    const n = Store.todaySessions().length;
    const box = $('#today-dots');
    box.innerHTML = '';
    const cap = Math.max(st.dailyTarget, Math.min(n, 8));
    for (let i = 0; i < Math.min(cap, 8); i++) {
      const d = document.createElement('span');
      d.className = 'td' + (i < n ? ' on' : '');
      box.appendChild(d);
    }
    if (n > 8) {
      const p = document.createElement('span');
      p.className = 'td-plus';
      p.textContent = '+' + (n - 8);
      box.appendChild(p);
    }
    $('#parent-badge').classList.toggle('hidden',
      !(st.autoSuggest && Store.advanceReady()));
  }

  // ============ セッション（試行の状態機械） ============
  let S = null;
  let lastDemo = null; // 直近の「おためし」設定（もういっかい用）
  let wakeLock = null;

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* 非対応なら諦める */ }
  }

  // demo = {flags: n} を渡すと「おためしモード」: 先頭n本の旗で出題し、記録を一切残さない
  function startSession(demo) {
    const st = Store.data.settings;
    Piano.ensure();
    Piano.setVolume(st.volume);
    const intro = !demo && Store.data.introPending;
    S = {
      id: Date.now(),
      start: Date.now(),
      demo: demo || null,
      pool: demo ? CHORDS.slice(0, demo.flags).map(c => c.id) : Store.data.unlocked.slice(),
      idx: 0,
      total: st.trialsPerSession,
      correct: 0,
      mode: intro ? 'intro' : 'mix',
      introChord: intro ? Store.data.introPending : null,
      introLeft: intro ? INTRO_TRIALS : 0,
      current: null,
      corrective: false,
      locked: true,
      lastPicks: [],
      autoReplays: 0,
      waitTimer: null,
      listening: false,
      lastListenAt: -1,
    };
    $('#demo-badge').classList.toggle('hidden', !S.demo);
    keepAwake(true);
    renderDots();
    show('screen-play');
    setTimeout(nextTrial, 500);
  }

  function stopSession() {
    if (S) {
      if (S.waitTimer) clearTimeout(S.waitTimer);
      S.listening = false; // きくじかんのループを止める
    }
    S = null;
    keepAwake(false);
  }

  function renderDots() {
    const box = $('#trial-dots');
    box.innerHTML = '';
    for (let i = 0; i < S.total; i++) {
      const d = document.createElement('span');
      d.className = 'dot' + (i < S.idx ? ' done' : i === S.idx ? ' now' : '');
      box.appendChild(d);
    }
  }

  function speech(text) { $('#speech').textContent = text; }

  function visibleChords() {
    if (S.mode === 'intro') return [CHORD_BY_ID[S.introChord]];
    return S.pool.map(id => CHORD_BY_ID[id]);
  }

  function renderFlags() {
    const box = $('#flags');
    box.innerHTML = '';
    const list = visibleChords();
    // 旗の幅を枚数から決める。14本（最終形）でも1画面に収める。
    // 2歳児のタップ精度（平均4.5mmずれ）を考慮し、下限は実寸2cm角を割らない値に置く。
    const n = list.length;
    const fw = n <= 1 ? 380 : n <= 3 ? 270 : n <= 6 ? 205 : n <= 9 ? 152 : 118;
    box.style.setProperty('--fw', `min(${fw}px, ${Math.floor(88 / Math.min(n, 5))}vw)`);
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'flag' + (S.mode === 'intro' ? ' intro' : '');
      b.dataset.chord = c.id;
      b.setAttribute('aria-label', c.label);
      b.style.setProperty('--flag', chordColor(c));
      b.style.setProperty('--labscale', String(Math.min(1, 3.6 / c.label.length)));
      const mark = Store.data.settings.marks ? markSvg(c.mark) : '';
      b.innerHTML = `<span class="flag-cloth" style="--ink2:${c.ink}">${mark}<span class="flag-label">${c.label}</span></span><span class="flag-pole"></span>`;
      b.addEventListener('pointerdown', () => onFlag(c.id, b));
      box.appendChild(b);
    }
  }

  function pickChord() {
    const ids = S.pool;
    if (ids.length === 1) return ids[0];
    const newest = ids[ids.length - 1];
    let boost = false;
    if (!S.demo) {
      const { acc, n } = Store.chordAccuracy(newest, NEW_CHORD_BOOST.window);
      boost = (n < NEW_CHORD_BOOST.window) || (acc !== null && acc < NEW_CHORD_BOOST.untilAccuracy);
    }
    for (let tries = 0; tries < 6; tries++) {
      let pick;
      if (boost && Math.random() < NEW_CHORD_BOOST.probability) {
        pick = newest;
      } else {
        pick = ids[Math.floor(Math.random() * ids.length)];
      }
      const L = S.lastPicks;
      if (L.length >= 2 && L[L.length - 1] === pick && L[L.length - 2] === pick) continue;
      return pick;
    }
    return ids[Math.floor(Math.random() * ids.length)];
  }

  function playChord(chordId) {
    const c = CHORD_BY_ID[chordId];
    const midis = c.notes.map(NOTE_MIDI);
    const char = $('#char-btn');
    char.classList.remove('sing', 'bounce');
    void char.offsetWidth; // アニメ再発火
    char.classList.add('sing', 'bounce');
    return Piano.chord(midis, { a4: Store.data.settings.pitchA });
  }

  function armWaitTimer() {
    if (S.waitTimer) clearTimeout(S.waitTimer);
    S.waitTimer = setTimeout(() => {
      if (!S || S.locked) return;
      if (S.autoReplays < 2) {
        S.autoReplays++;
        playChord(S.current);
        armWaitTimer();
      }
    }, 9000);
  }

  // 次の試行へ。parentPaced（親子共同モード）では、おとなの「ことりタッチ」を待つ。
  function proceed(delay) {
    if (Store.data.settings.parentPaced) {
      S.pendingNext = true;
      setTimeout(() => {
        if (S && S.pendingNext) speech('ことりを タッチで つぎへ');
      }, delay);
    } else {
      setTimeout(nextTrial, delay);
    }
  }

  // ============ きくじかん（受動的曝露ブロック） ============
  // 答えさせずに「和音→その旗が光る→色名を読み上げ」を数回。Little 2019 の交互配置の実装。
  function runListenBlock(done) {
    if (!S) return;
    S.locked = true;
    S.listening = true;
    renderFlags();
    $('#flags').classList.add('lock');
    speech('きくじかん');
    Voice.speak('きくじかん');

    // 同じ和音が連続すると曝露の多様性が落ちるので、直前と同じものは引き直す
    const pool = S.pool.slice();
    const picks = [];
    for (let i = 0; i < LISTEN_BLOCK.chords; i++) {
      let pick = pool[Math.floor(Math.random() * pool.length)];
      for (let t = 0; t < 5 && pool.length > 1 && pick === picks[picks.length - 1]; t++) {
        pick = pool[Math.floor(Math.random() * pool.length)];
      }
      picks.push(pick);
    }

    let i = 0;
    const step = () => {
      if (!S || !S.listening) return;
      if (i >= picks.length) {
        S.listening = false;
        setTimeout(() => { if (S) done(); }, 500);
        return;
      }
      const id = picks[i++];
      const c = CHORD_BY_ID[id];
      $$('#flags .flag').forEach(f => f.classList.remove('glow', 'fade'));
      playChord(id);
      const el = flagEl(id);
      if (el) {
        el.classList.add('glow');
        $$('#flags .flag').forEach(f => { if (f !== el) f.classList.add('fade'); });
      }
      speech(c.label);
      setTimeout(() => Voice.speak(c.label), 700);
      setTimeout(step, 2600);
    };
    setTimeout(step, 900);
  }

  function nextTrial() {
    if (!S) return;
    S.pendingNext = false;
    if (S.idx >= S.total) { endSession(); return; }
    // きくじかんを挟む（intro中は単独提示そのものが曝露なので挟まない）
    if (Store.data.settings.listenBlocks && S.mode !== 'intro' && S.pool.length >= 2 &&
        S.idx > 0 && S.idx % LISTEN_BLOCK.everyNTrials === 0 && S.lastListenAt !== S.idx) {
      S.lastListenAt = S.idx;
      runListenBlock(nextTrial);
      return;
    }
    S.corrective = false;
    S.autoReplays = 0;
    S.locked = true;

    if (S.mode === 'intro' && S.introLeft <= 0) {
      S.mode = 'mix';
      Store.clearIntro();
    }
    S.current = S.mode === 'intro' ? S.introChord : pickChord();
    S.lastPicks.push(S.current);

    renderFlags();
    renderDots();
    const box = $('#flags');
    box.classList.add('lock');
    speech(S.mode === 'intro' ? 'あたらしい はた！' : 'きいてね');

    setTimeout(() => {
      if (!S) return;
      playChord(S.current);
      if (S.mode === 'intro') {
        const c = CHORD_BY_ID[S.current];
        setTimeout(() => Voice.speak('これは ' + c.label), 900);
      }
      setTimeout(() => {
        if (!S) return;
        S.locked = false;
        box.classList.remove('lock');
        if (S.mode !== 'intro') speech('どの はた かな？');
        armWaitTimer();
      }, 350);
    }, 600);
  }

  function flagEl(chordId) {
    return $(`#flags .flag[data-chord="${chordId}"]`);
  }

  function celebrate(chordId, small) {
    const c = CHORD_BY_ID[chordId];
    const el = flagEl(chordId);
    if (el) {
      el.classList.add('win');
      $$('#flags .flag').forEach(f => {
        if (f !== el) f.classList.add('fade');
      });
      if (!small) {
        const r = el.getBoundingClientRect();
        Confetti.burst(chordColor(c), r.left + r.width / 2, r.top + r.height * 0.3, 70);
      }
    }
    const char = $('#char-btn');
    char.classList.remove('cheer');
    void char.offsetWidth;
    char.classList.add('cheer');
    if (Store.data.settings.sfx) Piano.sfxCorrect();
    const praise = ['せいかい！', 'すごい！', 'やったね！', 'いいね！'];
    Voice.speak(c.label + '。' + praise[Math.floor(Math.random() * praise.length)]);
    speech('せいかい！ ' + c.label);
  }

  function logTrial(ok, corr, tapped) {
    if (S.demo) return; // おためしは記録しない
    Store.addTrial({
      t: Date.now(),
      chord: S.current,
      tapped: tapped || null, // 押した旗（誤答の質の分析に使う）
      ok,
      corr: !!corr || S.mode === 'intro', // 導入試行は正答率統計から除外
      stage: Store.data.unlocked.length,
      sess: S.id,
    });
  }

  function onFlag(chordId, el) {
    if (!S || S.locked) return;
    if (S.waitTimer) clearTimeout(S.waitTimer);

    if (S.corrective) {
      // 訂正モード: 光っている正解旗を探してもらう
      if (chordId === S.current) {
        S.locked = true;
        logTrial(true, true, chordId);
        const g = flagEl(S.current);
        if (g) g.classList.remove('glow');
        celebrate(chordId, true);
        S.idx++;
        if (S.mode === 'intro') S.introLeft--;
        proceed(1300);
      } else {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        if (Store.data.settings.sfx) Piano.sfxSoft();
        armWaitTimer();
      }
      return;
    }

    if (chordId === S.current) {
      S.locked = true;
      logTrial(true, false, chordId);
      S.correct++;
      celebrate(chordId, false);
      S.idx++;
      if (S.mode === 'intro') S.introLeft--;
      proceed(1500);
    } else {
      // まちがい: 叱らない・考えさせない。すぐ正解旗を光らせ、同じ和音をもう一度聞いてタッチしてもらう。
      logTrial(false, false, chordId);
      S.corrective = true;
      S.locked = true;
      if (Store.data.settings.sfx) Piano.sfxSoft();
      el.classList.add('shake');
      const c = CHORD_BY_ID[S.current];
      const g = flagEl(S.current);
      if (g) g.classList.add('glow');
      speech('ひかってる はたを タッチ');
      Voice.speak('これは ' + c.label);
      setTimeout(() => {
        if (!S) return;
        playChord(S.current);
        setTimeout(() => {
          if (!S) return;
          S.locked = false;
          armWaitTimer();
        }, 350);
      }, 1100);
    }
  }

  // ============ セッション終了 → シール ============
  const STICKERS = ['🦁', '🐘', '🐰', '🐼', '🚀', '🚂', '🍓', '🌟', '🐬', '🦒',
                    '🍎', '🐤', '⚽', '🧁', '🦖', '🚒', '🐢', '🎈', '🍌', '🐸'];

  function endSession() {
    if (S.demo) {
      // おためし: 記録・シールなしでそのまま締める
      lastDemo = S.demo;
      stopSession();
      if (Store.data.settings.sfx) Piano.sfxFanfare();
      $('#reward-title').textContent = 'おためし おしまい';
      $('.reward-sub').classList.add('hidden');
      $('#sticker-choices').innerHTML = '';
      $('#reward-actions').classList.remove('hidden');
      show('screen-reward');
      return;
    }
    lastDemo = null;
    const sess = {
      id: S.id, start: S.start, end: Date.now(),
      total: S.total, correct: S.correct,
      stage: Store.data.unlocked.length,
    };
    Store.addSession(sess);
    stopSession();
    if (Store.data.settings.sfx) Piano.sfxFanfare();
    Voice.speak('よくできました！');
    $('#reward-title').textContent = 'よくできました！';
    $('.reward-sub').classList.remove('hidden');

    const box = $('#sticker-choices');
    box.innerHTML = '';
    $('#reward-actions').classList.add('hidden');
    const pool = STICKERS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    let picked = false;
    pool.forEach(emoji => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sticker-choice';
      b.textContent = emoji;
      b.addEventListener('pointerdown', () => {
        if (picked) return;
        picked = true;
        Store.addSticker(emoji);
        b.classList.add('picked');
        $$('.sticker-choice').forEach(x => { if (x !== b) x.classList.add('unpicked'); });
        if (Store.data.settings.sfx) Piano.sfxCorrect();
        Voice.speak('シール ゲット！');
        const r = b.getBoundingClientRect();
        Confetti.burst('#C8B48D', r.left + r.width / 2, r.top + r.height / 2, 40);
        setTimeout(() => $('#reward-actions').classList.remove('hidden'), 700);
      });
      box.appendChild(b);
    });
    show('screen-reward');
  }

  // ============ シールちょう ============
  function renderStickers() {
    const box = $('#sticker-book');
    box.innerHTML = '';
    const xs = Store.data.stickers;
    if (xs.length === 0) {
      const p = document.createElement('p');
      p.className = 'sticker-book-empty';
      p.textContent = 'あそぶと シールが もらえるよ';
      box.appendChild(p);
      return;
    }
    xs.slice().reverse().forEach(s => {
      const d = document.createElement('div');
      d.className = 'sticker-slot';
      d.textContent = s.emoji;
      box.appendChild(d);
    });
  }

  // ============ おうちのかた ============
  function pct(x) { return Math.round(x * 100) + '%'; }

  function renderParent() {
    const d = Store.data;
    // きょう
    const todayS = Store.todaySessions();
    const todayKey = Store.dayKey(Date.now());
    const todayTrials = d.trials.filter(r => Store.dayKey(r.t) === todayKey && !r.corr);
    const todayOk = todayTrials.filter(r => r.ok).length;
    const week = d.sessions.filter(s => Date.now() - s.start < 7 * 86400e3).length;
    $('#p-today').innerHTML = `
      <div class="p-stat"><b>${todayS.length}<small>/${d.settings.dailyTarget}</small></b><span>セッション</span></div>
      <div class="p-stat"><b>${todayTrials.length}</b><span>もんだい</span></div>
      <div class="p-stat"><b>${todayTrials.length ? pct(todayOk / todayTrials.length) : '—'}</b><span>正答率</span></div>
      <div class="p-stat"><b>${(week / 7).toFixed(1)}</b><span>回/日（7日平均・原法は4〜5）</span></div>
      <div class="p-stat"><b>${d.stickers.length}</b><span>シール累計</span></div>`;

    // すすみぐあい
    $('#p-stage-label').textContent = `いまの旗: ${d.unlocked.length} / ${CHORDS.length}本`;
    const rows = CHORDS.map((c, i) => {
      const unlocked = i < d.unlocked.length;
      if (!unlocked) {
        return `<div class="p-chord-row locked">
          <span class="p-chip" style="background:${chordColor(c)}"></span>
          <span class="p-chord-name">${c.label}</span>
          <span class="p-chord-yomi">${c.yomi}</span>
          <span class="p-bar"><i style="width:0"></i></span>
          <span class="p-chord-acc">未解放</span></div>`;
      }
      const { acc, n } = Store.chordAccuracy(c.id, ADVANCE_RULE.perChordWindow);
      const w = acc === null ? 0 : Math.round(acc * 100);
      const good = acc !== null && acc >= ADVANCE_RULE.minAccuracy;
      return `<div class="p-chord-row">
        <span class="p-chip" style="background:${chordColor(c)}"></span>
        <span class="p-chord-name">${c.label}</span>
        <span class="p-chord-yomi">${c.yomi}</span>
        <span class="p-bar${good ? ' good' : ''}"><i style="width:${w}%"></i></span>
        <span class="p-chord-acc">${acc === null ? 'まだ' : pct(acc)}<small> (${n})</small></span></div>`;
    }).join('');

    // まちがいの質（榊原1999のエラー分類）
    // 同じ響きグループ内の混同（例: ドミソ↔ミソド）＝クロマ依存エラー＝
    // 音の高さでなく響きの質を聴き始めたサインで、縦断研究では前進の指標。
    let eq = '';
    const stageSize = d.unlocked.length;
    const groupCount = {};
    d.unlocked.forEach(id => {
      const g = CHORD_BY_ID[id].group;
      groupCount[g] = (groupCount[g] || 0) + 1;
    });
    const hasGroupPair = Object.values(groupCount).some(n => n >= 2);
    const wrongs = d.trials.filter(r => r.stage === stageSize && !r.ok && !r.corr && r.tapped).slice(-50);
    if (hasGroupPair && wrongs.length > 0) {
      let chroma = 0, height = 0;
      wrongs.forEach(r => {
        const a = CHORD_BY_ID[r.chord], b = CHORD_BY_ID[r.tapped];
        if (a && b && a.group === b.group) chroma++; else height++;
      });
      eq = `<p class="p-note">まちがいの質（直近${wrongs.length}件）: <b>響きグループ内 ${chroma}</b> ／ グループ外 ${height}。
      同じ響きグループ内（ドミソ↔ミソド↔ソドミ等）の混同は「高さ」でなく「響きの質」を聴き始めたサインで、研究上は前進の指標。
      6〜7本目で数ヶ月の停滞期が来るのは全事例共通の正常な過程。</p>`;
    }
    $('#p-chords').innerHTML = rows + eq;

    // 進級バナー
    const banner = $('#advance-banner');
    const next = CHORDS[d.unlocked.length];
    if (Store.advanceReady() && next) {
      banner.classList.remove('hidden');
      banner.innerHTML = `<span>🚩 すべての旗が安定しました。次の旗「<b>${next.label}</b>（${next.yomi}）」を追加できます。</span>
        <button class="pill-btn pill-primary" id="btn-advance" type="button">追加する</button>`;
      $('#btn-advance').addEventListener('click', () => {
        const c = Store.unlockNext();
        if (c) {
          banner.classList.add('hidden');
          renderParent();
          alert(`「${c.label}」を追加しました。次のセッションのはじめに、単独で${INTRO_TRIALS}回きかせて導入します。`);
        }
      });
    } else {
      banner.classList.add('hidden');
    }

    // カレンダー
    const cal = Store.calendar(8);
    const cols = [];
    for (let w = 0; w < 8; w++) {
      const cells = cal.slice(w * 7, w * 7 + 7).map(c => {
        const cls = c.count === 0 ? '' : c.count === 1 ? ' c1' : c.count <= 3 ? ' c2' : ' c3';
        return `<span class="p-cal-cell${cls}" title="${c.key}: ${c.count}回"></span>`;
      }).join('');
      cols.push(`<div class="p-cal-col">${cells}</div>`);
    }
    $('#p-cal').innerHTML = cols.join('');

    renderSettings();
    renderGuide();
  }

  function renderSettings() {
    const st = Store.data.settings;
    const box = $('#p-settings');
    box.innerHTML = `
      <div class="p-set-row"><span class="p-set-label">基準ピッチ<small>家のピアノに合わせる（国内の調律は442Hzが多い）</small></span>
        <span class="seg" id="set-pitch">
          <button type="button" data-v="440" class="${st.pitchA === 440 ? 'on' : ''}">440</button>
          <button type="button" data-v="442" class="${st.pitchA === 442 ? 'on' : ''}">442</button>
        </span></div>
      <div class="p-set-row"><span class="p-set-label">すすめかた<small>「おとなと」は、おとなが ことりをタッチして次の問題へ</small></span>
        <span class="seg" id="set-paced">
          <button type="button" data-v="0" class="${!st.parentPaced ? 'on' : ''}">じどう</button>
          <button type="button" data-v="1" class="${st.parentPaced ? 'on' : ''}">おとなと</button>
        </span></div>
      <div class="p-set-row"><span class="p-set-label">1回の問題数<small>2〜3分で終わる量に</small></span>
        <span class="stepper">
          <button type="button" id="set-tri-minus">−</button><b id="set-tri-val">${st.trialsPerSession}</b><button type="button" id="set-tri-plus">＋</button>
        </span></div>
      <div class="p-set-row"><span class="p-set-label">きくじかんを はさむ<small>${LISTEN_BLOCK.everyNTrials}問ごとに、答えずに聴くだけの時間を挟む。研究では、同じ問題数でも答えさせる練習だけだと学習が起きず、聴くだけの時間を交互に挟むと大きく伸びた</small></span>
        <button type="button" class="switch ${st.listenBlocks ? 'on' : ''}" id="set-listen" aria-label="きくじかん"></button></div>
      <div class="p-set-row"><span class="p-set-label">はたに しるしをつける<small>色が見分けにくいお子さま向け（日本人男性の約5%）。色に加えて形でも区別できる</small></span>
        <button type="button" class="switch ${st.marks ? 'on' : ''}" id="set-marks" aria-label="しるし"></button></div>
      <div class="p-set-row"><span class="p-set-label">色覚配慮パレット<small>Okabe-Ito配色に切替。市販の旗教材と色が変わる点に注意</small></span>
        <button type="button" class="switch ${st.cudPalette ? 'on' : ''}" id="set-cud" aria-label="色覚配慮パレット"></button></div>
      <div class="p-set-row"><span class="p-set-label">こえ（色名の読み上げ）</span>
        <button type="button" class="switch ${st.voice ? 'on' : ''}" id="set-voice" aria-label="こえ"></button></div>
      <div class="p-set-row"><span class="p-set-label">効果音</span>
        <button type="button" class="switch ${st.sfx ? 'on' : ''}" id="set-sfx" aria-label="効果音"></button></div>
      <div class="p-set-row"><span class="p-set-label">おんりょう</span>
        <input type="range" id="set-vol" min="0.2" max="1" step="0.05" value="${st.volume}"></div>
      <div class="p-set-row"><span class="p-set-label">進級の提案<small>基準を満たしたら知らせる</small></span>
        <button type="button" class="switch ${st.autoSuggest ? 'on' : ''}" id="set-suggest" aria-label="進級の提案"></button></div>
      <div class="p-set-row"><span class="p-set-label">旗を手動で追加<small>基準を待たずに次の和音へ（非推奨）</small></span>
        <button type="button" class="pill-btn" id="set-force-add" style="padding:8px 20px;font-size:14px">追加</button></div>
      <div class="p-set-row"><span class="p-set-label">おためしプレイ<small>おとなの確認用。全部の旗を先に見られる・記録には一切残らない</small></span>
        <span class="seg" id="set-demo">
          <button type="button" data-v="3">3本</button>
          <button type="button" data-v="9">9本</button>
          <button type="button" data-v="14">14本</button>
        </span></div>`;

    $('#set-pitch').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      st.pitchA = parseInt(b.dataset.v, 10);
      Store.save();
      renderSettings();
    });
    $('#set-paced').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      st.parentPaced = b.dataset.v === '1';
      Store.save();
      renderSettings();
    });
    $('#set-tri-minus').addEventListener('click', () => {
      st.trialsPerSession = Math.max(6, st.trialsPerSession - 2);
      Store.save(); $('#set-tri-val').textContent = st.trialsPerSession;
    });
    $('#set-tri-plus').addEventListener('click', () => {
      st.trialsPerSession = Math.min(30, st.trialsPerSession + 2);
      Store.save(); $('#set-tri-val').textContent = st.trialsPerSession;
    });
    const toggle = (id, key) => {
      $(id).addEventListener('click', () => {
        st[key] = !st[key];
        Store.save();
        $(id).classList.toggle('on', st[key]);
      });
    };
    toggle('#set-listen', 'listenBlocks');
    toggle('#set-voice', 'voice');
    toggle('#set-sfx', 'sfx');
    toggle('#set-suggest', 'autoSuggest');
    ['#set-marks:marks', '#set-cud:cudPalette'].forEach(pair => {
      const [sel, key] = pair.split(':');
      $(sel).addEventListener('click', () => {
        st[key] = !st[key];
        Store.save();
        $(sel).classList.toggle('on', st[key]);
        renderParent(); // 一覧の色見本も即反映
      });
    });
    $('#set-vol').addEventListener('input', (e) => {
      st.volume = parseFloat(e.target.value);
      Store.save();
      Piano.setVolume(st.volume);
    });
    $('#set-force-add').addEventListener('click', () => {
      const next = CHORDS[Store.data.unlocked.length];
      if (!next) { alert('すべての旗を解放済みです。'); return; }
      if (confirm(`「${next.label}（${next.yomi}）」を追加しますか？\n方法論上は、いまの旗が全て95%を超えてから足すのが安全です。`)) {
        Store.unlockNext();
        renderParent();
      }
    });
    $('#set-demo').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      startSession({ flags: parseInt(b.dataset.v, 10) });
    });
  }

  function renderGuide() {
    $('#p-guide').innerHTML = `
      <ol>
        <li><b>1日4〜5回、1回2〜3分。</b>原法（和音同定法）の処方どおり。長く1回やるより、短く毎日。このアプリは${Store.data.settings.trialsPerSession}問で自動的に終わる。</li>
        <li><b>必ずおとなが隣に。</b>2〜5歳のメディア利用は「親と一緒に」が小児科学会・WHOの原則。正解したら一緒によろこぶのが最強のごほうび。設定「すすめかた: おとなと」にすると出題テンポをおとなが握れる。</li>
        <li><b>始まりは「あか（ドミソ）」1本だけ。</b>全部の旗が正解し続けるようになってから1本足す（原法は「100%正答が2週間」・アプリは95%×2週間で提案）。あせって増やさないことが一番の近道。</li>
        <li><b>間違えても教え直すだけ。</b>アプリは正解の旗を光らせて同じ和音をもう一度鳴らす。叱る・がっかりした顔を見せない。</li>
        <li><b>習得中にやらないこと（原法の禁止事項）:</b> 単音あてクイズ／ドレミで歌わせる（階名唱）／和音をバラして弾く（分散）／移調あそび。どれも「響きを丸ごと覚える」プロセスを壊す。単音・相対音感は全部の旗が終わってからの段階。</li>
        <li><b>本物のピアノとの併用は最良。</b>同じ和音を弾いて旗あそびをするのが原法そのもの（このアプリはその持ち歩き版・補助輪）。</li>
        <li><b>「きくじかん」は飛ばさない。</b>${LISTEN_BLOCK.everyNTrials}問ごとに、答えずにただ聴くだけの時間が入る。海外の研究で、<b>同じ問題数でも答えさせる練習だけでは学習が起きず、聴くだけの時間を交互に挟んだ群だけが大きく伸びた</b>（未習の音色にも効果が広がった）。子どもにとっては休憩にもなる。</li>
        <li><b>色が見分けにくいお子さまへ。</b>男性の約5%（日本）は赤と緑の区別が難しい。2歳児は「見分けられない」と言えないため、うまくいかないと「向いていない」と誤解されやすい。設定の<b>「はたに しるしをつける」</b>を入れると、色に加えて形（丸・星・三角…）でも旗を区別できる。訓練上の効果は変わらない——旗は音につける名札であって、名札が色でも形でも音の学習は同じように進む。</li>
        <li><b>iPadは「ホーム画面に追加」で使う。</b>Safariのままだと7日間使わないと記録が消えることがある（iOSの仕様）。共有ボタン→「ホーム画面に追加」。誤操作防止にはiOSの「アクセスガイド」（設定→アクセシビリティ）が便利。</li>
      </ol>
      <p class="p-warn">⚠️ 開始年齢がすべて: 縦断研究で習得が確認されているのは2〜6歳開始（Sakakibara 2014・継続22人全員が習得）。7歳以降の開始は急に難しくなる。<br>
      ⚠️ 絶対音感は万能ではない: 音楽性の必須条件ではなく、移調が苦手になる等の指摘もある。このアプリは習得後に相対音感の段階へ進むロードマップを前提にしている。<br>
      ⚠️ 1日の合計は10〜15分（WHOの「2〜4歳は1日60分以内」の枠内）。<br>
      ※ 本アプリは公刊の学術論文（和音同定法の縦断研究）に基づく独立実装であり、特定の教室・団体・書籍の公認や提携によるものではない。</p>`;
  }

  // ============ ペアレンタルゲート（3秒ながおし） ============
  (() => {
    const btn = $('#btn-parent');
    let t0 = null;
    let timer = null;
    const HOLD = 2600;
    // rAFでなくintervalで進める: ホールド中に画面が非表示になっても止まらない
    function tick() {
      const p = Math.min(1, (Date.now() - t0) / HOLD);
      btn.style.setProperty('--hold', p);
      if (p >= 1) {
        cancel();
        renderParent();
        show('screen-parent');
      }
    }
    function cancel() {
      if (timer) clearInterval(timer);
      timer = null;
      btn.classList.remove('holding');
      btn.style.setProperty('--hold', 0);
    }
    btn.addEventListener('pointerdown', () => {
      t0 = Date.now();
      btn.classList.add('holding');
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 90);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      btn.addEventListener(ev, () => {
        if (timer && Date.now() - t0 < HOLD) {
          const txt = btn.querySelector('.corner-text');
          if (txt) {
            txt.textContent = '3びょう おす';
            setTimeout(() => { txt.textContent = 'おうちのかた'; }, 1500);
          }
        }
        cancel();
      }));
  })();

  // ============ データ操作 ============
  $('#btn-export').addEventListener('click', async () => {
    const json = Store.exportJSON();
    try {
      await navigator.clipboard.writeText(json);
      $('#p-data-msg').textContent = `記録をクリップボードにコピーしました（${Store.data.trials.length}試行）。`;
    } catch (e) {
      $('#p-data-msg').textContent = 'コピーできませんでした。';
    }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('すべての記録・シール・進級状況を消しますか？')) return;
    if (!confirm('元に戻せません。本当に消しますか？')) return;
    Store.reset();
    renderParent();
    renderHome();
  });

  // ============ 配線 ============
  $('#btn-play').addEventListener('pointerdown', () => {
    Piano.unlock();
    startSession();
  });
  $('#btn-home').addEventListener('pointerdown', () => {
    stopSession();
    renderHome();
    show('screen-home');
  });
  $('#btn-again').addEventListener('pointerdown', () => startSession(lastDemo));
  $('#btn-finish').addEventListener('pointerdown', () => {
    renderHome();
    show('screen-home');
    Voice.speak('また あそぼうね');
  });
  $('#btn-stickers').addEventListener('pointerdown', () => {
    renderStickers();
    show('screen-stickers');
  });
  $$('.js-back-home').forEach(b => b.addEventListener('pointerdown', () => {
    renderHome();
    show('screen-home');
  }));
  $('#char-btn').addEventListener('pointerdown', () => {
    if (!S) return;
    if (S.pendingNext) { nextTrial(); return; }
    if (S.current) playChord(S.current);
  });

  // 最初のタッチでオーディオをアンロック（iOS）
  document.addEventListener('pointerdown', function once() {
    Piano.unlock();
    document.removeEventListener('pointerdown', once);
  }, { once: true });

  // 右クリック・長押しメニュー抑止
  document.addEventListener('contextmenu', e => e.preventDefault());

  // Service Worker（https/localhostのみ）
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ============ 起動 ============
  Store.load();
  $('#home-char').innerHTML = CHAR_SVG;
  $('#char-btn').innerHTML = CHAR_SVG;
  renderHome();
})();

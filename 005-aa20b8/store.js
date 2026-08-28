// おとはた — 永続化と統計（localStorage）
// すべての試行を記録し、進級判定・親ダッシュボードの計器はここから計算する。

'use strict';

const Store = (() => {
  const KEY = 'otohata_v1';
  const MAX_TRIALS = 8000; // 古い試行は間引く（統計には十分）

  let data = null;

  function fresh() {
    return {
      v: 1,
      createdAt: Date.now(),
      settings: Object.assign({}, DEFAULT_SETTINGS),
      unlocked: ['aka'],        // 解放済み和音（CHORDS順の先頭からの部分列）
      introPending: 'aka',      // 次セッション冒頭で単独導入する和音id
      trials: [],               // {t, chord, tapped, ok, corr(訂正試行か), stage, sess}
      sessions: [],             // {id, start, end, total, correct, stage, sticker}
      stickers: [],             // {emoji, t}
      suggestedAt: null,        // 進級提案を出した時刻（重複提案の抑制）
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : fresh();
    } catch (e) {
      data = fresh();
    }
    // 設定の欠損キーを補完
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    return data;
  }

  function save() {
    if (data.trials.length > MAX_TRIALS) {
      data.trials = data.trials.slice(data.trials.length - MAX_TRIALS);
    }
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 容量超過時は無視 */ }
  }

  function reset() { data = fresh(); save(); }

  // ---- 記録 ----

  function addTrial(rec) { data.trials.push(rec); save(); }

  function addSession(sess) { data.sessions.push(sess); save(); }

  function addSticker(emoji) { data.stickers.push({ emoji, t: Date.now() }); save(); }

  function unlockNext() {
    const next = CHORDS[data.unlocked.length];
    if (!next) return null;
    data.unlocked.push(next.id);
    data.introPending = next.id;
    data.suggestedAt = null;
    save();
    return next;
  }

  function clearIntro() { data.introPending = null; save(); }

  // ---- 統計 ----

  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 和音ごとの直近n試行の正答率（訂正試行は除外）
  function chordAccuracy(chordId, n) {
    const xs = data.trials.filter(r => r.chord === chordId && !r.corr).slice(-n);
    if (xs.length === 0) return { acc: null, n: 0 };
    const ok = xs.filter(r => r.ok).length;
    return { acc: ok / xs.length, n: xs.length };
  }

  // 現ステージ（unlocked数が今と同じ）の試行群
  function stageTrials() {
    const size = data.unlocked.length;
    return data.trials.filter(r => r.stage === size && !r.corr);
  }

  function stageDays() {
    return new Set(stageTrials().map(r => dayKey(r.t))).size;
  }

  // 進級条件を満たしているか
  // 進級までの残り（親向け進捗表示に使う）
  function advanceStatus() {
    if (data.unlocked.length >= CHORDS.length) return null;
    const st = stageTrials();
    const days = stageDays();
    let weakest = null;
    let accOk = true;
    for (const id of data.unlocked) {
      const { acc, n } = chordAccuracy(id, ADVANCE_RULE.perChordWindow);
      const ok = n >= Math.min(ADVANCE_RULE.perChordWindow, 12) && acc !== null && acc >= ADVANCE_RULE.minAccuracy;
      if (!ok) {
        accOk = false;
        if (!weakest || (acc || 0) < (weakest.acc || 0)) weakest = { id, acc, n };
      }
    }
    const dNeed = advanceDaysNeed(data.unlocked.length);
    return {
      daysDone: days,
      daysNeed: dNeed,
      daysLeft: Math.max(0, dNeed - days),
      trialsDone: st.length,
      trialsNeed: advanceTrialsNeed(data.unlocked.length),
      accOk,
      weakest,
      ready: advanceReady(),
      next: CHORDS[data.unlocked.length] || null,
    };
  }

  function advanceReady() {
    if (data.unlocked.length >= CHORDS.length) return false;
    const st = stageTrials();
    if (st.length < advanceTrialsNeed(data.unlocked.length)) return false;
    if (stageDays() < advanceDaysNeed(data.unlocked.length)) return false;
    return data.unlocked.every(id => {
      const { acc, n } = chordAccuracy(id, ADVANCE_RULE.perChordWindow);
      return n >= Math.min(ADVANCE_RULE.perChordWindow, 12) && acc >= ADVANCE_RULE.minAccuracy;
    });
  }

  function todaySessions() {
    const today = dayKey(Date.now());
    return data.sessions.filter(s => dayKey(s.start) === today);
  }

  // 直近weeks週のカレンダー（日ごとのセッション数）
  function calendar(weeks) {
    const map = {};
    data.sessions.forEach(s => {
      const k = dayKey(s.start);
      map[k] = (map[k] || 0) + 1;
    });
    const out = [];
    const now = new Date();
    for (let i = weeks * 7 - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const k = dayKey(d.getTime());
      out.push({ key: k, count: map[k] || 0, dow: d.getDay(), date: d.getDate() });
    }
    return out;
  }

  function exportJSON() {
    return JSON.stringify(data, null, 1);
  }

  return { load, save, reset, addTrial, addSession, addSticker, unlockNext, clearIntro,
           chordAccuracy, stageTrials, stageDays, advanceReady, advanceStatus, todaySessions, calendar,
           exportJSON, dayKey,
           get data() { return data; } };
})();

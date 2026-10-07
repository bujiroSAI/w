// おとはた モックサイト — 状態シード（localStorage 'otohata_v1' に書く架空データ）
// 実在の子どもの記録ではない。store.js の fresh() と同じ形で生成する。chords.js を先に読み込むこと。
'use strict';

const MOCK_SEEDS = (() => {
  const DAY = 86400000;
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; // 再現可能な乱数

  function groupMates(chordId) {
    const g = CHORD_BY_ID[chordId].group;
    return CHORDS.filter(c => c.group === g && c.id !== chordId).map(c => c.id);
  }

  // unlocked: id配列 / days: 何日分 / perDay: 1日のセッション数 / acc: 正答率 / confuse: 誤答を同グループに寄せる
  function make({ unlocked, days, perDay = 3, acc = 0.9, confuse = false, settings = {}, stickers = 0, trialsPerSession = 20 }) {
    const now = Date.now();
    const trials = [], sessions = [];
    let sid = 1;
    for (let d = days - 1; d >= 0; d--) {
      for (let s = 0; s < perDay; s++) {
        const start = now - d * DAY - (20 - s * 3) * 3600000;
        let correct = 0;
        for (let i = 0; i < trialsPerSession; i++) {
          const chord = unlocked[Math.floor(rnd() * unlocked.length)];
          const ok = rnd() < acc;
          let tapped = chord;
          if (!ok) {
            const mates = confuse ? groupMates(chord).filter(id => unlocked.includes(id)) : [];
            const others = unlocked.filter(id => id !== chord);
            const pool = mates.length && rnd() < 0.7 ? mates : others;
            tapped = pool.length ? pool[Math.floor(rnd() * pool.length)] : chord;
          }
          trials.push({ t: start + i * 7000, chord, tapped, ok, corr: false, stage: unlocked.length, sess: 's' + sid,
                        oct: [-1, 0, 0, 1][Math.floor(rnd() * 4)], rt: 900 + Math.floor(rnd() * 2500), rep: 0, src: null });
          if (ok) correct++;
          else trials.push({ t: start + i * 7000 + 3000, chord, tapped: chord, ok: true, corr: true, stage: unlocked.length, sess: 's' + sid, oct: 0, rt: 1200, rep: 0, src: null });
        }
        sessions.push({ id: 's' + sid, start, end: start + trialsPerSession * 7000, total: trialsPerSession, correct, stage: unlocked.length });
        sid++;
      }
    }
    const STK = ['🦁', '🐘', '🐰', '🐼', '🚀', '🚂', '🍓', '🌟', '🐬', '🦒', '🍎', '🐤', '⚽', '🧁', '🦖', '🚒', '🐢', '🎈', '🍌', '🐸'];
    const st = [];
    for (let i = 0; i < stickers; i++) st.push({ emoji: STK[i % STK.length], t: now - (stickers - i) * DAY });
    return {
      v: 1,
      createdAt: now - days * DAY,
      settings: Object.assign({}, DEFAULT_SETTINGS, settings),
      unlocked: unlocked.slice(),
      introPending: null,
      trials, sessions, stickers: st, suggestedAt: null,
    };
  }

  const ids = CHORDS.map(c => c.id);
  const presets = {
    fresh:      { label: 'はじめて（2色・導入前）', desc: '初回起動。あそぶ→「あか」単独導入4回→「きいろ」4回→混合', data: () => null },
    two:        { label: '2色・導入済み・3日目', desc: '通常の序盤。きょうのドット・旅の地図', data: () => make({ unlocked: ids.slice(0, 2), days: 3, acc: 0.9, stickers: 6 }) },
    five_ready: { label: '5色・進級提案が出る', desc: '全色95%以上×14日×80回を満たした状態。ホームの歯車に赤バッジ・親画面に提案', data: () => make({ unlocked: ids.slice(0, 5), days: 16, perDay: 4, acc: 0.98, stickers: 40 }) },
    plateau:    { label: '6色・停滞期（同グループ混同）', desc: '正答率75%・誤答が同じ響きグループに偏る。親画面「まちがいの質」', data: () => make({ unlocked: ids.slice(0, 6), days: 10, acc: 0.75, confuse: true, stickers: 25 }) },
    all14:      { label: '14色・全部', desc: '最終形。ボタン14個の収まり・旅の地図が全部塗られる', data: () => make({ unlocked: ids, days: 30, acc: 0.9, stickers: 20 }) },
    short3:     { label: '3問で終わる（シールまで最短）', desc: '設定 trialsPerSession=3。すぐ「よくできました→シール」へ', data: () => make({ unlocked: ids.slice(0, 2), days: 2, acc: 0.9, stickers: 3, settings: { trialsPerSession: 3 } }) },
    noblocks:   { label: 'きくじかん・音域拡張オフ', desc: '原法の最小構成に近い出題', data: () => make({ unlocked: ids.slice(0, 3), days: 5, acc: 0.9, settings: { listenBlocks: false, octaveRange: false }, stickers: 10 }) },
    parentpaced:{ label: '親子共同モード（おとなが次へ）', desc: 'settings.parentPaced=true。ひつじタッチで次へ', data: () => make({ unlocked: ids.slice(0, 2), days: 2, acc: 0.9, settings: { parentPaced: true }, stickers: 4 }) },
    cud:        { label: '色覚配慮パレット＋しるし', desc: 'settings.cudPalette / marks', data: () => make({ unlocked: ids.slice(0, 9), days: 20, acc: 0.9, settings: { cudPalette: true, marks: true }, stickers: 30 }) },
  };

  return { presets, make };
})();

// おとはた — 和音カリキュラムデータ
// 和音同定法（Chord Identification Method）の公刊研究に準拠。色↔和音の対応と導入順序が教材の本体。
// 白鍵9和音 = ハ長調 I(ドミソ)/IV(ファラド)/V(ソシレ) の全転回形。
// 対応の出典: 榊原 1999/2004（教育心理学研究）・Sakakibara 2014 (Psychology of Music)。

'use strict';

// 音名 → MIDI番号（C4=60）
const NOTE_MIDI = (() => {
  const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (str) => {
    const m = str.match(/^([A-G])([#b]?)(-?\d)$/);
    if (!m) throw new Error('bad note: ' + str);
    let v = names[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return v + (parseInt(m[3], 10) + 1) * 12;
  };
})();

// 導入順に並べる。unlock順 = この配列の先頭からn個。
// ink: 旗ラベル文字色（旗布の明度に応じて）
// group: 同じ構成音グループ（響き）。グループ内の混同=クロマ依存エラー=前進のサイン（榊原1999）
const CHORDS = [
  // ---- 白鍵9和音（導入順は榊原1999/2004 Figure 1 で確認済み） ----
  { id: 'aka',      label: 'あか',     color: '#E8382F', ink: '#FFFFFF', notes: ['C4', 'E4', 'G4'],  yomi: 'ドミソ',   group: 'C' },
  { id: 'kiiro',    label: 'きいろ',   color: '#F5C518', ink: '#4A3B2E', notes: ['C4', 'F4', 'A4'],  yomi: 'ドファラ', group: 'F' },
  { id: 'ao',       label: 'あお',     color: '#2A6BD4', ink: '#FFFFFF', notes: ['B3', 'D4', 'G4'],  yomi: 'シレソ',   group: 'G' },
  { id: 'kuro',     label: 'くろ',     color: '#38332F', ink: '#FFFFFF', notes: ['A3', 'C4', 'F4'],  yomi: 'ラドファ', group: 'F' },
  { id: 'midori',   label: 'みどり',   color: '#2E9E4F', ink: '#FFFFFF', notes: ['D4', 'G4', 'B4'],  yomi: 'レソシ',   group: 'G' },
  { id: 'daidai',   label: 'だいだい', color: '#EE7B23', ink: '#FFFFFF', notes: ['E4', 'G4', 'C5'],  yomi: 'ミソド',   group: 'C' },
  { id: 'murasaki', label: 'むらさき', color: '#8B4FB8', ink: '#FFFFFF', notes: ['F4', 'A4', 'C5'],  yomi: 'ファラド', group: 'F' },
  { id: 'momoiro',  label: 'ももいろ', color: '#F08CB0', ink: '#4A3B2E', notes: ['G3', 'B3', 'D4'],  yomi: 'ソシレ',   group: 'G' },
  { id: 'chairo',   label: 'ちゃいろ', color: '#8D6238', ink: '#FFFFFF', notes: ['G3', 'C4', 'E4'],  yomi: 'ソドミ',   group: 'C' },
  // ---- 黒鍵和音5個（構成音は実践記録2本が独立に一致・導入順のみ未確定） ----
  { id: 'kimidori', label: 'きみどり', color: '#9DB92C', ink: '#4A3B2E', notes: ['A3', 'C#4', 'E4'],  yomi: 'ラ ド#ミ',  group: 'A' },
  { id: 'usudaidai',label: 'うすだいだい', color: '#F3C193', ink: '#4A3B2E', notes: ['D4', 'F#4', 'A4'], yomi: 'レ ファ#ラ', group: 'D' },
  { id: 'fujiiro',  label: 'ふじいろ', color: '#A58FC9', ink: '#4A3B2E', notes: ['E4', 'G#4', 'B4'],  yomi: 'ミ ソ#シ',  group: 'E' },
  { id: 'haiiro',   label: 'はいいろ', color: '#9A948C', ink: '#FFFFFF', notes: ['Bb3', 'D4', 'F4'],  yomi: 'シ♭レファ', group: 'Bb' },
  { id: 'mizuiro',  label: 'みずいろ', color: '#6FC3E0', ink: '#4A3B2E', notes: ['Eb4', 'G4', 'Bb4'], yomi: 'ミ♭ソシ♭', group: 'Eb' },
];

const CHORD_BY_ID = Object.fromEntries(CHORDS.map(c => [c.id, c]));

// 進級（新しい和音の追加）基準。
// 原法の原則「既出和音が100%正答になるまで足さない・追加間隔は最低2週間」の機械化。
// 2歳児の誤タップを考慮し、100%ではなく直近20回で95%を下限にしている。
const ADVANCE_RULE = {
  perChordWindow: 20,   // 和音ごとの直近n試行
  minAccuracy: 0.95,    // 全和音がこの正答率以上
  minDaysOnStage: 14,   // 現ステージで最低2週間（原法どおり）
  minTrialsOnStage: 80, // 現ステージの総試行数
};

// 新和音の導入モード: 混ぜる前に単独提示で覚えさせる試行数
const INTRO_TRIALS = 4;

// 新和音の出題重み（定着するまで多めに出す）
const NEW_CHORD_BOOST = { untilAccuracy: 0.85, window: 12, probability: 0.4 };

const DEFAULT_SETTINGS = {
  pitchA: 440,          // 基準ピッチ。家のピアノが442Hz調律なら設定で変更
  trialsPerSession: 20, // 1セッションの試行数（原法は1回20〜30試行・2〜3分）
  volume: 0.8,
  voice: true,          // 色名の読み上げ
  sfx: true,
  autoSuggest: true,    // 進級提案を出す
  parentPaced: false,   // true: おとながことりをタッチして次の問題へ（親子共同プレイ）
  dailyTarget: 4,       // 1日の推奨セッション数（原法は1日4〜5回）
};

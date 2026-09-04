/* spec.js — 機種スペック（確率・振り分け・賞球・普図・ラウンド）。数値は現行のP機の典型値。 */
(function (root) {
  'use strict';
  const COMMON = {
    payout: { heso: 3, dencyu: 1, general: 3, attacker: 15 }, // 賞球 3&1&3&15
    attackerCount: 10, roundMaxSec: 29.5, roundInterval: 2.0,
    holdMax: 4,
    futsu: { // 普通図柄（ゲート → 電チュー）
      normal: { p: 1 / 25, spin: 29.0, open: 0.2, count: 10 },
      sapo: { p: 0.99, spin: 1.0, open: 2.6, count: 10 },
    },
    trayMax: 150, lowerMax: 600,
    lendBalls: 125, lendYen: 500, ballYen: 4,
    launchInterval: 0.6, // 100発/分
  };
  const SPECS = {
    middle: Object.assign({}, COMMON, {
      id: 'middle', name: 'ミドル 1/319', label: 'P-STAGE 319ver.',
      pLow: 1 / 319.7, pHigh: 1 / 99.9, stCount: 100, jitanCount: 100,
      dist1: [
        { name: '10R確変', rounds: 10, kakuhen: true, p: 0.50 },
        { name: '4R確変', rounds: 4, kakuhen: true, p: 0.15 },
        { name: '4R時短', rounds: 4, kakuhen: false, p: 0.35 },
      ],
      dist2: [
        { name: '10R確変', rounds: 10, kakuhen: true, p: 0.70 },
        { name: '4R確変', rounds: 4, kakuhen: true, p: 0.30 },
      ],
    }),
    light: Object.assign({}, COMMON, {
      id: 'light', name: 'ライトミドル 1/199', label: 'P-STAGE 199ver.',
      pLow: 1 / 199.8, pHigh: 1 / 79.9, stCount: 100, jitanCount: 100,
      dist1: [
        { name: '10R確変', rounds: 10, kakuhen: true, p: 0.40 },
        { name: '4R確変', rounds: 4, kakuhen: true, p: 0.20 },
        { name: '4R時短', rounds: 4, kakuhen: false, p: 0.40 },
      ],
      dist2: [
        { name: '10R確変', rounds: 10, kakuhen: true, p: 0.60 },
        { name: '4R確変', rounds: 4, kakuhen: true, p: 0.40 },
      ],
    }),
    ama: Object.assign({}, COMMON, {
      id: 'ama', name: '甘デジ 1/99', label: 'P-STAGE 99ver.',
      pLow: 1 / 99.9, pHigh: 1 / 49.9, stCount: 50, jitanCount: 50,
      dist1: [
        { name: '8R確変', rounds: 8, kakuhen: true, p: 0.30 },
        { name: '3R確変', rounds: 3, kakuhen: true, p: 0.20 },
        { name: '3R時短', rounds: 3, kakuhen: false, p: 0.50 },
      ],
      dist2: [
        { name: '8R確変', rounds: 8, kakuhen: true, p: 0.60 },
        { name: '3R確変', rounds: 3, kakuhen: true, p: 0.40 },
      ],
    }),
  };
  const api = { SPECS, COMMON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PachiSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);

// 作戦どうしを何千回も対戦させて、どの打ち方が勝ちやすいかを調べる（モンテカルロ法）。
//   node sim/strategies.js [穴の数] [石の数] [1組あたりの対戦数]
// 2人対戦・2種類の勝敗ルールそれぞれで総当たりをする。
'use strict';
const M = require('../src/engine.js');

const PITS = Number(process.argv[2] || 5);
const STONES = Number(process.argv[3] || 5);
const GAMES = Number(process.argv[4] || 2000);
const SLIP = 0.1; // どの作戦も10%は「うっかり」でたらめに打つ（同じ試合ばかりにならないように）

// 再現できる乱数
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(20261014);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ---- 手の性質 ----
const own = (g, i) => g.board[M.pitIndex(g, g.current, i)];
// ゴールにぴったり入る（もう1回打てる）手か
const landsInStore = (g, i) => own(g, i) === g.pits - i;
// 横取りできる手なら、取れる石の数
function captureGain(g, i) {
  if (g.rule !== 'store') return 0;
  const r = M.applyMove(g, i);
  const c = r.steps.find((s) => s.type === 'capture');
  return c ? c.count : 0;
}

// 候補の中で一番良いもの（同点はランダム）
function best(g, moves, score) {
  let top = -Infinity, cands = [];
  for (const m of moves) {
    const v = score(m);
    if (v > top) { top = v; cands = [m]; } else if (v === top) cands.push(m);
  }
  return pick(cands);
}

// 手を選ぶルール（作戦）。名前は結果表に出る。
const STRATEGIES = {
  'でたらめ': (g, ms) => pick(ms),
  '右端から（ゴールに近い穴）': (g, ms) => Math.max(...ms),
  '左端から（ゴールから遠い穴）': (g, ms) => Math.min(...ms),
  '一番多い穴': (g, ms) => best(g, ms, (i) => own(g, i)),
  '一番少ない穴': (g, ms) => best(g, ms, (i) => -own(g, i)),
  'ぴったり優先→あとはでたらめ': (g, ms) => {
    const e = ms.filter((i) => landsInStore(g, i));
    return e.length ? Math.max(...e) : pick(ms);
  },
  'ぴったり優先→右端から': (g, ms) => {
    const e = ms.filter((i) => landsInStore(g, i));
    return e.length ? Math.max(...e) : Math.max(...ms);
  },
  'ぴったり優先→左端から': (g, ms) => {
    const e = ms.filter((i) => landsInStore(g, i));
    return e.length ? Math.max(...e) : Math.min(...ms);
  },
  'ぴったり優先→横取り→右端から': (g, ms) => {
    const e = ms.filter((i) => landsInStore(g, i));
    if (e.length) return Math.max(...e);
    const gain = best(g, ms, (i) => captureGain(g, i));
    return captureGain(g, gain) > 0 ? gain : Math.max(...ms);
  },
  // 「この手を打ったあと、でたらめに最後まで打ったら何回勝つか」を試して選ぶ（モンテカルロ思考）
  'モンテカルロ思考（各手40回ためす）': (g, ms) => {
    const me = g.current;
    return best(g, ms, (m) => {
      let win = 0;
      for (let k = 0; k < 40; k++) {
        let s = M.applyMove(g, m).game;
        while (!s.over) s = M.applyMove(s, pick(M.legalMoves(s))).game;
        const w = M.winners(s);
        if (w.includes(me)) win += w.length > 1 ? 0.5 : 1;
      }
      return win;
    });
  },
};
const HEAVY = new Set(['モンテカルロ思考（各手40回ためす）']);

function choose(name, g) {
  const ms = M.legalMoves(g);
  if (name !== 'でたらめ' && rng() < SLIP) return pick(ms);
  return STRATEGIES[name](g, ms);
}

// 1試合。結果は先手(0)から見た 1 / 0.5 / 0
function playOne(rule, first, second, stats) {
  let g = M.createGame({ players: 2, pits: PITS, stones: STONES, rule });
  const names = [first, second];
  let moves = 0;
  while (!g.over) {
    const r = M.applyMove(g, choose(names[g.current], g));
    if (stats && r.extraTurn) stats.extra[g.current]++;
    g = r.game;
    moves++;
  }
  if (stats) stats.moves += moves;
  const w = M.winners(g);
  return w.length > 1 ? 0.5 : (w[0] === 0 ? 1 : 0);
}

function pct(x) { return (x * 100).toFixed(1).padStart(5) + '%'; }

function roundRobin(rule) {
  const names = Object.keys(STRATEGIES);
  const total = {}; names.forEach((n) => (total[n] = { pts: 0, games: 0 }));
  const vs = {}; // vs[a][b] = a の b に対する勝率
  for (const a of names) vs[a] = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const n = HEAVY.has(a) || HEAVY.has(b) ? Math.max(50, Math.floor(GAMES / 10)) : GAMES;
      let aPts = 0;
      for (let k = 0; k < n; k++) {
        // 先手・後手を交互に入れ替える
        if (k % 2 === 0) aPts += playOne(rule, a, b);
        else aPts += 1 - playOne(rule, b, a);
      }
      vs[a][b] = aPts / n; vs[b][a] = 1 - aPts / n;
      total[a].pts += aPts; total[a].games += n;
      total[b].pts += n - aPts; total[b].games += n;
    }
  }
  const ranking = names.map((n) => ({ name: n, rate: total[n].pts / total[n].games })).sort((x, y) => y.rate - x.rate);
  return { ranking, vs };
}

function firstMoveAdvantage(rule, name, n) {
  let pts = 0;
  const stats = { extra: [0, 0], moves: 0 };
  for (let k = 0; k < n; k++) pts += playOne(rule, name, name, stats);
  return { first: pts / n, extraPerGame: stats.extra.map((e) => e / n), movesPerGame: stats.moves / n };
}

// 最初の1手ごとの勝率（そのあとは両者 follow の作戦で打つ）
function openingMoves(rule, n, follow) {
  const out = [];
  for (let first = 0; first < PITS; first++) {
    let pts = 0;
    for (let k = 0; k < n; k++) {
      let g = M.createGame({ players: 2, pits: PITS, stones: STONES, rule });
      let r = M.applyMove(g, first);
      g = r.game;
      while (!g.over) g = M.applyMove(g, choose(follow, g)).game;
      const w = M.winners(g);
      pts += w.length > 1 ? 0.5 : (w[0] === 0 ? 1 : 0);
    }
    out.push({ pit: first + 1, seeds: STONES, landsInStore: STONES === PITS - first, rate: pts / n });
  }
  return out;
}

// 強い作戦（モンテカルロ思考）同士を戦わせて、どんな手を選びがちかを数える
function habits(rule, n) {
  const mc = 'モンテカルロ思考（各手40回ためす）';
  const h = { turns: 0, exactAvail: 0, exactTaken: 0, captureAvail: 0, captureTaken: 0, leftmost: 0, rightmost: 0, posSum: 0, choices: 0, byPit: Array(PITS).fill(0) };
  for (let k = 0; k < n; k++) {
    let g = M.createGame({ players: 2, pits: PITS, stones: STONES, rule });
    while (!g.over) {
      const ms = M.legalMoves(g);
      const m = STRATEGIES[mc](g, ms); // うっかり無しで観察
      if (ms.length > 1) {
        h.choices++;
        const exact = ms.filter((i) => landsInStore(g, i));
        if (exact.length && exact.length < ms.length) { h.exactAvail++; if (exact.includes(m)) h.exactTaken++; }
        const caps = ms.filter((i) => captureGain(g, i) > 0);
        if (caps.length && caps.length < ms.length) { h.captureAvail++; if (caps.includes(m)) h.captureTaken++; }
        if (m === Math.min(...ms)) h.leftmost++;
        if (m === Math.max(...ms)) h.rightmost++;
        h.byPit[m]++;
      }
      g = M.applyMove(g, m).game;
    }
  }
  return {
    exactRate: h.exactTaken / h.exactAvail, captureRate: h.captureAvail ? h.captureTaken / h.captureAvail : null,
    leftmostRate: h.leftmost / h.choices, rightmostRate: h.rightmost / h.choices,
    byPit: h.byPit.map((c) => c / h.choices),
  };
}

const RULES = { store: 'ゴールの石が多い人の勝ち（横取りあり）', empty: '先に自分の穴を空にした人の勝ち（横取りなし）' };
const result = { pits: PITS, stones: STONES, games: GAMES, rules: {} };
for (const rule of Object.keys(RULES)) {
  const t0 = Date.now();
  rng = mulberry32(20261014);
  const rr = roundRobin(rule);
  const adv = {
    random: firstMoveAdvantage(rule, 'でたらめ', GAMES * 2),
    best: firstMoveAdvantage(rule, rr.ranking[0].name, HEAVY.has(rr.ranking[0].name) ? 400 : GAMES * 2),
  };
  const follow = rr.ranking.find((r) => !HEAVY.has(r.name)).name;
  const open = openingMoves(rule, GAMES, follow);
  const hab = habits(rule, 60);
  result.rules[rule] = { title: RULES[rule], ...rr, advantage: adv, opening: open, follow, habits: hab };

  console.log(`\n=== ${RULES[rule]} ／ 穴${PITS}・石${STONES} ===`);
  console.log('総当たりの勝率（全員と戦った平均）');
  rr.ranking.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}位 ${pct(r.rate)}  ${r.name}`));
  console.log(`先手の勝率: でたらめ同士 ${pct(adv.random.first)}、1位の作戦同士 ${pct(adv.best.first)}`);
  console.log(`1試合の手数: でたらめ同士 平均${adv.random.movesPerGame.toFixed(1)}手、もう1回打てた回数 先手${adv.random.extraPerGame[0].toFixed(1)}／後手${adv.random.extraPerGame[1].toFixed(1)}`);
  console.log(`最初の1手ごとの先手勝率（以降は両者「${follow}」）`);
  open.forEach((o) => console.log(`  穴${o.pit}${o.landsInStore ? '（ぴったりゴール）' : ''}: ${pct(o.rate)}`));
  console.log('モンテカルロ思考の打ち癖（選べる手が2つ以上あった場面）');
  console.log(`  ぴったりゴールの手があるとき、それを選んだ: ${pct(hab.exactRate)}`);
  if (hab.captureRate !== null) console.log(`  横取りできる手があるとき、それを選んだ: ${pct(hab.captureRate)}`);
  console.log(`  一番左の穴を選んだ: ${pct(hab.leftmostRate)}／一番右の穴を選んだ: ${pct(hab.rightmostRate)}`);
  console.log('  選んだ穴の割合: ' + hab.byPit.map((r, i) => `穴${i + 1} ${pct(r).trim()}`).join('、'));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
}

require('fs').writeFileSync(require('path').join(__dirname, `result-${PITS}x${STONES}.json`), JSON.stringify(result, null, 2));

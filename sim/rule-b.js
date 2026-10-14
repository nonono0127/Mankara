// ルールB（先に自分の穴を空にした人の勝ち）の勝ち方を深掘りする。
//   node sim/rule-b.js [穴の数] [石の数] [1組あたりの対戦数] [all]
//   4つ目に all を付けると、ローカルルール「相手のゴールにも入れる」で調べる
// 1) 作戦の総当たり  2) 強い作戦の手とどれだけ一致するか  3) 最初の1手  4) 先手・後手
'use strict';
const M = require('../src/engine.js');

const PITS = Number(process.argv[2] || 5);
const STONES = Number(process.argv[3] || 5);
const GAMES = Number(process.argv[4] || 4000);
const HEAVY_GAMES = Math.max(100, Math.floor(GAMES / 12));
const SLIP = 0.1;
const RULE = 'empty';
const ALL_STORES = process.argv[5] === 'all';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(42);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const newGame = () => M.createGame({ players: 2, pits: PITS, stones: STONES, rule: RULE, allStores: ALL_STORES });

// ---- 手の性質 ----
const own = (g, i) => g.board[M.pitIndex(g, g.current, i)];
const mine = (g, p) => M.remaining(g)[p];
// 打ったあとの自分の残り
const ownAfter = (g, i) => mine(M.applyMove(g, i).game, g.current);
// 相手の穴に送る石の数
function sent(g, i) {
  const me = g.current;
  return M.applyMove(g, i).steps.filter((s) => s.type === 'drop' && !M.isStore(g, s.idx) && M.ownerOf(g, s.idx) !== me).length;
}
// 自分の石がゴールまでに歩く歩数の合計（左の穴の石ほど遠い）
function walk(g, p) {
  let sum = 0;
  for (let i = 0; i < g.pits; i++) sum += g.board[M.pitIndex(g, p, i)] * (g.pits - i);
  return sum;
}
const walkAfter = (g, i) => walk(M.applyMove(g, i).game, g.current);

// score が最大の手の集合（同点はすべて）
function bestSet(ms, score) {
  let top = -Infinity, set = [];
  for (const m of ms) {
    const v = score(m);
    if (v > top + 1e-9) { top = v; set = [m]; } else if (Math.abs(v - top) <= 1e-9) set.push(m);
  }
  return set;
}

// でたらめに（または左端から）最後まで打って、me が勝つ割合
function playout(g, me, policy) {
  let s = g;
  while (!s.over) {
    const ms = M.legalMoves(s);
    s = M.applyMove(s, policy === 'left' && rng() > 0.25 ? Math.min(...ms) : pick(ms)).game;
  }
  return s.winner === me ? 1 : 0;
}
function monteCarlo(n, policy) {
  return (g, ms) => {
    const me = g.current;
    return bestSet(ms, (m) => {
      const after = M.applyMove(g, m).game;
      if (after.over) return after.winner === me ? 1e9 : -1e9;
      let w = 0;
      for (let k = 0; k < n; k++) w += playout(after, me, policy);
      return w;
    });
  };
}

// 序盤か（穴に残っている石が、最初の全体の半分より多い）
const isEarly = (g) => M.remaining(g)[0] + M.remaining(g)[1] > PITS * STONES;

// 各作戦は「同点の候補手の集合」を返す（一致率を測るため）。実際に打つときは同点からランダム。
const STRATEGIES = {
  'でたらめ': (g, ms) => ms,
  '左端から': (g, ms) => [Math.min(...ms)],
  '右端から': (g, ms) => [Math.max(...ms)],
  '一番多い穴': (g, ms) => bestSet(ms, (i) => own(g, i)),
  '一番少ない穴': (g, ms) => bestSet(ms, (i) => -own(g, i)),
  '自分の残りが一番減る手': (g, ms) => bestSet(ms, (i) => -ownAfter(g, i)),
  '相手に一番多く送る手': (g, ms) => bestSet(ms, (i) => sent(g, i)),
  'ゴールまでの歩数が一番減る手': (g, ms) => bestSet(ms, (i) => -walkAfter(g, i)),
  '序盤は相手に多く送る→終盤は左端から': (g, ms) => (isEarly(g) ? bestSet(ms, (i) => sent(g, i)) : [Math.min(...ms)]),
  '序盤は一番多い穴→終盤は左端から': (g, ms) => (isEarly(g) ? bestSet(ms, (i) => own(g, i)) : [Math.min(...ms)]),
  '序盤は右端から→終盤は左端から': (g, ms) => (isEarly(g) ? [Math.max(...ms)] : [Math.min(...ms)]),
  'ゲームのCPU「ふつう」': (g, ms) => [M.chooseMove(g, 'normal', rng)],
  'モンテカルロ思考（でたらめで40回）': monteCarlo(40, 'random'),
  'モンテカルロ思考（左端からで40回）': monteCarlo(40, 'left'),
};
const HEAVY = new Set(Object.keys(STRATEGIES).filter((n) => n.startsWith('モンテカルロ') || n.startsWith('ゲームのCPU')));

function choose(name, g) {
  const ms = M.legalMoves(g);
  if (ms.length === 1) return ms[0];
  if (name !== 'でたらめ' && rng() < SLIP) return pick(ms);
  return pick(STRATEGIES[name](g, ms));
}

function playOne(a, b) {
  let g = newGame();
  const names = [a, b];
  while (!g.over) g = M.applyMove(g, choose(names[g.current], g)).game;
  return g.winner === 0 ? 1 : 0;
}

const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
const log = (...a) => console.log(...a);
const out = { pits: PITS, stones: STONES, games: GAMES };

// ---- 1) 総当たり ----
log(`=== ルールB（先に空にした人の勝ち）${ALL_STORES ? '＋相手のゴールにも入れる' : ''}／ 穴${PITS}・石${STONES} ===`);
const names = Object.keys(STRATEGIES);
const tot = {}; names.forEach((n) => (tot[n] = { pts: 0, games: 0 }));
const vs = {}; names.forEach((n) => (vs[n] = {}));
let t0 = Date.now();
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const n = HEAVY.has(a) || HEAVY.has(b) ? HEAVY_GAMES : GAMES;
    let ap = 0;
    for (let k = 0; k < n; k++) ap += k % 2 === 0 ? playOne(a, b) : 1 - playOne(b, a);
    vs[a][b] = ap / n; vs[b][a] = 1 - ap / n;
    tot[a].pts += ap; tot[a].games += n; tot[b].pts += n - ap; tot[b].games += n;
  }
}
const ranking = names.map((n) => ({ name: n, rate: tot[n].pts / tot[n].games })).sort((x, y) => y.rate - x.rate);
log(`\n[1] 総当たりの勝率（軽い作戦どうしは1組${GAMES}試合、モンテカルロ思考が入る組は${HEAVY_GAMES}試合）`);
ranking.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}位 ${pct(r.rate)}  ${r.name}`));
const strongest = ranking[0].name;
log(`  1位「${strongest}」との直接対決:`);
ranking.slice(1).forEach((r) => log(`    vs ${r.name}: ${pct(vs[strongest][r.name])}`));
log(`  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
out.ranking = ranking; out.vs = vs;

// ---- 2) 強い作戦の手との一致率 ----
// 「先生役」はモンテカルロ思考（左端からで200回）。先生同士の対局の局面で、各作戦が同じ手を選ぶ割合を数える。
t0 = Date.now();
const teacher = monteCarlo(200, 'left');
const agree = {}; names.filter((n) => !HEAVY.has(n)).forEach((n) => (agree[n] = { all: 0, early: 0, late: 0 }));
let positions = 0;
const byPit = { early: Array(PITS).fill(0), late: Array(PITS).fill(0) };
const phase = { early: { n: 0, left: 0 }, late: { n: 0, left: 0 } };
for (let k = 0; k < 40; k++) {
  let g = newGame();
  while (!g.over) {
    const ms = M.legalMoves(g);
    let m;
    if (ms.length > 1) {
      const tset = teacher(g, ms);
      m = pick(tset);
      positions++;
      const early = isEarly(g);
      for (const n of Object.keys(agree)) {
        const s = STRATEGIES[n](g, ms);
        // 同点の候補が複数あれば、その中からランダムに選んで当たる確率
        const hit = s.includes(m) ? 1 / s.length : 0;
        agree[n].all += hit; agree[n][early ? 'early' : 'late'] += hit;
      }
      const ph = early ? phase.early : phase.late;
      ph.n++; if (m === Math.min(...ms)) ph.left++;
      byPit[early ? 'early' : 'late'][m]++;
      if (rng() < SLIP) m = pick(ms); // 先生にもたまにうっかりさせて局面をばらけさせる
    } else m = ms[0];
    g = M.applyMove(g, m).game;
  }
}
log(`\n[2] 先生役（モンテカルロ思考・左端からで200回）と同じ手を選ぶ割合（${positions}局面）`);
const agreeRank = Object.entries(agree).map(([n, v]) => ({ name: n, rate: v.all / positions, early: v.early / phase.early.n, late: v.late / phase.late.n })).sort((a, b) => b.rate - a.rate);
log('  全体   序盤   終盤');
agreeRank.forEach((r) => log(`  ${pct(r.rate)} ${pct(r.early)} ${pct(r.late)}  ${r.name}`));
for (const ph of ['early', 'late']) {
  const n = phase[ph].n;
  log(`  先生が選んだ穴（${ph === 'early' ? '序盤' : '終盤'}）: ` + byPit[ph].map((c, i) => `穴${i + 1} ${pct(c / n).trim()}`).join('、'));
}
log(`  先生が一番左の穴を選んだ割合: 序盤（石が全体の半分より多く残っている）${pct(phase.early.left / phase.early.n)}、終盤 ${pct(phase.late.left / phase.late.n)}`);
log(`  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
out.agreement = agreeRank; out.teacherPits = byPit; out.teacherLeftmost = { early: phase.early.left / phase.early.n, late: phase.late.left / phase.late.n };

// ---- 3) 最初の1手（2手目以降は両者モンテカルロ思考・左端からで40回） ----
t0 = Date.now();
const follow = 'モンテカルロ思考（左端からで40回）';
const OPEN_N = Math.max(100, Math.floor(GAMES / 10));
log(`\n[3] 最初の1手ごとの先手勝率（2手目以降は両者「${follow}」、各${OPEN_N}試合）`);
out.opening = [];
for (let first = 0; first < PITS; first++) {
  let w = 0;
  for (let k = 0; k < OPEN_N; k++) {
    let g = M.applyMove(newGame(), first).game;
    while (!g.over) g = M.applyMove(g, choose(follow, g)).game;
    w += g.winner === 0 ? 1 : 0;
  }
  const r = M.applyMove(newGame(), first);
  const note = r.extraTurn ? 'ぴったりゴールでもう1回' : `相手に${sent(newGame(), first)}個送る`;
  out.opening.push({ pit: first + 1, rate: w / OPEN_N, note });
  log(`  穴${first + 1}（${note}）: ${pct(w / OPEN_N)}`);
}
log(`  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);

// ---- 4) 先手・後手 ----
t0 = Date.now();
let fw = 0;
for (let k = 0; k < OPEN_N; k++) fw += playOne(follow, follow);
log(`\n[4] 強い作戦どうし（${follow}）で先手が勝つ割合: ${pct(fw / OPEN_N)}（${OPEN_N}試合）`);
log(`  (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
out.firstPlayer = fw / OPEN_N;

require('fs').writeFileSync(require('path').join(__dirname, `rule-b-${PITS}x${STONES}${ALL_STORES ? '-all' : ''}.json`), JSON.stringify(out, null, 2));

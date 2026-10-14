// マンカラのルール本体（画面とは独立）。ブラウザでも Node でも動く。
//
// 盤面は「輪」として表す。プレイヤー p の持ち物は
//   穴: p*(pits+1) + 0 .. pits-1
//   ゴール: p*(pits+1) + pits
// で、石は番号が増える向き（反時計回り）に配られる。
//
// 勝敗の付け方（rule）は2種類:
//   'store' … ゴールの石がいちばん多い人の勝ち（横取りあり）
//   'empty' … 自分の穴を先に全部空にした人の勝ち（横取りなし）
(function (global) {
  'use strict';

  function createGame(opts) {
    const players = opts.players;
    const pits = opts.pits;
    const stones = opts.stones;
    const rule = opts.rule || 'store';
    const board = [];
    for (let p = 0; p < players; p++) {
      for (let i = 0; i < pits; i++) board.push(stones);
      board.push(0);
    }
    return { players, pits, board, current: 0, over: false, rule, winner: -1 };
  }

  function seg(game) { return game.pits + 1; }
  function pitIndex(game, p, i) { return p * seg(game) + i; }
  function storeIndex(game, p) { return p * seg(game) + game.pits; }
  function ownerOf(game, idx) { return Math.floor(idx / seg(game)); }
  function isStore(game, idx) { return idx % seg(game) === game.pits; }

  function legalMoves(game) {
    if (game.over) return [];
    const moves = [];
    for (let i = 0; i < game.pits; i++) {
      if (game.board[pitIndex(game, game.current, i)] > 0) moves.push(i);
    }
    return moves;
  }

  function clone(game) {
    return { players: game.players, pits: game.pits, board: game.board.slice(), current: game.current, over: game.over, rule: game.rule || 'store', winner: game.winner };
  }

  // 1手打つ。新しい状態と、アニメーション用の手順（steps）を返す。
  function applyMove(game, pit) {
    const g = clone(game);
    const me = g.current;
    const len = g.board.length;
    let idx = pitIndex(g, me, pit);
    let hand = g.board[idx];
    if (hand === 0 || g.over) throw new Error('illegal move');
    const steps = [{ type: 'pickup', idx, count: hand }];
    g.board[idx] = 0;

    while (hand > 0) {
      idx = (idx + 1) % len;
      // 相手のゴールには入れない
      if (isStore(g, idx) && ownerOf(g, idx) !== me) continue;
      g.board[idx]++;
      hand--;
      steps.push({ type: 'drop', idx });
    }

    let extraTurn = false;
    if (idx === storeIndex(g, me)) {
      // 自分のゴールで止まったらもう1回
      extraTurn = true;
    } else if (g.rule === 'store' && !isStore(g, idx) && ownerOf(g, idx) === me && g.board[idx] === 1) {
      // 自分の空っぽの穴で止まったら、次の人の向かいの穴を横取り
      const i = idx % seg(g);
      const victim = (me + 1) % g.players;
      const target = pitIndex(g, victim, g.pits - 1 - i);
      if (g.board[target] > 0) {
        const taken = g.board[target] + 1;
        g.board[storeIndex(g, me)] += taken;
        g.board[target] = 0;
        g.board[idx] = 0;
        steps.push({ type: 'capture', from: [idx, target], to: storeIndex(g, me), count: taken });
      }
    }

    // 'empty' ルール: 自分の穴が全部空になったら、その時点で勝ち
    // （石は配るだけで相手の穴から減ることはないので、空になりうるのは打った本人だけ）
    if (g.rule === 'empty') {
      let mine = 0;
      for (let i = 0; i < g.pits; i++) mine += g.board[pitIndex(g, me, i)];
      if (mine === 0) {
        g.over = true;
        g.winner = me;
        steps.push({ type: 'end' });
      } else if (!extraTurn) {
        g.current = (me + 1) % g.players;
      }
      return { game: g, steps, extraTurn };
    }

    // 誰かの穴がすべて空になったら終了。残りの石はそれぞれのゴールへ
    let someoneEmpty = false;
    for (let p = 0; p < g.players; p++) {
      let sum = 0;
      for (let i = 0; i < g.pits; i++) sum += g.board[pitIndex(g, p, i)];
      if (sum === 0) someoneEmpty = true;
    }
    if (someoneEmpty) {
      for (let p = 0; p < g.players; p++) {
        for (let i = 0; i < g.pits; i++) {
          const k = pitIndex(g, p, i);
          g.board[storeIndex(g, p)] += g.board[k];
          g.board[k] = 0;
        }
      }
      g.over = true;
      steps.push({ type: 'end' });
    } else if (!extraTurn) {
      g.current = (me + 1) % g.players;
    }

    return { game: g, steps, extraTurn };
  }

  function scores(game) {
    const out = [];
    for (let p = 0; p < game.players; p++) out.push(game.board[storeIndex(game, p)]);
    return out;
  }

  // 穴に残っている石の数
  function remaining(game) {
    const out = [];
    for (let p = 0; p < game.players; p++) {
      let sum = 0;
      for (let i = 0; i < game.pits; i++) sum += game.board[pitIndex(game, p, i)];
      out.push(sum);
    }
    return out;
  }

  function winners(game) {
    if (game.rule === 'empty') return game.winner >= 0 ? [game.winner] : [];
    const s = scores(game);
    const best = Math.max.apply(null, s);
    return s.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
  }

  // ---- CPU ----
  // 各プレイヤーが「自分の点 − いちばん強い相手の点」を最大にしようとする前提で先読みする（max-n 法）。

  function evaluate(game) {
    if (game.rule === 'empty') {
      // 残りが少ないほど良い。勝ちが決まっていれば大きな値
      const rem = remaining(game);
      return rem.map((v, p) => {
        if (game.over) return game.winner === p ? 1000 : -1000;
        let bestOther = Infinity;
        for (let q = 0; q < rem.length; q++) if (q !== p) bestOther = Math.min(bestOther, rem[q]);
        return bestOther - v;
      });
    }
    const s = scores(game);
    // 終局前は、自分の穴に残っている石も少しだけ価値ありとみなす
    if (!game.over) {
      for (let p = 0; p < game.players; p++) {
        let sum = 0;
        for (let i = 0; i < game.pits; i++) sum += game.board[pitIndex(game, p, i)];
        s[p] += sum * 0.25;
      }
    }
    return s.map((v, p) => {
      let bestOther = -Infinity;
      for (let q = 0; q < s.length; q++) if (q !== p) bestOther = Math.max(bestOther, s[q]);
      return v - bestOther;
    });
  }

  function search(game, depth, budget) {
    if (game.over || depth === 0 || budget.n <= 0) return { values: evaluate(game), move: -1 };
    const me = game.current;
    let best = null;
    for (const m of legalMoves(game)) {
      budget.n--;
      const r = applyMove(game, m);
      // もう1回打てるときは深さを減らさない
      const child = search(r.game, r.extraTurn ? depth : depth - 1, budget);
      if (!best || child.values[me] > best.values[me]) best = { values: child.values, move: m };
    }
    return best;
  }

  const LEVELS = { easy: 1, normal: 3, hard: 6 };

  // 'empty' ルール用: 各手について「そのあと最後まで試しに打つ」を何回も繰り返し、勝てた回数が多い手を選ぶ（モンテカルロ法）。
  // 先読みの点数（残りの石の数）は目先の数に引っぱられて弱かったので、こちらを使う。
  // 試しの対局は、全員が「だいたい左端の穴から」打つ（シミュレーションで強かった打ち方）。
  const PLAYOUTS = { easy: 8, normal: 40, hard: 150 };

  function playoutWins(game, me, rng) {
    let g = game;
    while (!g.over) {
      const ms = legalMoves(g);
      const m = rng() < 0.75 ? ms[0] : ms[Math.floor(rng() * ms.length)];
      g = applyMove(g, m).game;
    }
    return g.winner === me ? 1 : 0;
  }

  function monteCarloMove(game, n, rng) {
    const me = game.current;
    let best = -1, bestWins = -1;
    for (const m of legalMoves(game)) {
      const after = applyMove(game, m).game;
      if (after.over) return m; // 打てば空になって勝ち
      let wins = 0;
      for (let k = 0; k < n; k++) wins += playoutWins(after, me, rng);
      if (wins > bestWins || (wins === bestWins && rng() < 0.5)) { best = m; bestWins = wins; }
    }
    return best;
  }

  function chooseMove(game, level, rng) {
    rng = rng || Math.random;
    const moves = legalMoves(game);
    if (moves.length === 0) return -1;
    if (level === 'easy' && rng() < 0.5) return moves[Math.floor(rng() * moves.length)];
    if (game.rule === 'empty') return moves.length === 1 ? moves[0] : monteCarloMove(game, PLAYOUTS[level] || 40, rng);
    let depth = LEVELS[level] || 3;
    if (game.players > 2) depth = Math.min(depth, 4);
    return search(game, depth, { n: 200000 }).move;
  }

  const api = { createGame, legalMoves, applyMove, scores, remaining, winners, chooseMove, pitIndex, storeIndex, ownerOf, isStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Mancala = api;
})(typeof window !== 'undefined' ? window : globalThis);

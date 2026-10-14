const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/engine.js');

test('初期配置', () => {
  const g = M.createGame({ players: 2, pits: 6, stones: 4 });
  assert.deepStrictEqual(g.board, [4,4,4,4,4,4,0, 4,4,4,4,4,4,0]);
});

test('自分のゴールで止まるともう1回', () => {
  const g = M.createGame({ players: 2, pits: 6, stones: 4 });
  const r = M.applyMove(g, 2); // 4個 → 3,4,5,ゴール
  assert.strictEqual(r.extraTurn, true);
  assert.strictEqual(r.game.current, 0);
  assert.strictEqual(r.game.board[6], 1);
});

test('相手のゴールは飛ばす', () => {
  const g = M.createGame({ players: 2, pits: 6, stones: 4 });
  g.board = [0,0,0,0,0,10, 0, 1,1,1,1,1,1, 0];
  const r = M.applyMove(g, 5);
  // 10個: ゴール1 → 相手の穴6つ → (相手ゴールは飛ばす) → 自分の穴0,1,2
  assert.strictEqual(r.game.board[13], 0);
  assert.deepStrictEqual(r.game.board.slice(0, 3), [1, 1, 0]);
  // 穴2は空だったので、向かい(相手の穴3)の2個+1個を横取り → ゴールは 1+3
  assert.strictEqual(r.game.board[6], 4);
});

test('空の穴で止まると向かいを横取り', () => {
  const g = M.createGame({ players: 2, pits: 6, stones: 4 });
  g.board = [1,0,0,0,0,0, 0, 0,0,0,0,7,0, 0];
  // 穴0の1個 → 穴1(空)で止まる。向かいは相手の穴 6-1-1=4 → index 7+4=11
  g.board[11] = 7; g.board[12] = 1;
  const r = M.applyMove(g, 0);
  assert.strictEqual(r.game.board[6], 8);
  assert.strictEqual(r.game.board[11], 0);
});

test('穴が全部空になったら終局して残りを回収', () => {
  const g = M.createGame({ players: 2, pits: 3, stones: 1 });
  g.board = [0,0,1, 5, 2,2,2, 0];
  const r = M.applyMove(g, 2);
  assert.strictEqual(r.game.over, true);
  assert.deepStrictEqual(M.scores(r.game), [6, 6]);
});

test('3人・4人でも最後まで遊べる（CPU同士）', () => {
  for (const players of [2, 3, 4]) {
    for (const pits of [3, 6, 8]) {
      let g = M.createGame({ players, pits, stones: 3 });
      const total = players * pits * 3;
      let guard = 0;
      while (!g.over && guard++ < 2000) {
        g = M.applyMove(g, M.chooseMove(g, 'normal')).game;
        assert.strictEqual(g.board.reduce((a, b) => a + b, 0), total);
      }
      assert.strictEqual(g.over, true);
    }
  }
});

test('強いCPUはランダムにほぼ勝つ', () => {
  let wins = 0;
  for (let n = 0; n < 10; n++) {
    let g = M.createGame({ players: 2, pits: 6, stones: 4 });
    while (!g.over) {
      const moves = M.legalMoves(g);
      const m = g.current === 0 ? M.chooseMove(g, 'hard') : moves[Math.floor(Math.random() * moves.length)];
      g = M.applyMove(g, m).game;
    }
    if (M.winners(g).includes(0)) wins++;
  }
  assert.ok(wins >= 9, `wins=${wins}`);
});

test('emptyルール: 自分の穴を先に空にした人の勝ち、横取りなし', () => {
  const g = M.createGame({ players: 2, pits: 3, stones: 1, rule: 'empty' });
  g.board = [1,0,0, 0, 0,0,5, 0];
  // 穴0の1個 → 穴1(空)で止まるが横取りはしない
  let r = M.applyMove(g, 0);
  assert.deepStrictEqual(r.game.board, [0,1,0, 0, 0,0,5, 0]);
  assert.strictEqual(r.game.over, false);
  r.game.current = 0;
  r = M.applyMove(r.game, 1); // 穴1 → 穴2
  r.game.current = 0;
  r = M.applyMove(r.game, 2); // 穴2 → ゴール。穴が全部空 → 勝ち
  assert.strictEqual(r.game.over, true);
  assert.deepStrictEqual(M.winners(r.game), [0]);
});

test('emptyルールでも最後まで遊べる', () => {
  for (const players of [2, 3]) {
    let g = M.createGame({ players, pits: 5, stones: 5, rule: 'empty' });
    let guard = 0;
    while (!g.over && guard++ < 5000) g = M.applyMove(g, M.chooseMove(g, 'normal')).game;
    assert.strictEqual(g.over, true);
    assert.strictEqual(M.winners(g).length, 1);
  }
});

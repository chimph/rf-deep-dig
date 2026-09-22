import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../games/deep-dig/board.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
const { WIDTH, HEIGHT, SIZE, neighbors, cardinalNeighbors, sourcePositions, isReachableLayout } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const cells = Array.from({ length: SIZE }, (_, cell) => cell);
function shuffled(seed) {
  const order = [...cells];
  for (let i = SIZE - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Independent coordinate traversal verifies generated geometry without using
// the production reachability helper as the test's only oracle.
function assertWalkable(sources, first) {
  const blocked = new Set(sources), visited = new Set([first]), queue = [first];
  const steps = cell => [[cell % WIDTH - 1, Math.floor(cell / WIDTH)], [cell % WIDTH + 1, Math.floor(cell / WIDTH)], [cell % WIDTH, Math.floor(cell / WIDTH) - 1], [cell % WIDTH, Math.floor(cell / WIDTH) + 1]]
    .filter(([x, y]) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT).map(([x, y]) => y * WIDTH + x);
  for (let i = 0; i < queue.length; i++) for (const next of steps(queue[i])) if (!blocked.has(next) && !visited.has(next)) {
    visited.add(next); queue.push(next);
  }
  assert.equal(visited.size, SIZE - sources.length);
  for (const source of sources) assert.ok(steps(source).some(next => visited.has(next)), `Source ${source} must have an ordinary approach`);
}

test('clue and walking neighbors include the right cells without edge wrapping', () => {
  assert.equal(WIDTH, 10); assert.equal(HEIGHT, 8); assert.equal(SIZE, 80);
  assert.deepEqual(neighbors(0), [1, 10, 11]); assert.deepEqual(neighbors(9), [8, 18, 19]);
  assert.deepEqual(neighbors(70), [60, 61, 71]); assert.deepEqual(neighbors(79), [68, 69, 78]);
  assert.deepEqual(neighbors(34), [23, 24, 25, 33, 35, 43, 44, 45]);
  assert.deepEqual(cardinalNeighbors(0), [1, 10]); assert.deepEqual(cardinalNeighbors(9), [8, 19]);
  assert.deepEqual(cardinalNeighbors(70), [60, 71]); assert.deepEqual(cardinalNeighbors(79), [69, 78]);
  assert.deepEqual(cardinalNeighbors(34), [24, 33, 35, 44]);
});

test('diagonal corner barriers, complete walls and enclosed sources are rejected', () => {
  assert.equal(isReachableLayout([]), true);
  assert.equal(isReachableLayout([1, 10]), false, 'top-left ordinary corner is isolated');
  assert.equal(isReachableLayout([8, 19]), false, 'top-right ordinary corner is isolated');
  assert.equal(isReachableLayout([60, 71]), false, 'bottom-left ordinary corner is isolated');
  assert.equal(isReachableLayout([69, 78]), false, 'bottom-right ordinary corner is isolated');
  assert.equal(isReachableLayout(cells.filter(cell => cell % WIDTH === 4)), false);
  assert.equal(isReachableLayout([34, 24, 33, 35, 44]), false, 'center source has no ordinary approach');
  assert.equal(isReachableLayout([0, 1]), true);
});

test('every first position and 64 shuffled orders preserve safe reachable layouts at all source counts', () => {
  for (let seed = 1; seed <= 64; seed++) for (let first = 0; first < SIZE; first++) for (const count of [8, 10, 12, 16]) {
    const order = shuffled(seed), original = [...order], sources = sourcePositions(order, first, count);
    assert.equal(sources.length, count); assert.equal(new Set(sources).size, count);
    assert.ok(!sources.includes(first)); assert.ok(neighbors(first).every(cell => !sources.includes(cell)));
    assert.equal(isReachableLayout(sources), true); assertWalkable(sources, first);
    assert.deepEqual(sourcePositions(order, first, count), sources, 'committed order reproduces source layout');
    assert.deepEqual(order, original, 'placement does not mutate the committed order');
  }
});

test('structured adversarial orders cannot wall off ground or trap corner tiles', () => {
  const orders = [
    cells, [...cells].reverse(),
    [...cells].sort((a, b) => a % WIDTH - b % WIDTH || a - b),
    [...cells].sort((a, b) => (a % WIDTH + Math.floor(a / WIDTH)) % 2 - (b % WIDTH + Math.floor(b / WIDTH)) % 2 || a - b),
    [...cells].sort((a, b) => Number([1, 10, 8, 19, 50, 61, 59, 68].includes(b)) - Number([1, 10, 8, 19, 50, 61, 59, 68].includes(a)) || a - b),
    [...cells].sort((a, b) => Math.abs(a % WIDTH - 4) - Math.abs(b % WIDTH - 4) || a - b),
  ];
  for (const order of orders) for (const first of cells) for (let count = 0; count <= 16; count++) {
    const sources = sourcePositions(order, first, count);
    assert.equal(sources.length, count); assertWalkable(sources, first);
    assert.ok([first, ...neighbors(first)].every(cell => !sources.includes(cell)));
  }
});

test('malformed geometry inputs fail closed', () => {
  for (const cell of [-1, SIZE, 0.5, NaN, Infinity]) {
    assert.throws(() => neighbors(cell)); assert.throws(() => cardinalNeighbors(cell));
    assert.throws(() => sourcePositions(cells, cell, 8)); assert.equal(isReachableLayout([cell]), false);
  }
  for (const count of [-1, 17, 0.5, NaN, Infinity]) assert.throws(() => sourcePositions(cells, 34, count));
  for (const order of [[], cells.slice(1), [...cells, 0], cells.map(() => 0), cells.map(cell => cell === 6 ? NaN : cell)]) assert.throws(() => sourcePositions(order, 34, 8));
  assert.equal(isReachableLayout([1, 1]), false); assert.equal(isReachableLayout(cells), false);
});

test('layout creation has no RNG input and no mine/orb outcome dependency', () => {
  const order = Object.freeze(shuffled(812)), before = JSON.stringify(order);
  const sources = sourcePositions(order, 34, 16);
  // The engine can attach either outcome after geometry is fixed. Both outcome
  // assignments leave every ordinary cell and every source approach unchanged.
  for (const mine of [false, true]) {
    const board = cells.map(cell => ({ source: sources.includes(cell), mine: sources.includes(cell) && mine }));
    assert.deepEqual(board.flatMap((cell, index) => cell.source ? [index] : []), [...sources].sort((a, b) => a - b));
    assertWalkable(sources, 34);
  }
  assert.equal(JSON.stringify(order), before);
});

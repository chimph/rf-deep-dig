/** Geometry is independent of whether a resonance source contains an orb or a mine. */
export const WIDTH = 10, HEIGHT = 8, SIZE = WIDTH * HEIGHT;

const validCell = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < SIZE;
function checkCell(cell: number) {
  if (!validCell(cell)) throw Error('Cell must be an integer inside the board.');
}

/** Eight surrounding cells, in row order. Clues include diagonals. */
export function neighbors(cell: number): number[] {
  checkCell(cell);
  const x = cell % WIDTH, y = Math.floor(cell / WIDTH), result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && x + dx >= 0 && x + dx < WIDTH && y + dy >= 0 && y + dy < HEIGHT) {
      result.push((y + dy) * WIDTH + x + dx);
    }
  }
  return result;
}

/** Four walking neighbors, ordered up, left, right, down when present. */
export function cardinalNeighbors(cell: number): number[] {
  checkCell(cell);
  const x = cell % WIDTH, y = Math.floor(cell / WIDTH), result: number[] = [];
  if (y > 0) result.push(cell - WIDTH);
  if (x > 0) result.push(cell - 1);
  if (x < WIDTH - 1) result.push(cell + 1);
  if (y < HEIGHT - 1) result.push(cell + WIDTH);
  return result;
}

// Precompute valid geometry; placement checks can inspect many candidate layouts.
const cardinal = Array.from({ length: SIZE }, (_, cell) => cardinalNeighbors(cell));

/**
 * Every ordinary tile is reachable without entering a source, and every source
 * can be approached from an ordinary tile. This is not a no-guess puzzle promise.
 */
export function isReachableLayout(sources: readonly number[]): boolean {
  if (!Array.isArray(sources) || sources.some(cell => !validCell(cell))) return false;
  const blocked = new Set(sources);
  if (blocked.size !== sources.length || blocked.size === SIZE) return false;
  const first = Array.from({ length: SIZE }, (_, cell) => cell).find(cell => !blocked.has(cell))!;
  const visited = new Set([first]), queue = [first];
  for (let i = 0; i < queue.length; i++) {
    for (const next of cardinal[queue[i]]) if (!blocked.has(next) && !visited.has(next)) {
      visited.add(next); queue.push(next);
    }
  }
  return visited.size === SIZE - blocked.size && sources.every(cell => cardinal[cell].some(next => !blocked.has(next)));
}

/**
 * Use the committed shuffled order without consulting source outcomes. The first
 * tile and its eight neighbors stay ordinary. Accepted placements preserve the
 * connected ordinary ground and an ordinary approach to every source.
 */
export function sourcePositions(order: readonly number[], first: number, count: number): number[] {
  checkCell(first);
  if (!Number.isInteger(count) || count < 0 || count > 16) throw Error('Source count must be an integer from 0 to 16.');
  if (!Array.isArray(order) || order.length !== SIZE || order.some(cell => !validCell(cell)) || new Set(order).size !== SIZE) {
    throw Error(`Board order must be a permutation of all ${SIZE} cells.`);
  }
  const protectedCells = new Set([first, ...neighbors(first)]), sources: number[] = [];
  for (const cell of order) {
    if (sources.length === count) return sources;
    if (protectedCells.has(cell)) continue;
    sources.push(cell);
    if (!isReachableLayout(sources)) sources.pop();
  }
  if (sources.length === count) return sources;

  // Stable fallback: even rows plus column zero are a connected backbone. The
  // other 36 cells all touch it; protecting a 3×3 area leaves at least 30 choices.
  // Keep their committed order, preserving determinism without another RNG draw.
  return order.filter(cell => Math.floor(cell / WIDTH) % 2 === 1 && cell % WIDTH !== 0 && !protectedCells.has(cell)).slice(0, count);
}

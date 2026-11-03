/**
 * Line-shape classifier that respects the Infinite XO win rule:
 *   win = maximal run >= 5 AND NOT (both outer cells are opponent stones).
 *
 * A "line" is the 11 cells centred on a cell (offsets -5..+5) in one direction,
 * seen from one player's perspective: 0 = empty, 1 = own, 2 = opponent.
 * The centre is always own (the stone we are evaluating / about to place).
 * Cells outside the window are treated as empty.
 *
 * Shapes are derived generically from "how many placements until a win", so the
 * custom block rule (a dead five between two opponent stones) is handled
 * automatically – no hand-written pattern table.
 */
export const enum Shape {
  None = 0,
  Two2 = 1, // closed two: can become a closed three
  Two = 2, // open two: can become an open three
  Three3 = 3, // closed three: can become a four
  Three = 4, // open three: can become an open four
  Four = 5, // one placement wins (one winning point)
  OpenFour = 6, // two or more winning points -> cannot be stopped in this line
  Five = 7, // already winning
}

export const WIN_W = 11;
export const CENTER = 5;
const SIZE = 3 ** WIN_W; // 177147

// One memo table per search depth (0: four-level, 1: three-level, 2: two-level).
const memo = [new Int8Array(SIZE).fill(-1), new Int8Array(SIZE).fill(-1), new Int8Array(SIZE).fill(-1)];

const POW3: number[] = [];
for (let i = 0, v = 1; i < WIN_W; i++, v *= 3) POW3.push(v);

function encode(a: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < WIN_W; i++) c += a[i] * POW3[i];
  return c;
}

/** Is the run through index i winning, and does it cover the centre? */
function winsThrough(a: Uint8Array, i: number): boolean {
  let l = i;
  while (l > 0 && a[l - 1] === 1) l--;
  let r = i;
  while (r < WIN_W - 1 && a[r + 1] === 1) r++;
  if (r - l + 1 < 5) return false;
  if (l > CENTER || r < CENTER) return false;
  const before = l > 0 ? a[l - 1] : 0;
  const after = r < WIN_W - 1 ? a[r + 1] : 0;
  return !(before === 2 && after === 2);
}

function winPoints(a: Uint8Array): number {
  let n = 0;
  for (let e = 0; e < WIN_W; e++) {
    if (a[e] !== 0) continue;
    a[e] = 1;
    if (winsThrough(a, e)) n++;
    a[e] = 0;
  }
  return n;
}

const PROMOTE: Record<number, Shape> = {
  [Shape.OpenFour]: Shape.Three,
  [Shape.Four]: Shape.Three3,
  [Shape.Three]: Shape.Two,
  [Shape.Three3]: Shape.Two2,
};

function level(a: Uint8Array, depth: number): Shape {
  const code = encode(a);
  const table = memo[depth];
  const hit = table[code];
  if (hit !== -1) return hit as Shape;

  let result: Shape;
  if (winsThrough(a, CENTER)) result = Shape.Five;
  else {
    const wp = winPoints(a);
    if (wp >= 2) result = Shape.OpenFour;
    else if (wp === 1) result = Shape.Four;
    else {
      result = Shape.None;
      if (depth > 0) {
        for (let e = 0; e < WIN_W && result < Shape.Three; e++) {
          if (a[e] !== 0) continue;
          a[e] = 1;
          const s = PROMOTE[level(a, depth - 1)] ?? Shape.None;
          a[e] = 0;
          if (s > result) result = s;
        }
      }
    }
  }
  table[code] = result;
  return result;
}

const scratch = new Uint8Array(WIN_W);

/** Classify a line given as a base-3 code (centre must be own). */
export function shapeOfCode(code: number): Shape {
  const hit = memo[2][code];
  if (hit !== -1) return hit as Shape;
  let c = code;
  for (let i = 0; i < WIN_W; i++) {
    scratch[i] = c % 3;
    c = (c - scratch[i]) / 3;
  }
  scratch[CENTER] = 1;
  return level(scratch, 2);
}

export { POW3 };

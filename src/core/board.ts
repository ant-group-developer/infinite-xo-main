import type { Cell, Player } from './types';

/**
 * Sparse unbounded board. Coordinates can be any safe integer (negative ok).
 * Packs (x, y) into one number key so lookups avoid string allocation.
 */
const OFFSET = 1 << 20; // supports |x|,|y| < ~1M which is far beyond any real game
const SPAN = 1 << 21;

export const keyOf = (x: number, y: number): number => (x + OFFSET) * SPAN + (y + OFFSET);
export const cellOf = (k: number): Cell => ({
  x: Math.floor(k / SPAN) - OFFSET,
  y: (k % SPAN) - OFFSET,
});

export const isValidCoord = (x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) < OFFSET && Math.abs(y) < OFFSET;

export class Board {
  private cells = new Map<number, Player>();

  get size(): number {
    return this.cells.size;
  }

  get(x: number, y: number): Player | undefined {
    return this.cells.get(keyOf(x, y));
  }

  has(x: number, y: number): boolean {
    return this.cells.has(keyOf(x, y));
  }

  set(x: number, y: number, p: Player): void {
    this.cells.set(keyOf(x, y), p);
  }

  delete(x: number, y: number): void {
    this.cells.delete(keyOf(x, y));
  }

  clear(): void {
    this.cells.clear();
  }

  *entries(): IterableIterator<[Cell, Player]> {
    for (const [k, p] of this.cells) yield [cellOf(k), p];
  }

  clone(): Board {
    const b = new Board();
    for (const [k, p] of this.cells) b.cells.set(k, p);
    return b;
  }

  /** Axis-aligned bounds of all stones, or null if empty. */
  bounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (this.cells.size === 0) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const k of this.cells.keys()) {
      const { x, y } = cellOf(k);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  }
}

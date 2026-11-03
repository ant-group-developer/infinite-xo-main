import { cellOf, keyOf } from '../core/board';
import { DIRECTIONS, type Cell, type Move, type Player } from '../core/types';
import { CENTER, POW3, Shape, WIN_W, shapeOfCode } from './patterns';

const NEAR = 2; // candidate radius (Chebyshev)

/** Mutable board tuned for search: place/undo + incremental candidate set. */
export class SearchBoard {
  readonly cells = new Map<number, Player>();
  /** empty cell key -> number of stones within NEAR */
  private near = new Map<number, number>();
  readonly history: Move[] = [];

  constructor(moves: Iterable<Move> = []) {
    for (const m of moves) this.place(m.x, m.y, m.p);
  }

  get(x: number, y: number): Player | undefined {
    return this.cells.get(keyOf(x, y));
  }

  get stoneCount(): number {
    return this.cells.size;
  }

  place(x: number, y: number, p: Player): void {
    const k = keyOf(x, y);
    this.cells.set(k, p);
    this.near.delete(k);
    this.history.push({ x, y, p });
    for (let dy = -NEAR; dy <= NEAR; dy++)
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        if (!dx && !dy) continue;
        const nk = keyOf(x + dx, y + dy);
        if (this.cells.has(nk)) continue;
        this.near.set(nk, (this.near.get(nk) ?? 0) + 1);
      }
  }

  undo(): void {
    const m = this.history.pop();
    if (!m) return;
    const k = keyOf(m.x, m.y);
    this.cells.delete(k);
    let count = 0;
    for (let dy = -NEAR; dy <= NEAR; dy++)
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        if (!dx && !dy) continue;
        const nk = keyOf(m.x + dx, m.y + dy);
        if (this.cells.has(nk)) {
          count++;
          continue;
        }
        const c = (this.near.get(nk) ?? 0) - 1;
        if (c <= 0) this.near.delete(nk);
        else this.near.set(nk, c);
      }
    if (count) this.near.set(k, count);
  }

  candidates(): Cell[] {
    if (this.cells.size === 0) return [{ x: 0, y: 0 }];
    const out: Cell[] = [];
    for (const k of this.near.keys()) out.push(cellOf(k));
    return out;
  }

  /** Base-3 line code around (x, y) in direction (dx, dy), as if `p` stood on (x, y). */
  lineCode(x: number, y: number, dx: number, dy: number, p: Player): number {
    let code = POW3[CENTER];
    for (let i = 0; i < WIN_W; i++) {
      if (i === CENTER) continue;
      const o = i - CENTER;
      const v = this.cells.get(keyOf(x + o * dx, y + o * dy));
      if (v !== undefined) code += (v === p ? 1 : 2) * POW3[i];
    }
    return code;
  }

  /** Shapes in the 4 directions if `p` played the empty cell (x, y). */
  shapes(x: number, y: number, p: Player): Shape[] {
    return DIRECTIONS.map(([dx, dy]) => shapeOfCode(this.lineCode(x, y, dx, dy, p)));
  }

  /** Exact winning points for `p` on lines through (x, y) (within ±5). */
  winPointsAround(x: number, y: number, p: Player): Cell[] {
    const out: Cell[] = [];
    for (const [dx, dy] of DIRECTIONS)
      for (let o = -5; o <= 5; o++) {
        const cx = x + o * dx,
          cy = y + o * dy;
        if (this.cells.has(keyOf(cx, cy))) continue;
        if (this.wouldWin(cx, cy, p) && !out.some((c) => c.x === cx && c.y === cy))
          out.push({ x: cx, y: cy });
      }
    return out;
  }

  /** Exact rule check (no window approximation) for an empty cell. */
  wouldWin(x: number, y: number, p: Player): boolean {
    const opp = p === 'X' ? 'O' : 'X';
    for (const [dx, dy] of DIRECTIONS) {
      let neg = 0;
      while (this.get(x - (neg + 1) * dx, y - (neg + 1) * dy) === p) neg++;
      let pos = 0;
      while (this.get(x + (pos + 1) * dx, y + (pos + 1) * dy) === p) pos++;
      if (neg + pos + 1 < 5) continue;
      const before = this.get(x - (neg + 1) * dx, y - (neg + 1) * dy);
      const after = this.get(x + (pos + 1) * dx, y + (pos + 1) * dy);
      if (!(before === opp && after === opp)) return true;
    }
    return false;
  }
}

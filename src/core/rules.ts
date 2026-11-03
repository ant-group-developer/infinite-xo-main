import type { Board } from './board';
import { DIRECTIONS, WIN_LENGTH, other, type Player, type WinLine } from './types';

type Getter = (x: number, y: number) => Player | undefined;

/**
 * Spec §9: call AFTER the stone at (x, y) has been placed.
 * Win = maximal run through (x, y) has length >= 5 AND the two cells just
 * outside the run are not BOTH opponent stones. Empty cells never block.
 */
export function checkWinAt(get: Getter, x: number, y: number, player: Player): WinLine | null {
  const opponent = other(player);
  for (const [dx, dy] of DIRECTIONS) {
    let neg = 0;
    while (get(x - (neg + 1) * dx, y - (neg + 1) * dy) === player) neg++;
    let pos = 0;
    while (get(x + (pos + 1) * dx, y + (pos + 1) * dy) === player) pos++;

    const length = neg + 1 + pos;
    if (length < WIN_LENGTH) continue;

    const before = get(x - (neg + 1) * dx, y - (neg + 1) * dy);
    const after = get(x + (pos + 1) * dx, y + (pos + 1) * dy);
    if (before === opponent && after === opponent) continue; // blocked both ends

    const cells = [];
    for (let i = -neg; i <= pos; i++) cells.push({ x: x + i * dx, y: y + i * dy });
    return {
      direction: [dx, dy],
      length,
      start: cells[0],
      end: cells[cells.length - 1],
      cells,
    };
  }
  return null;
}

export const checkWin = (board: Board, x: number, y: number, player: Player): WinLine | null =>
  checkWinAt((px, py) => board.get(px, py), x, y, player);

/** Would placing `player` on the empty cell (x, y) win right now? Board is left unchanged. */
export function wouldWin(board: Board, x: number, y: number, player: Player): boolean {
  if (board.has(x, y)) return false;
  return (
    checkWinAt((px, py) => (px === x && py === y ? player : board.get(px, py)), x, y, player) !==
    null
  );
}

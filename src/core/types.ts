export type Player = 'X' | 'O';

export const other = (p: Player): Player => (p === 'X' ? 'O' : 'X');

export interface Cell {
  x: number;
  y: number;
}

export interface Move extends Cell {
  p: Player;
}

/** Four line directions: horizontal, vertical, diagonal down, diagonal up (spec §4). */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export const WIN_LENGTH = 5;

export interface WinLine {
  direction: readonly [number, number];
  length: number;
  start: Cell;
  end: Cell;
  /** Every cell of the maximal run (may be longer than 5). */
  cells: Cell[];
}

export type GameStatus = 'playing' | 'won' | 'resigned' | 'draw';

export type RejectReason = 'game-over' | 'wrong-turn' | 'occupied' | 'invalid-coord';

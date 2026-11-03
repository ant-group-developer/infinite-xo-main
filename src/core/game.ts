import { Board, isValidCoord } from './board';
import { checkWin } from './rules';
import { other, type GameStatus, type Move, type Player, type RejectReason, type WinLine } from './types';

export type GameEvent =
  | { type: 'reset' }
  | { type: 'move'; move: Move }
  | { type: 'undo'; moves: Move[] }
  | { type: 'win'; winner: Player; line: WinLine }
  | { type: 'resign'; loser: Player; winner: Player }
  | { type: 'draw-offer'; from: Player }
  | { type: 'draw-declined'; by: Player }
  | { type: 'draw' };

export type PlayResult =
  | { ok: true; move: Move; win: WinLine | null }
  | { ok: false; reason: RejectReason };

type Listener = (e: GameEvent) => void;

/**
 * Authoritative game state machine (spec §2, §7, §9.1).
 * Renderers / bots / network layers only read state and call these methods.
 */
export class Game {
  readonly board = new Board();
  readonly moves: Move[] = [];
  turn: Player = 'X';
  status: GameStatus = 'playing';
  winner: Player | null = null;
  winLine: WinLine | null = null;
  drawOfferFrom: Player | null = null;
  firstPlayer: Player = 'X';

  private listeners = new Set<Listener>();

  constructor(firstPlayer: Player = 'X') {
    this.reset(firstPlayer);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: GameEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get isOver(): boolean {
    return this.status !== 'playing';
  }

  get lastMove(): Move | null {
    return this.moves[this.moves.length - 1] ?? null;
  }

  reset(firstPlayer: Player = 'X'): void {
    this.board.clear();
    this.moves.length = 0;
    this.firstPlayer = firstPlayer;
    this.turn = firstPlayer;
    this.status = 'playing';
    this.winner = null;
    this.winLine = null;
    this.drawOfferFrom = null;
    this.emit({ type: 'reset' });
  }

  /**
   * Place a stone. `by` lets a caller assert whose move this is (TC14);
   * omitted means "whoever's turn it is".
   */
  play(x: number, y: number, by?: Player): PlayResult {
    if (this.isOver) return { ok: false, reason: 'game-over' };
    if (by && by !== this.turn) return { ok: false, reason: 'wrong-turn' };
    if (!isValidCoord(x, y)) return { ok: false, reason: 'invalid-coord' };
    if (this.board.has(x, y)) return { ok: false, reason: 'occupied' };

    const p = this.turn;
    const move: Move = { x, y, p };
    this.board.set(x, y, p);
    this.moves.push(move);
    this.drawOfferFrom = null;

    // Update ALL state first, then notify: listeners must see the new turn/status.
    const win = checkWin(this.board, x, y, p);
    if (win) {
      this.status = 'won';
      this.winner = p;
      this.winLine = win;
    } else {
      this.turn = other(p);
    }
    this.emit({ type: 'move', move });
    if (win) this.emit({ type: 'win', winner: p, line: win });
    return { ok: true, move, win };
  }

  /** Take back the last `count` moves (only while the game is running). */
  undo(count = 1): Move[] {
    if (this.isOver) return [];
    const removed: Move[] = [];
    while (count-- > 0 && this.moves.length) {
      const m = this.moves.pop()!;
      this.board.delete(m.x, m.y);
      removed.push(m);
    }
    if (removed.length) {
      this.turn = removed[removed.length - 1].p;
      this.drawOfferFrom = null;
      this.emit({ type: 'undo', moves: removed });
    }
    return removed;
  }

  resign(player: Player): boolean {
    if (this.isOver) return false;
    this.status = 'resigned';
    this.winner = other(player);
    this.emit({ type: 'resign', loser: player, winner: this.winner });
    return true;
  }

  /** End as a draw without the offer/answer handshake (result decided elsewhere, e.g. a server). */
  declareDraw(): boolean {
    if (this.isOver) return false;
    this.drawOfferFrom = null;
    this.status = 'draw';
    this.emit({ type: 'draw' });
    return true;
  }

  offerDraw(from: Player): boolean {
    if (this.isOver || this.drawOfferFrom) return false;
    this.drawOfferFrom = from;
    this.emit({ type: 'draw-offer', from });
    return true;
  }

  /** The player who did NOT offer answers. */
  respondDraw(by: Player, accept: boolean): boolean {
    if (this.isOver || !this.drawOfferFrom || this.drawOfferFrom === by) return false;
    this.drawOfferFrom = null;
    if (accept) {
      this.status = 'draw';
      this.emit({ type: 'draw' });
    } else {
      this.emit({ type: 'draw-declined', by });
    }
    return true;
  }
}

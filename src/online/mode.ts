import type { GameEvent } from '../core/game';
import type { Cell, Player } from '../core/types';

/** Something that temporarily drives the main game screen (e.g. an online match). */
export interface ModeController {
  onTap(cell: Cell): void;
  onAction(action: 'undo' | 'hint' | 'resign' | 'draw' | 'new'): void;
  onGameEvent(e: GameEvent): void;
  /** Fill the score cards / status line / buttons. */
  renderHud(): void;
  /** Whose ghost piece to preview under the cursor (null = no input). */
  interactivePlayer(): Player | null;
}

/** What the online layer needs from the App. */
export interface MatchHost {
  readonly game: import('../core/game').Game;
  setMode(mode: ModeController | null): void;
  recenter(): void;
  reject(cell: Cell): void;
  render(): void;
  /** Fallback when the server is unreachable / full: offline game vs the bot. */
  playOfflineBot(): void;
}

import type { Cell, Player } from '../core/types';

/**
 * Contract between the app controller and a board renderer.
 * The 2D canvas view implements it today; a Three.js view can implement the
 * same interface later and be swapped in without touching game logic.
 *
 * A view READS the Game (it subscribes to its events) and reports taps.
 * It never mutates game state.
 */
export interface BoardView {
  /** Called when the user taps/clicks a board cell (after pan/zoom gesture filtering). */
  onCellTap: ((cell: Cell) => void) | null;

  /** Whose piece to preview under the cursor, or null to disable input preview. */
  setInteractive(player: Player | null): void;

  /** Show a pulsing hint marker (null clears it). */
  showHint(cell: Cell | null): void;

  /** Fit the camera to all stones (or the origin if empty). */
  recenter(animate?: boolean): void;

  zoomBy(factor: number): void;

  /** Flash an "illegal move" feedback on a cell. */
  reject(cell: Cell): void;

  destroy(): void;
}

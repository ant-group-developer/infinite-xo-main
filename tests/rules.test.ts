import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import type { Player } from '../src/core/types';

/**
 * Build a line position from a pattern like "O X X X X _ ·".
 * `_` marks the cell X (or the given player) will play last; `·`/`.` empty.
 * Cells are laid out from (x0, y0) along (dx, dy).
 */
function scenario(pattern: string, dir: [number, number] = [1, 0], x0 = 0, y0 = 0, player: Player = 'X') {
  const g = new Game();
  const tokens = pattern.trim().split(/\s+/);
  let target: [number, number] | null = null;
  tokens.forEach((t, i) => {
    const x = x0 + i * dir[0];
    const y = y0 + i * dir[1];
    if (t === 'X' || t === 'O') g.board.set(x, y, t);
    if (t === '_') target = [x, y];
  });
  if (!target) throw new Error('pattern needs a _');
  g.turn = player;
  const res = g.play(target[0], target[1]);
  return { g, res };
}

describe('win rule (spec §5, §11)', () => {
  it('TC01 four in a row does not win', () => {
    const { res, g } = scenario('· X X X _ ·');
    expect(res.ok && res.win).toBe(null);
    expect(g.status).toBe('playing');
    expect(g.turn).toBe('O');
  });

  it('TC02 five, both ends open wins', () => {
    const { res, g } = scenario('· X X _ X X ·');
    expect(res.ok && res.win?.length).toBe(5);
    expect(g.status).toBe('won');
    expect(g.winner).toBe('X');
  });

  it('TC03 five, one end blocked wins (left or right)', () => {
    expect(scenario('O X X X X _ ·').g.status).toBe('won');
    expect(scenario('· _ X X X X O').g.status).toBe('won');
  });

  it('TC04 five, both ends blocked does not win', () => {
    const { g } = scenario('O X X _ X X O');
    expect(g.status).toBe('playing');
  });

  it('TC05 six, both ends open wins', () => {
    const { res } = scenario('· X X X _ X X ·');
    expect(res.ok && res.win?.length).toBe(6);
  });

  it('TC06 six, one end blocked wins', () => {
    expect(scenario('O X X X X X _ ·').g.status).toBe('won');
  });

  it('TC07 six, both ends blocked does not win', () => {
    expect(scenario('O X X _ X X X O').g.status).toBe('playing');
  });

  it('TC08 opponent stone in the middle breaks the run', () => {
    expect(scenario('· X X O X X _ ·').g.status).toBe('playing');
  });

  it('TC09 vertical win, same block rule', () => {
    expect(scenario('O X X X X _ ·', [0, 1]).g.status).toBe('won');
    expect(scenario('O X X _ X X O', [0, 1]).g.status).toBe('playing');
  });

  it('TC10 diagonal-down win, same block rule', () => {
    expect(scenario('· X X _ X X ·', [1, 1]).g.status).toBe('won');
    expect(scenario('O X X _ X X O', [1, 1]).g.status).toBe('playing');
  });

  it('TC11 diagonal-up win, same block rule', () => {
    expect(scenario('· X X _ X X ·', [1, -1]).g.status).toBe('won');
    expect(scenario('O X X _ X X O', [1, -1]).g.status).toBe('playing');
  });

  it('TC12 one direction blocked both ends, another direction valid -> win', () => {
    const g = new Game();
    // Horizontal: O X X [X] X X O (dead). Vertical through (2,0): X X [X] X X open.
    for (const [x, t] of [[-1, 'O'], [0, 'X'], [1, 'X'], [3, 'X'], [4, 'X'], [5, 'O']] as const)
      g.board.set(x, 0, t);
    for (const y of [-2, -1, 1, 2]) g.board.set(2, y, 'X');
    const res = g.play(2, 0);
    expect(g.status).toBe('won');
    expect(res.ok && res.win?.direction).toEqual([0, 1]);
  });

  it('TC17 joining two groups into 6+ checks the whole new run', () => {
    // Spec §5.2: O X X X · X X ·  ->  O X X X X X X ·  = win
    const { res } = scenario('O X X X _ X X ·');
    expect(res.ok && res.win?.length).toBe(6);
    // The block check uses the ends of the MAXIMAL run, not a sub-window of 5.
    expect(scenario('O X X X _ X X O').g.status).toBe('playing');
  });

  it('highlights the full maximal run', () => {
    const { res } = scenario('· X X X _ X X X ·');
    expect(res.ok && res.win?.cells.length).toBe(7);
  });
});

describe('move validation (spec §2, §11)', () => {
  it('TC13 occupied cell is rejected and turn does not change', () => {
    const g = new Game();
    g.play(0, 0);
    const res = g.play(0, 0);
    expect(res).toEqual({ ok: false, reason: 'occupied' });
    expect(g.turn).toBe('O');
    expect(g.moves.length).toBe(1);
  });

  it('TC14 wrong turn is rejected', () => {
    const g = new Game();
    expect(g.play(0, 0, 'O')).toEqual({ ok: false, reason: 'wrong-turn' });
    expect(g.play(0, 0, 'X').ok).toBe(true);
  });

  it('TC15 no moves after a win (no blocking after the fact)', () => {
    const { g } = scenario('O X X X X _ ·');
    expect(g.status).toBe('won');
    expect(g.play(5 + 1, 0)).toEqual({ ok: false, reason: 'game-over' });
  });

  it('TC16 edge of the screen is not a block: empty far cells count as empty', () => {
    // Stones far from the origin and next to nothing still win with one side blocked.
    const { g } = scenario('O X X X X _', [1, 0], 1000, -1000);
    expect(g.status).toBe('won');
  });

  it('TC18 negative coordinates are valid', () => {
    const { g } = scenario('· X X _ X X ·', [1, 0], -50, -7);
    expect(g.status).toBe('won');
    expect(g.winLine?.start).toEqual({ x: -49, y: -7 });
  });

  it('rejects non-integer coordinates', () => {
    const g = new Game();
    expect(g.play(0.5, 0)).toEqual({ ok: false, reason: 'invalid-coord' });
  });
});

describe('end of game (spec §7)', () => {
  it('TC19 resign: opponent wins', () => {
    const g = new Game();
    g.play(0, 0);
    g.resign('O');
    expect(g.status).toBe('resigned');
    expect(g.winner).toBe('X');
    expect(g.play(1, 1).ok).toBe(false);
  });

  it('TC20 both players agree to a draw', () => {
    const g = new Game();
    g.play(0, 0);
    expect(g.offerDraw('O')).toBe(true);
    expect(g.respondDraw('O', true)).toBe(false); // offerer cannot accept own offer
    expect(g.respondDraw('X', true)).toBe(true);
    expect(g.status).toBe('draw');
  });

  it('declined draw keeps the game going; a move clears the offer', () => {
    const g = new Game();
    g.offerDraw('X');
    g.respondDraw('O', false);
    expect(g.status).toBe('playing');
    g.offerDraw('X');
    g.play(0, 0);
    expect(g.drawOfferFrom).toBe(null);
  });

  it('listeners see the updated turn when a move event fires (2-player HUD bug)', () => {
    const g = new Game();
    const seen: string[] = [];
    g.on((e) => {
      if (e.type === 'move') seen.push(`${e.move.p}->${g.turn}`);
    });
    g.play(0, 0);
    g.play(5, 5);
    expect(seen).toEqual(['X->O', 'O->X']);
  });

  it('listeners see status=won on the winning move event', () => {
    const g = new Game();
    let statusOnMove = '';
    for (const [x, t] of [[0, 'X'], [1, 'X'], [2, 'X'], [3, 'X']] as const) g.board.set(x, 0, t);
    g.on((e) => {
      if (e.type === 'move') statusOnMove = g.status;
    });
    g.play(4, 0);
    expect(statusOnMove).toBe('won');
  });

  it('undo restores board and turn', () => {
    const g = new Game();
    g.play(0, 0);
    g.play(1, 0);
    g.undo(2);
    expect(g.moves.length).toBe(0);
    expect(g.board.size).toBe(0);
    expect(g.turn).toBe('X');
  });
});

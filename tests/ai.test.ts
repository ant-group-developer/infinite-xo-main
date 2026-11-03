import { describe, expect, it } from 'vitest';
import { chooseMove, findVcf, type Level } from '../src/ai/bot';
import { Shape, shapeOfCode, POW3 } from '../src/ai/patterns';
import { SearchBoard } from '../src/ai/searchBoard';
import type { Move, Player } from '../src/core/types';

/** Moves from a row pattern, e.g. "O X X X X _" at y=0 starting x=0. */
function row(pattern: string, y = 0, x0 = 0): Move[] {
  return pattern
    .trim()
    .split(/\s+/)
    .flatMap((t, i) => (t === 'X' || t === 'O' ? [{ x: x0 + i, y, p: t as Player }] : []));
}

function code(line: string): number {
  // line of 11 chars, centre must be '1'
  return [...line].reduce((acc, ch, i) => acc + Number(ch) * POW3[i], 0);
}

describe('pattern classifier', () => {
  it('detects five, dead five, open four, four, three', () => {
    expect(shapeOfCode(code('00011111000'))).toBe(Shape.Five);
    expect(shapeOfCode(code('00211111200'))).toBe(Shape.None); // dead five: both ends blocked
    expect(shapeOfCode(code('00011110000'))).toBe(Shape.OpenFour);
    expect(shapeOfCode(code('00211110000'))).toBe(Shape.Four);
    expect(shapeOfCode(code('00001110000'))).toBe(Shape.Three);
  });

  it('a four squeezed between opponent stones with one gap is dead', () => {
    // O X X X X . O  -> filling gives O X X X X X O (no win) => not a four
    expect(shapeOfCode(code('02111102000'))).not.toBe(Shape.Four);
  });
});

describe('bot basics', () => {
  const levels: Level[] = ['medium', 'hard'];

  for (const level of levels) {
    it(`${level}: takes an immediate win`, () => {
      const moves = [...row('· X X X X ·'), ...row('O O O ·', 3)];
      const r = chooseMove({ moves, player: 'X', level, seed: 1, timeMs: 200 });
      expect([0, 5]).toContain(r.move.x);
      expect(r.move.y).toBe(0);
    });

    it(`${level}: blocks an immediate loss`, () => {
      const moves = [...row('O X X X X ·'), { x: 3, y: 5, p: 'O' as Player }, { x: 9, y: 9, p: 'O' as Player }];
      const r = chooseMove({ moves, player: 'O', level, seed: 2, timeMs: 200 });
      expect(r.move).toEqual({ x: 5, y: 0 });
    });

    it(`${level}: ignores a dead five (both ends blocked is not a threat)`, () => {
      // X X X X _ between O stones: O X X X X . O -> filling is NOT a win.
      const moves = [...row('O X X X X · O'), { x: 0, y: 3, p: 'O' as Player }];
      const r = chooseMove({ moves, player: 'O', level, seed: 3, timeMs: 200 });
      expect(r.reason).not.toBe('block');
    });
  }

  it('hard finds a VCF', () => {
    // X has a broken four potential in two lines meeting at a point.
    const moves: Move[] = [
      ...row('· X X X ·', 0, 0),
      { x: 4, y: 1, p: 'X' },
      { x: 4, y: 2, p: 'X' },
      { x: 4, y: 3, p: 'X' },
      { x: 10, y: 10, p: 'O' },
      { x: 11, y: 10, p: 'O' },
      { x: 12, y: 12, p: 'O' },
      { x: 0, y: 5, p: 'O' },
      { x: -3, y: 4, p: 'O' },
    ];
    const b = new SearchBoard(moves);
    expect(findVcf(b, 'X')).not.toBeNull();
  });
});


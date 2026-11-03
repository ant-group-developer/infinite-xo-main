/**
 * Bot-vs-bot strength benchmark (slow). Run: npm run bench
 * Optional env: GAMES=4 TIME=200
 */
import { describe, expect, it } from 'vitest';
import { chooseMove, type Level } from '../src/ai/bot';
import { Game } from '../src/core/game';
import type { Player } from '../src/core/types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const GAMES = Number(env.GAMES ?? 3);
const TIME = Number(env.TIME ?? 200);

function playMatch(xLevel: Level, oLevel: Level, seed: number, maxMoves = 160) {
  const g = new Game();
  let s = seed;
  let slowest = 0;
  while (!g.isOver && g.moves.length < maxMoves) {
    const level = g.turn === 'X' ? xLevel : oLevel;
    const t0 = performance.now();
    const r = chooseMove({ moves: g.moves, player: g.turn, level, seed: s++, timeMs: TIME });
    slowest = Math.max(slowest, performance.now() - t0);
    const res = g.play(r.move.x, r.move.y);
    if (!res.ok) throw new Error(`illegal bot move ${JSON.stringify(r)}: ${res.reason}`);
  }
  return { winner: g.winner as Player | null, moves: g.moves.length, slowest: Math.round(slowest) };
}

function series(a: Level, b: Level) {
  let aWins = 0,
    bWins = 0,
    draws = 0,
    slowest = 0;
  for (let i = 0; i < GAMES; i++) {
    for (const aIsX of [true, false]) {
      const r = playMatch(aIsX ? a : b, aIsX ? b : a, 1000 * i + (aIsX ? 1 : 2));
      slowest = Math.max(slowest, r.slowest);
      if (!r.winner) draws++;
      else if ((r.winner === 'X') === aIsX) aWins++;
      else bWins++;
    }
  }
  console.log(`${a} vs ${b}: ${aWins}-${bWins} (draws ${draws}), slowest move ${slowest}ms @ budget ${TIME}ms`);
  return { aWins, bWins };
}

describe('bot strength', () => {
  it('hard > easy', () => {
    const r = series('hard', 'easy');
    expect(r.aWins).toBeGreaterThan(r.bWins * 2);
  }, 600_000);

  it('hard > medium', () => {
    const r = series('hard', 'medium');
    expect(r.aWins).toBeGreaterThan(r.bWins);
  }, 600_000);

  it('medium > easy', () => {
    const r = series('medium', 'easy');
    expect(r.aWins).toBeGreaterThan(r.bWins);
  }, 600_000);
});

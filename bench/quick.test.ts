import { it } from 'vitest';
import { chooseMove, type Level } from '../src/ai/bot';
import { Game } from '../src/core/game';
const env = (globalThis as any).process.env;
it('quick series', () => {
  const A = env.A as Level, B = env.B as Level, N = +(env.N ?? 10), T = +(env.T ?? 300);
  let a = 0, b = 0, d = 0, xw = 0;
  for (let i = 0; i < N; i++) for (const aIsX of [true, false]) {
    const g = new Game(); let s = i * 97 + (aIsX ? 1 : 2);
    while (!g.isOver && g.moves.length < 160) {
      const lv = (g.turn === 'X') === aIsX ? A : B;
      const r = chooseMove({ moves: g.moves, player: g.turn, level: lv, seed: s++, timeMs: T });
      g.play(r.move.x, r.move.y);
    }
    if (!g.winner) d++; else { if (g.winner === 'X') xw++; if ((g.winner === 'X') === aIsX) a++; else b++; }
  }
  console.log(`${A} vs ${B}: ${a}-${b} draws ${d}, X won ${xw}/${2 * N}`);
}, 3600000);

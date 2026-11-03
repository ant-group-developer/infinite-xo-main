import { BotClient } from '../ai/BotClient';
import { evaluate } from '../ai/bot';
import { botStyle, thinkTime } from '../ai/persona';
import { SearchBoard } from '../ai/searchBoard';
import { other } from '../core/types';
import type { Unsub } from '../net/db';
import type { GameDoc, MatchSync } from '../net/match';
import type { Side } from '../net/schema';

/**
 * Plays the persona's side of a 'bot' room from the human host's client,
 * with human-looking timing. Only attached when doc.type === 'bot'.
 */
export class BotDriver {
  private client = new BotClient();
  private off: Unsub;
  private pendingFor = -1;
  private drawHandledFor = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private sync: MatchSync) {
    this.off = sync.on((e) => {
      if (e.type === 'update' || e.type === 'start') this.consider(e.doc);
    });
    if (sync.doc) this.consider(sync.doc);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.client.cancel();
    this.off();
  }

  private botSide(d: GameDoc): Side | null {
    return d.players.X.bot ? 'X' : d.players.O.bot ? 'O' : null;
  }

  private consider(d: GameDoc) {
    if (this.disposed || d.type !== 'bot' || d.result) return;
    const bot = this.botSide(d);
    if (!bot) return;

    // Human offered a draw: think a moment, then answer like a player would.
    if (d.drawOffer && d.drawOffer !== bot) {
      const key = `${d.seq}:${d.n}`;
      if (this.drawHandledFor !== key) {
        this.drawHandledFor = key;
        setTimeout(() => {
          if (this.disposed || this.sync.doc?.drawOffer !== d.drawOffer) return;
          const score = evaluate(this.sync.game.moves, bot);
          void this.sync.botAnswerDraw(bot, d.n >= 16 && score <= 500);
        }, 1500 + Math.random() * 2000);
      }
    }

    if (d.turn !== bot || this.pendingFor === d.n) return;
    this.pendingFor = d.n;
    void this.play(d, bot);
  }

  private async play(d: GameDoc, bot: Side) {
    const n = d.n;
    const human = other(bot);
    const moves = this.sync.game.moves.map((m) => ({ ...m }));

    // Hopeless (human has two winning points)? Sometimes resign like a person.
    const b = new SearchBoard(moves);
    const humanWins = b.candidates().filter((c) => b.wouldWin(c.x, c.y, human)).length;
    const botWins = b.candidates().filter((c) => b.wouldWin(c.x, c.y, bot)).length;
    if (humanWins >= 2 && botWins === 0 && Math.random() < 0.5) {
      this.timer = setTimeout(() => void this.sync.botResign(bot), 2500 + Math.random() * 3000);
      return;
    }

    const style = botStyle(d.players[bot].rating);
    const t0 = performance.now();
    const reply = await this.client.ask({ moves, player: bot, level: style.level, timeMs: style.timeMs, seed: (Math.random() * 2 ** 31) | 0 });
    if (!reply || this.disposed) return;
    const forced = reply.reason === 'win' || reply.reason === 'block';
    const delay = Math.max(0, thinkTime(n, forced) - (performance.now() - t0));
    this.timer = setTimeout(() => {
      const cur = this.sync.doc;
      if (this.disposed || !cur || cur.result || cur.n !== n || cur.turn !== bot) return;
      void this.sync.moveAs(bot, reply.move.x, reply.move.y);
    }, delay);
  }
}

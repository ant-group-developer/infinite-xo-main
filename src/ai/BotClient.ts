import { chooseMove, type BotReply, type BotRequest } from './bot';

/**
 * Runs the bot in a Web Worker so the UI never freezes.
 * `cancel()` drops any in-flight answer (used on undo / new game) and restarts
 * the worker so a long search does not delay the next request.
 */
export class BotClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { req: BotRequest; fn: (r: BotReply | null) => void }>();

  constructor() {
    this.spawn();
  }

  private spawn() {
    try {
      const w = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; reply: BotReply }>) => {
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        p?.fn(e.data.reply);
      };
      w.onerror = () => {
        // Fall back to the main thread for this and later requests.
        w.terminate();
        if (this.worker === w) this.worker = null;
        const left = [...this.pending.values()];
        this.pending.clear();
        for (const p of left) p.fn(chooseMove(p.req));
      };
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  /** Resolves with null if cancelled. */
  ask(req: BotRequest): Promise<BotReply | null> {
    const id = ++this.seq;
    if (!this.worker) {
      return new Promise((res) => setTimeout(() => res(id === this.seq ? chooseMove(req) : null), 0));
    }
    return new Promise((res) => {
      this.pending.set(id, { req, fn: (r) => res(id === this.seq ? r : null) });
      this.worker!.postMessage({ id, req });
    });
  }

  cancel() {
    this.seq++;
    if (this.pending.size && this.worker) {
      this.worker.terminate();
      this.spawn();
    }
    for (const p of this.pending.values()) p.fn(null);
    this.pending.clear();
  }
}

import { pickPersona } from '../ai/persona';
import type { Backend } from './backend';
import { SERVER_TS, type Unsub } from './db';
import { createBotMatch, firstMover, startMatch, type PlayerInfo } from './match';
import { createRoom, deleteRoom, type MemberInfo } from './rooms';
import type { Room } from './schema';

/**
 * Client-side matchmaking (Spark plan: no server code).
 *
 * Everyone searching sits in /queue/{uid}. The NEWER of two compatible
 * players initiates: it locks its own ticket, claims the older ticket with a
 * transaction (so two people can never grab the same opponent), creates a
 * ranked room and waits for the opponent to join; then the game starts.
 * Nobody suitable after a short random delay → a bot persona that looks like
 * a regular player (configurable in /config/matchmaking).
 */

export interface QueueEntry {
  rating: number;
  name: string;
  avatar: number;
  country: string;
  joinedAt: number;
  state: 'waiting' | 'locked' | 'matched';
  by?: string;
  match?: string;
}

export interface MatchmakingConfig {
  botEnabled: boolean;
  botAfterMinMs: number;
  botAfterMaxMs: number;
}

export const DEFAULT_MM: MatchmakingConfig = { botEnabled: true, botAfterMinMs: 4000, botAfterMaxMs: 12000 };

/** Allowed rating gap after waiting `ms`: 100, +50 every 5 s, ±400 max, anyone after 45 s. */
export function windowFor(ms: number): number {
  if (ms >= 45_000) return Infinity;
  return Math.min(400, 100 + 50 * Math.floor(ms / 5000));
}

export type MmEvent =
  | { type: 'searching'; elapsed: number; window: number }
  | { type: 'matched'; roomId: string; vsBot: boolean; host: boolean }
  | { type: 'error'; error: unknown };

const OPPONENT_JOIN_TIMEOUT = 12_000;
const RECENT_BOTS_KEY = 'infinite-xo:recent-bots';

export class Matchmaker {
  private subs = new Set<(e: MmEvent) => void>();
  private offs: Unsub[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;
  private joinedAt = 0;
  private botAt = Infinity;
  private cfg: MatchmakingConfig = DEFAULT_MM;
  private busy = false;
  done = false;

  constructor(
    private be: Backend,
    readonly uid: string,
    private me: MemberInfo,
    private opts: { tickMs?: number; rnd?: () => number } = {},
  ) {}

  on(fn: (e: MmEvent) => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private emit(e: MmEvent) {
    for (const fn of [...this.subs]) fn(e);
  }

  private get rnd() {
    return this.opts.rnd ?? Math.random;
  }

  async start() {
    const { db } = this.be;
    this.cfg = { ...DEFAULT_MM, ...((await db.get<Partial<MatchmakingConfig>>('config/matchmaking')) ?? {}) };
    this.startedAt = db.serverNow();
    const wait = this.cfg.botAfterMinMs + this.rnd() * (this.cfg.botAfterMaxMs - this.cfg.botAfterMinMs);
    this.botAt = this.startedAt + wait;

    const path = `queue/${this.uid}`;
    await db.onDisconnect(path).remove();
    await db.set(path, {
      rating: this.me.rating,
      name: this.me.name,
      avatar: this.me.avatar,
      country: this.me.country,
      joinedAt: SERVER_TS,
      state: 'waiting',
    } satisfies QueueEntry);
    this.joinedAt = (await db.get<number>(`${path}/joinedAt`)) ?? this.startedAt;

    // Someone else may match us.
    this.offs.push(
      db.onValue<QueueEntry>(path, (e) => {
        if (this.done || !e) return;
        if (e.state === 'matched' && e.by !== this.uid && e.match) void this.matchedByOther(e.match);
      }),
    );
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 1500);
    void this.tick();
  }

  async cancel() {
    if (this.done) return;
    this.stop();
    await this.leaveQueue();
  }

  private stop() {
    this.done = true;
    clearInterval(this.timer);
    for (const off of this.offs) off();
    this.offs = [];
  }

  private async leaveQueue() {
    const path = `queue/${this.uid}`;
    await this.be.db.onDisconnect(path).cancel();
    await this.be.db.remove(path);
  }

  private async matchedByOther(roomId: string) {
    if (this.done) return;
    this.stop();
    await this.leaveQueue();
    this.emit({ type: 'matched', roomId, vsBot: false, host: false });
  }

  private async tick() {
    if (this.done || this.busy) return;
    this.busy = true;
    try {
      const { db } = this.be;
      const now = db.serverNow();
      const elapsed = now - this.startedAt;
      this.emit({ type: 'searching', elapsed, window: windowFor(elapsed) });

      const queue = (await db.get<Record<string, QueueEntry>>('queue')) ?? {};
      const mine = queue[this.uid];
      if (!mine || mine.state !== 'waiting') return;
      const candidates = Object.entries(queue)
        .filter(([u, e]) => u !== this.uid && e.state === 'waiting')
        // the newer ticket initiates (tie → larger uid) so two players never claim each other at once
        .filter(([u, e]) => e.joinedAt < this.joinedAt || (e.joinedAt === this.joinedAt && u < this.uid))
        .filter(([, e]) => {
          const gap = Math.abs(e.rating - this.me.rating);
          return gap <= windowFor(elapsed) && gap <= windowFor(now - e.joinedAt);
        })
        .sort((a, b) => Math.abs(a[1].rating - this.me.rating) - Math.abs(b[1].rating - this.me.rating) || a[1].joinedAt - b[1].joinedAt);

      for (const [other, entry] of candidates) {
        if (this.done) return;
        if (await this.tryPair(other, entry)) return;
      }
      if (this.cfg.botEnabled && now >= this.botAt && !this.done) await this.playBot();
    } catch (e) {
      this.emit({ type: 'error', error: e });
    } finally {
      this.busy = false;
    }
  }

  private async tryPair(other: string, entry: QueueEntry): Promise<boolean> {
    const { db } = this.be;
    // 1. lock my own ticket
    const lock = await db.transaction<QueueEntry>(`queue/${this.uid}`, (cur) =>
      cur && cur.state === 'waiting' ? { ...cur, state: 'locked', by: this.uid } : undefined,
    );
    if (!lock.committed) return false;

    // 2. create the room (I host), 3. claim the opponent's ticket for it
    const roomId = await createRoom(this.be, this.uid, this.me, { name: 'Ranked', visibility: 'private', type: 'ranked' });
    const claim = await db.transaction<QueueEntry>(`queue/${other}`, (cur) =>
      cur && cur.state === 'waiting' ? { ...cur, state: 'matched', by: this.uid, match: roomId } : undefined,
    );
    if (!claim.committed) {
      await deleteRoom(this.be, roomId);
      await db.transaction<QueueEntry>(`queue/${this.uid}`, (cur) => (cur ? { ...cur, state: 'waiting', by: undefined } : undefined));
      return false;
    }

    // Seats: lower rating plays X.
    const meX = firstMover(this.me.rating, entry.rating, this.rnd) === 'a';
    await db.update({
      [`rooms/${roomId}/slots/X`]: meX ? this.uid : other,
      [`rooms/${roomId}/slots/O`]: meX ? other : this.uid,
    });
    this.stop();
    await this.leaveQueue();

    // Wait for the opponent to arrive, then start; otherwise give up and search again.
    const joined = await waitFor<Room>(this.be, `rooms/${roomId}`, (r) => !!r?.members?.[other], OPPONENT_JOIN_TIMEOUT);
    if (!joined) {
      await deleteRoom(this.be, roomId);
      this.done = false;
      await this.start();
      return true;
    }
    await startMatch(this.be, roomId, joined);
    this.emit({ type: 'matched', roomId, vsBot: false, host: true });
    return true;
  }

  private async playBot() {
    const recent = loadRecent();
    const { persona, rating } = pickPersona(this.me.rating, recent, this.rnd);
    const me: PlayerInfo = { uid: this.uid, ...this.me };
    const bot: PlayerInfo = { uid: persona.id, name: persona.name, avatar: persona.avatar, country: persona.country, rating };
    this.stop();
    await this.leaveQueue();
    const roomId = await createBotMatch(this.be, this.uid, me, bot);
    saveRecent([persona.id, ...recent].slice(0, 10));
    this.emit({ type: 'matched', roomId, vsBot: true, host: true });
  }
}

function waitFor<T>(be: Backend, path: string, ok: (v: T | null) => boolean, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => off());
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), ms);
    const off = be.db.onValue<T>(path, (v) => {
      if (ok(v)) finish(v);
    });
  });
}

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_BOTS_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_BOTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

import { Game } from '../core/game';
import { other } from '../core/types';
import type { Backend } from './backend';
import { SERVER_TS, makeCode, type Unsub } from './db';
import type { Room, RoomMember, RoomType, Side } from './schema';

/** 2 minutes per move; running out loses the game. */
export const TURN_MS = 120_000;
/** Extra time before a timeout may be claimed (clock skew / latency). */
export const TIMEOUT_GRACE_MS = 1_500;

export type ResultReason = 'five' | 'timeout' | 'resign' | 'draw' | 'abandon';

export interface ResultDoc {
  /** absent / null = draw (the database does not store nulls) */
  winner?: Side | null;
  reason: ResultReason;
  /** winning line for 'five' (lets rules re-check it) */
  line?: { sx: number; sy: number; dx: number; dy: number; len: number };
  at: number;
}

export interface PlayerInfo {
  uid: string;
  name: string;
  avatar: number;
  country: string;
  rating: number;
  bot?: boolean;
}

export interface MoveDoc {
  x: number;
  y: number;
  p: Side;
  t: number;
}

export interface GameDoc {
  seq: number;
  type: RoomType;
  players: Record<Side, PlayerInfo>;
  startedAt: number;
  n: number;
  turn: Side;
  turnStart: number;
  moves?: Record<string, MoveDoc>;
  board?: Record<string, Side>;
  drawOffer?: Side | null;
  result?: ResultDoc | null;
}

export const cellKey = (x: number, y: number) => `${x}_${y}`;

const info = (uid: string, m: RoomMember): PlayerInfo => ({
  uid,
  name: m.name,
  avatar: m.avatar,
  country: m.country,
  rating: m.rating,
});

/** Host: start a game with the two seated players. */
export async function startMatch(be: Backend, roomId: string, room: Room): Promise<void> {
  const X = room.slots?.X;
  const O = room.slots?.O;
  const mx = X && room.members?.[X];
  const mo = O && room.members?.[O];
  if (!X || !O || !mx || !mo) throw new Error('need two seated players');
  const prevSeq = (await be.db.get<number>(`games/${roomId}/seq`)) ?? 0;
  const doc: GameDoc = {
    seq: prevSeq + 1,
    type: room.meta.type,
    players: { X: info(X, mx), O: info(O, mo) },
    startedAt: SERVER_TS,
    n: 0,
    turn: 'X',
    turnStart: SERVER_TS,
  };
  await be.db.update({
    [`games/${roomId}`]: doc,
    [`rooms/${roomId}/meta/status`]: 'playing',
    [`rooms/${roomId}/meta/lastActive`]: SERVER_TS,
    [`rooms/${roomId}/ready/X`]: null,
    [`rooms/${roomId}/ready/O`]: null,
  });
}

/** Lower rating plays X (moves first); equal ratings → random. */
export function firstMover(a: number, b: number, rnd = Math.random): 'a' | 'b' {
  if (a !== b) return a < b ? 'a' : 'b';
  return rnd() < 0.5 ? 'a' : 'b';
}

/**
 * Matchmaking fallback: a private 'bot' room where the persona plays the
 * other side. Room, seats and the game are created in one atomic update.
 */
export async function createBotMatch(
  be: Backend,
  uid: string,
  me: PlayerInfo,
  bot: PlayerInfo,
): Promise<string> {
  const { db } = be;
  const id = db.pushKey('rooms');
  let code = '';
  for (let i = 0; i < 8 && !code; i++) {
    const c = makeCode();
    const tx = await db.transaction<string>(`roomCodes/${c}`, (cur) => (cur ? undefined : id));
    if (tx.committed) code = c;
  }
  const meFirst = firstMover(me.rating, bot.rating) === 'a';
  const players: Record<Side, PlayerInfo> = meFirst ? { X: me, O: { ...bot, bot: true } } : { X: { ...bot, bot: true }, O: me };
  await db.update({
    [`rooms/${id}/meta`]: {
      hostUid: uid,
      name: 'Ranked',
      visibility: 'private',
      code,
      type: 'bot',
      createdAt: SERVER_TS,
      lastActive: SERVER_TS,
      status: 'playing',
    },
    [`rooms/${id}/members/${uid}`]: { name: me.name, avatar: me.avatar, country: me.country, rating: me.rating, joinedAt: SERVER_TS },
    [`rooms/${id}/slots/X`]: players.X.uid,
    [`rooms/${id}/slots/O`]: players.O.uid,
    [`games/${id}`]: {
      seq: 1,
      type: 'bot',
      players,
      startedAt: SERVER_TS,
      n: 0,
      turn: 'X',
      turnStart: SERVER_TS,
    } satisfies GameDoc,
  });
  return id;
}

/** A seated player leaving mid-game loses (called before leaving the room). */
export async function resignIfPlaying(be: Backend, roomId: string, uid: string): Promise<boolean> {
  const d = await be.db.get<GameDoc>(`games/${roomId}`);
  if (!d || d.result) return false;
  const side: Side | null = d.players.X.uid === uid ? 'X' : d.players.O.uid === uid ? 'O' : null;
  if (!side) return false;
  const tx = await be.db.transaction<ResultDoc>(`games/${roomId}/result`, (cur) =>
    cur ? undefined : ({ winner: other(side), reason: 'abandon', at: SERVER_TS } as ResultDoc),
  );
  return tx.committed;
}

export type MatchEvent =
  | { type: 'start'; doc: GameDoc }
  | { type: 'update'; doc: GameDoc }
  | { type: 'result'; result: ResultDoc; doc: GameDoc }
  | { type: 'draw-offer'; from: Side }
  | { type: 'draw-declined' }
  | { type: 'gone' };

export type MoveError = 'not-player' | 'not-your-turn' | 'occupied' | 'over' | 'no-game';

/**
 * Mirrors /games/{roomId} into a local core `Game` (so the existing renderer,
 * HUD, sounds and effects work unchanged) and writes this player's actions.
 */
export class MatchSync {
  doc: GameDoc | null = null;
  private subs = new Set<(e: MatchEvent) => void>();
  private off: Unsub | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private seq = -1;
  private claiming = false;

  constructor(
    private be: Backend,
    readonly roomId: string,
    readonly uid: string,
    readonly game: Game,
  ) {}

  on(fn: (e: MatchEvent) => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private emit(e: MatchEvent) {
    for (const fn of [...this.subs]) fn(e);
  }

  get mySide(): Side | null {
    const p = this.doc?.players;
    return p?.X.uid === this.uid ? 'X' : p?.O.uid === this.uid ? 'O' : null;
  }
  get isOver() {
    return !!this.doc?.result;
  }
  /** Server-time deadline for the current move, or null when not running. */
  get deadline(): number | null {
    const d = this.doc;
    if (!d || d.result || typeof d.turnStart !== 'number') return null;
    return d.turnStart + TURN_MS;
  }
  serverNow() {
    return this.be.db.serverNow();
  }

  start() {
    this.off = this.be.db.onValue<GameDoc>(`games/${this.roomId}`, (d) => this.onDoc(d));
    this.timer = setInterval(() => void this.checkTimeout(), 500);
  }

  dispose() {
    this.off?.();
    this.off = null;
    clearInterval(this.timer);
  }

  private onDoc(d: GameDoc | null) {
    if (!d) {
      this.doc = null;
      this.emit({ type: 'gone' });
      return;
    }
    const prev = this.doc;
    this.doc = d;
    const fresh = d.seq !== this.seq;
    if (fresh) {
      this.seq = d.seq;
      this.game.reset('X');
      this.emit({ type: 'start', doc: d });
    }
    this.applyMoves(d);

    if (d.drawOffer && d.drawOffer !== prev?.drawOffer) this.emit({ type: 'draw-offer', from: d.drawOffer });
    else if (!d.drawOffer && prev?.drawOffer && !d.result && !fresh) this.emit({ type: 'draw-declined' });

    if (d.result) {
      this.finishLocal(d.result);
      if (fresh || !prev?.result) this.emit({ type: 'result', result: d.result, doc: d });
    }
    this.emit({ type: 'update', doc: d });
  }

  /** Bring the local Game in line with the server's move list. */
  private applyMoves(d: GameDoc) {
    const g = this.game;
    const moves = d.moves ?? {};
    // Local optimistic move that the server did not accept → rebuild.
    for (let i = 0; i < Math.min(g.moves.length, d.n); i++) {
      const s = moves[i];
      const l = g.moves[i];
      if (!s || s.x !== l.x || s.y !== l.y) return this.rebuild(d);
    }
    if (g.moves.length > d.n && !this.pendingWrite) return this.rebuild(d);
    for (let i = g.moves.length; i < d.n; i++) {
      const m = moves[i];
      if (!m) break;
      const r = g.play(m.x, m.y, m.p);
      if (!r.ok) return this.rebuild(d);
    }
  }

  private rebuild(d: GameDoc) {
    const g = this.game;
    g.reset('X');
    const moves = d.moves ?? {};
    for (let i = 0; i < d.n; i++) {
      const m = moves[i];
      if (m) g.play(m.x, m.y, m.p);
    }
  }

  /** Apply a server-side ending (timeout / resign / draw) to the local game. */
  private finishLocal(r: ResultDoc) {
    const g = this.game;
    if (g.isOver) return;
    if (!r.winner) g.declareDraw();
    else g.resign(other(r.winner));
  }

  /* ------------------------------------------------------------ actions */

  private pendingWrite = false;

  async move(x: number, y: number): Promise<MoveError | null> {
    const side = this.mySide;
    if (!this.doc) return 'no-game';
    if (!side) return 'not-player';
    return this.writeMove(side, x, y);
  }

  /** The human host plays the bot's move in a 'bot' room. */
  async moveAs(side: Side, x: number, y: number): Promise<MoveError | null> {
    if (!this.doc?.players[side].bot) return 'not-player';
    return this.writeMove(side, x, y);
  }

  private async writeMove(side: Side, x: number, y: number): Promise<MoveError | null> {
    const d = this.doc;
    if (!d) return 'no-game';
    if (d.result || this.game.isOver) return 'over';
    if (d.turn !== side || this.game.turn !== side) return 'not-your-turn';
    if (this.game.board.has(x, y)) return 'occupied';

    const n = this.game.moves.length;
    const res = this.game.play(x, y, side); // optimistic
    if (!res.ok) return res.reason === 'occupied' ? 'occupied' : 'over';

    const base = `games/${this.roomId}`;
    const up: Record<string, unknown> = {
      [`${base}/moves/${n}`]: { x, y, p: side, t: SERVER_TS } satisfies MoveDoc,
      [`${base}/board/${cellKey(x, y)}`]: side,
      [`${base}/n`]: n + 1,
      [`${base}/turn`]: other(side),
      [`${base}/turnStart`]: SERVER_TS,
      [`${base}/drawOffer`]: null,
    };
    if (res.win) {
      const [dx, dy] = res.win.direction;
      up[`${base}/result`] = {
        winner: side,
        reason: 'five',
        line: { sx: res.win.start.x, sy: res.win.start.y, dx, dy, len: res.win.length },
        at: SERVER_TS,
      } satisfies ResultDoc;
    }
    this.pendingWrite = true;
    try {
      await this.be.db.update(up);
    } catch (e) {
      console.warn('[match] move rejected, resyncing', e);
      if (this.doc) this.rebuild(this.doc);
    } finally {
      this.pendingWrite = false;
    }
    return null;
  }

  private async writeResult(result: Omit<ResultDoc, 'at'>): Promise<boolean> {
    const tx = await this.be.db.transaction<ResultDoc>(`games/${this.roomId}/result`, (cur) =>
      cur ? undefined : ({ ...result, at: SERVER_TS } as ResultDoc),
    );
    return tx.committed;
  }

  async resign() {
    const side = this.mySide;
    if (!side || this.isOver) return false;
    return this.writeResult({ winner: other(side), reason: 'resign' });
  }

  async offerDraw() {
    const side = this.mySide;
    if (!side || this.isOver || this.doc?.drawOffer) return false;
    await this.be.db.set(`games/${this.roomId}/drawOffer`, side);
    return true;
  }

  /** Bot side resigns (bot rooms only). */
  async botResign(botSide: Side) {
    if (!this.doc?.players[botSide].bot || this.isOver) return false;
    return this.writeResult({ winner: other(botSide), reason: 'resign' });
  }

  /** Bot answers the human's draw offer (bot rooms only). */
  async botAnswerDraw(botSide: Side, accept: boolean) {
    const offer = this.doc?.drawOffer;
    if (!this.doc?.players[botSide].bot || !offer || offer === botSide || this.isOver) return false;
    if (accept) return this.writeResult({ winner: null, reason: 'draw' });
    await this.be.db.set(`games/${this.roomId}/drawOffer`, null);
    return true;
  }

  async answerDraw(accept: boolean) {
    const side = this.mySide;
    const offer = this.doc?.drawOffer;
    if (!side || !offer || offer === side || this.isOver) return false;
    if (accept) return this.writeResult({ winner: null, reason: 'draw' });
    await this.be.db.set(`games/${this.roomId}/drawOffer`, null);
    return true;
  }

  /** The player to move ran out of time: anyone watching may claim it. */
  private async checkTimeout() {
    const dl = this.deadline;
    if (dl === null || this.claiming) return;
    if (this.serverNow() < dl + TIMEOUT_GRACE_MS) return;
    this.claiming = true;
    try {
      await this.writeResult({ winner: other(this.doc!.turn), reason: 'timeout' });
    } catch (e) {
      console.warn('[match] timeout claim failed', e);
    } finally {
      this.claiming = false;
    }
  }
}

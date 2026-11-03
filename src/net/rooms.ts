import type { Backend } from './backend';
import { SERVER_TS, makeCode, type Unsub } from './db';
import { cleanText } from './filter';
import {
  MAX_MEMBERS,
  ROOM_STALE_MS,
  type Room,
  type RoomIndexEntry,
  type RoomMember,
  type RoomMeta,
  type RoomType,
  type Side,
} from './schema';

export type RoomErrorCode = 'not-found' | 'kicked' | 'full' | 'slot-taken' | 'not-host' | 'not-waiting' | 'bad-name';

export class RoomError extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
  }
}

export type MemberInfo = Omit<RoomMember, 'joinedAt'>;

const SIDES: Side[] = ['X', 'O'];

/* ------------------------------------------------------------- lobby ops */

export async function createRoom(
  be: Backend,
  uid: string,
  me: MemberInfo,
  opts: { name: string; visibility: 'public' | 'private'; type?: RoomType },
): Promise<string> {
  const name = cleanText(opts.name.trim()).slice(0, 24);
  if (name.length < 1) throw new RoomError('bad-name');
  const { db } = be;
  const id = db.pushKey('rooms');

  // Reserve a unique 6-char code.
  let code = '';
  for (let i = 0; i < 8 && !code; i++) {
    const c = makeCode();
    const tx = await db.transaction<string>(`roomCodes/${c}`, (cur) => (cur ? undefined : id));
    if (tx.committed) code = c;
  }
  if (!code) throw new Error('could not allocate a room code');

  const meta: RoomMeta = {
    hostUid: uid,
    name,
    visibility: opts.visibility,
    code,
    type: opts.type ?? 'casual',
    createdAt: SERVER_TS,
    lastActive: SERVER_TS,
    status: 'waiting',
  };
  const up: Record<string, unknown> = {
    [`rooms/${id}/meta`]: meta,
    [`rooms/${id}/members/${uid}`]: { ...me, joinedAt: SERVER_TS },
  };
  if (opts.visibility === 'public') {
    up[`roomIndex/${id}`] = {
      name,
      hostName: me.name,
      players: 0,
      spectators: 1,
      status: 'waiting',
      lastActive: SERVER_TS,
    } satisfies RoomIndexEntry;
  }
  await db.update(up);
  return id;
}

export async function findRoomByCode(be: Backend, code: string): Promise<string | null> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(c)) return null;
  return be.db.get<string>(`roomCodes/${c}`);
}

/** Public rooms for the lobby; quietly deletes stale ones it finds. */
export async function listPublicRooms(be: Backend): Promise<{ id: string; entry: RoomIndexEntry }[]> {
  const rows = await be.db.topByChild<RoomIndexEntry>('roomIndex', 'lastActive', 60);
  const now = be.db.serverNow();
  const live: { id: string; entry: RoomIndexEntry }[] = [];
  for (const r of rows) {
    if (now - r.value.lastActive > ROOM_STALE_MS) void deleteRoom(be, r.key).catch(() => {});
    else live.push({ id: r.key, entry: r.value });
  }
  const rank = (s: RoomIndexEntry['status']) => (s === 'waiting' ? 0 : s === 'playing' ? 1 : 2);
  return live.sort((a, b) => rank(a.entry.status) - rank(b.entry.status) || b.entry.lastActive - a.entry.lastActive);
}

/** Remove every node that belongs to a room. */
export async function deleteRoom(be: Backend, id: string) {
  const code = await be.db.get<string>(`rooms/${id}/meta/code`);
  const up: Record<string, unknown> = {
    [`rooms/${id}`]: null,
    [`roomIndex/${id}`]: null,
    [`roomChat/${id}`]: null,
    [`games/${id}`]: null,
  };
  if (code) up[`roomCodes/${code}`] = null;
  await be.db.update(up);
}

/* ---------------------------------------------------------- RoomSession */

export type RoomEvent =
  | { type: 'change'; room: Room }
  | { type: 'kicked' }
  | { type: 'closed' }
  | { type: 'joined'; uid: string; member: RoomMember }
  | { type: 'left'; uid: string; member: RoomMember };

/**
 * A player's presence inside one room. Also performs the "host duties" the
 * server would normally do (we run on the Spark plan without Cloud Functions):
 * lobby index upkeep, freeing slots of players who vanished, host hand-over.
 */
export class RoomSession {
  room: Room | null = null;
  private subs = new Set<(e: RoomEvent) => void>();
  private offs: Unsub[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastIndex = '';
  private ended = false;
  /** Result of the current game (watched so the host can close the match). */
  private gameResult: unknown = null;

  constructor(
    private be: Backend,
    readonly uid: string,
    readonly id: string,
    private me: MemberInfo,
  ) {}

  on(fn: (e: RoomEvent) => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private emit(e: RoomEvent) {
    for (const fn of [...this.subs]) fn(e);
  }

  get meta() {
    return this.room?.meta ?? null;
  }
  get isHost() {
    return this.room?.meta.hostUid === this.uid;
  }
  get members(): Record<string, RoomMember> {
    return this.room?.members ?? {};
  }
  get mySide(): Side | null {
    const s = this.room?.slots;
    return s?.X === this.uid ? 'X' : s?.O === this.uid ? 'O' : null;
  }
  sideOf(uid: string): Side | null {
    const s = this.room?.slots;
    return s?.X === uid ? 'X' : s?.O === uid ? 'O' : null;
  }
  /** Members that are not sitting in a player slot. */
  get spectators(): [string, RoomMember][] {
    return Object.entries(this.members)
      .filter(([u]) => !this.sideOf(u))
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  }

  async join() {
    const { db } = this.be;
    const room = await db.get<Room>(`rooms/${this.id}`);
    if (!room?.meta) throw new RoomError('not-found');
    if (room.kicked?.[this.uid]) throw new RoomError('kicked');
    const count = Object.keys(room.members ?? {}).length;
    if (!room.members?.[this.uid] && count >= MAX_MEMBERS) throw new RoomError('full');

    // (Re)register membership on every (re)connect.
    this.offs.push(
      db.onConnected((connected) => {
        if (connected && !this.ended) void this.registerMember();
      }),
    );
    await this.registerMember();

    let prevMembers: Record<string, RoomMember> | null = null;
    this.offs.push(
      db.onValue<Room>(`rooms/${this.id}`, (r) => {
        if (this.ended) return;
        if (!r?.meta) {
          this.room = null;
          this.stop();
          this.emit({ type: 'closed' });
          return;
        }
        if (r.kicked?.[this.uid]) {
          this.room = r;
          this.stop();
          this.emit({ type: 'kicked' });
          return;
        }
        const members = r.members ?? {};
        if (prevMembers) {
          for (const [u, m] of Object.entries(members)) if (!prevMembers[u]) this.emit({ type: 'joined', uid: u, member: m });
          for (const [u, m] of Object.entries(prevMembers)) if (!members[u]) this.emit({ type: 'left', uid: u, member: m });
        }
        prevMembers = members;
        this.room = r;
        this.emit({ type: 'change', room: r });
        void this.duties();
      }),
    );
    this.offs.push(
      db.onValue(`games/${this.id}/result`, (res) => {
        this.gameResult = res;
        void this.duties();
      }),
    );
    this.heartbeat = setInterval(() => void this.touch(), 60_000);
  }

  private async registerMember() {
    const { db } = this.be;
    const path = `rooms/${this.id}/members/${this.uid}`;
    await db.onDisconnect(path).remove();
    const existing = await db.get<RoomMember>(path);
    await db.set(path, { ...this.me, joinedAt: existing?.joinedAt ?? SERVER_TS });
  }

  /** Update my displayed info (name/avatar/rating changed). */
  async updateMe(me: MemberInfo) {
    this.me = me;
    if (!this.ended) await this.be.db.update({ [`rooms/${this.id}/members/${this.uid}`]: { ...me, joinedAt: this.members[this.uid]?.joinedAt ?? SERVER_TS } });
  }

  /* ----- slots */

  async claimSlot(side: Side) {
    const r = this.room;
    if (!r) return;
    if (r.meta.status === 'playing') throw new RoomError('not-waiting');
    const { db } = this.be;
    const tx = await db.transaction<string>(`rooms/${this.id}/slots/${side}`, (cur) =>
      cur && cur !== this.uid ? undefined : this.uid,
    );
    if (!tx.committed) throw new RoomError('slot-taken');
    const other: Side = side === 'X' ? 'O' : 'X';
    const up: Record<string, unknown> = { [`rooms/${this.id}/ready/${side}`]: null };
    if (r.slots?.[other] === this.uid) {
      up[`rooms/${this.id}/slots/${other}`] = null;
      up[`rooms/${this.id}/ready/${other}`] = null;
    }
    // Only the host may touch meta (rules); it resets 'finished' rooms in its duties.
    await db.update(up);
  }

  /** Become a spectator. */
  async leaveSlot() {
    const side = this.mySide;
    if (!side || this.room?.meta.status === 'playing') return;
    await this.be.db.update({ [`rooms/${this.id}/slots/${side}`]: null, [`rooms/${this.id}/ready/${side}`]: null });
  }

  async setReady(ready: boolean) {
    const side = this.mySide;
    if (!side) return;
    await this.be.db.set(`rooms/${this.id}/ready/${side}`, ready || null);
  }

  /* ----- host actions */

  /** Swap who plays X and O (between games). */
  async swapSides() {
    const r = this.room;
    if (!this.isHost) throw new RoomError('not-host');
    if (!r || r.meta.status === 'playing' || !r.slots?.X || !r.slots?.O) return;
    await this.be.db.update({
      [`rooms/${this.id}/slots/X`]: r.slots.O,
      [`rooms/${this.id}/slots/O`]: r.slots.X,
      [`rooms/${this.id}/ready/X`]: null,
      [`rooms/${this.id}/ready/O`]: null,
    });
  }

  async kick(target: string) {
    if (!this.isHost) throw new RoomError('not-host');
    if (target === this.uid) return;
    const side = this.sideOf(target);
    const up: Record<string, unknown> = {
      [`rooms/${this.id}/kicked/${target}`]: true,
      [`rooms/${this.id}/members/${target}`]: null,
    };
    if (side && this.room?.meta.status !== 'playing') {
      up[`rooms/${this.id}/slots/${side}`] = null;
      up[`rooms/${this.id}/ready/${side}`] = null;
    }
    await this.be.db.update(up);
  }

  async rename(name: string) {
    if (!this.isHost) throw new RoomError('not-host');
    const n = cleanText(name.trim()).slice(0, 24);
    if (!n) throw new RoomError('bad-name');
    const up: Record<string, unknown> = { [`rooms/${this.id}/meta/name`]: n };
    if (this.room?.meta.visibility === 'public') up[`roomIndex/${this.id}/name`] = n;
    await this.be.db.update(up);
  }

  /* ----- leaving */

  async leave() {
    if (this.ended) return;
    const r = this.room;
    const { db } = this.be;
    this.stop();
    await db.onDisconnect(`rooms/${this.id}/members/${this.uid}`).cancel();
    if (!r) return;
    const others = Object.entries(r.members ?? {})
      .filter(([u]) => u !== this.uid)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (!others.length) {
      await deleteRoom(this.be, this.id);
      return;
    }
    const up: Record<string, unknown> = { [`rooms/${this.id}/members/${this.uid}`]: null };
    const side = this.sideOf(this.uid);
    if (side && r.meta.status !== 'playing') {
      up[`rooms/${this.id}/slots/${side}`] = null;
      up[`rooms/${this.id}/ready/${side}`] = null;
    }
    if (r.meta.hostUid === this.uid) up[`rooms/${this.id}/meta/hostUid`] = others[0][0];
    await db.update(up);
  }

  private stop() {
    this.ended = true;
    clearInterval(this.heartbeat);
    for (const off of this.offs) off();
    this.offs = [];
  }

  /* ----- duties normally done by a server */

  private async duties() {
    const r = this.room;
    if (!r || this.ended) return;
    const members = r.members ?? {};
    const { db } = this.be;

    // Host vanished (tab closed): the earliest remaining member takes over.
    if (!members[r.meta.hostUid]) {
      const first = Object.entries(members).sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
      if (first?.[0] === this.uid) {
        const oldHost = r.meta.hostUid;
        await db.transaction<string>(`rooms/${this.id}/meta/hostUid`, (cur) => (cur === oldHost ? this.uid : undefined));
      }
      return;
    }
    if (!this.isHost) return;

    if (r.meta.status === 'playing' && this.gameResult) {
      await db.update({ [`rooms/${this.id}/meta/status`]: 'finished', [`rooms/${this.id}/meta/lastActive`]: SERVER_TS });
      return;
    }
    if (r.meta.status === 'finished' && !(r.slots?.X && r.slots?.O)) {
      await db.update({ [`rooms/${this.id}/meta/status`]: 'waiting', [`rooms/${this.id}/meta/lastActive`]: SERVER_TS });
    }

    // Free slots whose owner left the room (only between games).
    if (r.meta.status !== 'playing') {
      const up: Record<string, unknown> = {};
      for (const s of SIDES) {
        const u = r.slots?.[s];
        if (u && !members[u]) {
          up[`rooms/${this.id}/slots/${s}`] = null;
          up[`rooms/${this.id}/ready/${s}`] = null;
        }
      }
      if (Object.keys(up).length) await db.update(up);
    }

    // Keep the lobby index in sync.
    if (r.meta.visibility === 'public') {
      const players = SIDES.filter((s) => r.slots?.[s]).length;
      const entry = {
        name: r.meta.name,
        hostName: members[r.meta.hostUid]?.name ?? '?',
        players,
        spectators: Object.keys(members).length - players,
        status: r.meta.status,
      };
      const sig = JSON.stringify(entry);
      if (sig !== this.lastIndex) {
        this.lastIndex = sig;
        await db.update({ [`roomIndex/${this.id}`]: { ...entry, lastActive: SERVER_TS } });
      }
    }
  }

  /** Host heartbeat so the room is not considered stale. */
  private async touch() {
    if (!this.isHost || this.ended) return;
    const up: Record<string, unknown> = { [`rooms/${this.id}/meta/lastActive`]: SERVER_TS };
    if (this.room?.meta.visibility === 'public') up[`roomIndex/${this.id}/lastActive`] = SERVER_TS;
    await this.be.db.update(up);
  }
}

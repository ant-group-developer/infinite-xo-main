import type { FirebaseApp } from 'firebase/app';
import {
  equalTo as fbEqualTo,
  get,
  getDatabase,
  goOffline,
  goOnline,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
} from 'firebase/database';
import { SERVER_TS, type Db, type DisconnectOps, type TxResult, type Unsub } from '../db';

/** Replace our SERVER_TS placeholder with the SDK's sentinel. */
function sv(v: unknown): unknown {
  if (v === SERVER_TS) return serverTimestamp();
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (o['.sv'] === 'timestamp' && Object.keys(o).length === 1) return serverTimestamp();
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = sv(x);
  return out;
}

export class FirebaseDb implements Db {
  readonly kind = 'firebase' as const;
  private db: Database;
  private offset = 0;

  constructor(app: FirebaseApp, url?: string) {
    this.db = getDatabase(app, url);
    onValue(ref(this.db, '.info/serverTimeOffset'), (s) => {
      this.offset = Number(s.val()) || 0;
    });
  }

  private r(path: string) {
    return ref(this.db, path);
  }

  async get<T>(path: string): Promise<T | null> {
    const s = await get(this.r(path));
    return (s.exists() ? s.val() : null) as T | null;
  }

  set(path: string, value: unknown) {
    return set(this.r(path), sv(value));
  }

  update(values: Record<string, unknown>) {
    const v: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(values)) v[k] = sv(x);
    return update(ref(this.db), v);
  }

  remove(path: string) {
    return remove(this.r(path));
  }

  pushKey(path: string): string {
    return push(this.r(path)).key!;
  }

  async transaction<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TxResult<T>> {
    const res = await runTransaction(this.r(path), (cur: T | null) => {
      const next = fn(cur ?? null);
      return next === undefined ? undefined : (sv(next) as T | null);
    });
    return { committed: res.committed, value: (res.snapshot.val() ?? null) as T | null };
  }

  onValue<T>(path: string, cb: (v: T | null) => void): Unsub {
    return onValue(this.r(path), (s) => cb((s.exists() ? s.val() : null) as T | null));
  }

  onChildAdded<T>(path: string, cb: (k: string, v: T) => void, opts?: { limitToLast?: number }): Unsub {
    const q = opts?.limitToLast ? query(this.r(path), limitToLast(opts.limitToLast)) : this.r(path);
    return onChildAdded(q, (s) => cb(s.key!, s.val() as T));
  }

  async topByChild<T>(path: string, child: string, limit: number) {
    const s = await get(query(this.r(path), orderByChild(child), limitToLast(limit)));
    const out: { key: string; value: T }[] = [];
    s.forEach((c) => {
      out.push({ key: c.key!, value: c.val() as T });
    });
    return out.reverse();
  }

  async equalTo<T>(path: string, child: string, value: string | number | boolean) {
    const s = await get(query(this.r(path), orderByChild(child), fbEqualTo(value)));
    const out: { key: string; value: T }[] = [];
    s.forEach((c) => {
      out.push({ key: c.key!, value: c.val() as T });
    });
    return out;
  }

  onDisconnect(path: string): DisconnectOps {
    const od = onDisconnect(this.r(path));
    return {
      set: (v) => od.set(sv(v)),
      update: (v) => od.update(sv(v) as Record<string, unknown>),
      remove: () => od.remove(),
      cancel: () => od.cancel(),
    };
  }

  onConnected(cb: (c: boolean) => void): Unsub {
    return onValue(ref(this.db, '.info/connected'), (s) => cb(s.val() === true));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  goOnline() {
    goOnline(this.db);
  }
  goOffline() {
    goOffline(this.db);
  }
}

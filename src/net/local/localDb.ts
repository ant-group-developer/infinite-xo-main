import { makePushKey, type Db, type DisconnectOps, type TxResult, type Unsub } from '../db';
import { applyOps, casOk, clone, getAt, segments, type Cas, type Tree, type WriteOp } from './tree';

/**
 * The shared data behind one or more LocalDb clients.
 *  - MemoryStore: in-process (unit tests: several clients = several players)
 *  - SharedWorkerStore: one SharedWorker "server" for all browser tabs (dev)
 */
export interface LocalStore {
  /** Current tree (a mirror for remote stores). Treat as read-only. */
  read(): Tree;
  /** Apply writes atomically; resolves false if the CAS guard failed. */
  apply(ops: WriteOp[], cas?: Cas): Promise<boolean>;
  /** Notified after every change, whoever made it. */
  subscribe(fn: () => void): Unsub;
  now(): number;
}

export class MemoryStore implements LocalStore {
  private tree: Tree = {};
  private subs = new Set<() => void>();
  /** Tests can move the clock forward. */
  clockOffset = 0;

  read() {
    return this.tree;
  }
  async apply(ops: WriteOp[], cas?: Cas) {
    if (!casOk(this.tree, cas)) return false;
    this.tree = applyOps(this.tree, ops, this.now());
    for (const fn of [...this.subs]) fn();
    return true;
  }
  subscribe(fn: () => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  now() {
    return Date.now() + this.clockOffset;
  }
}

/** Talks to src/net/local/sharedStore.worker.ts; mirrors its tree locally. */
export class SharedWorkerStore implements LocalStore {
  private tree: Tree = {};
  private subs = new Set<() => void>();
  private port: MessagePort;
  private seq = 0;
  private pending = new Map<number, (ok: boolean) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;
  private static KEY = 'infinite-xo:localdb';

  constructor() {
    const worker = new SharedWorker(new URL('./sharedStore.worker.ts', import.meta.url), {
      type: 'module',
      name: 'infinite-xo-localdb',
    });
    this.port = worker.port;
    let resolveReady!: () => void;
    this.ready = new Promise((r) => (resolveReady = r));
    this.port.onmessage = (m: MessageEvent) => {
      const d = m.data;
      if (d.type === 'tree') {
        this.tree = d.tree;
        resolveReady();
        this.persist();
        for (const fn of [...this.subs]) fn();
      } else if (d.type === 'ack') {
        this.pending.get(d.id)?.(d.ok);
        this.pending.delete(d.id);
      }
    };
    this.port.start();
    let saved: Tree | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(SharedWorkerStore.KEY) || 'null');
    } catch {
      /* ignore */
    }
    this.port.postMessage({ type: 'hello', saved });
    window.addEventListener('pagehide', () => this.port.postMessage({ type: 'bye' }));
  }

  /** Keep a copy so the data survives when every tab is closed. */
  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SharedWorkerStore.KEY, JSON.stringify(this.tree));
      } catch {
        /* quota */
      }
    }, 300);
  }

  read() {
    return this.tree;
  }
  apply(ops: WriteOp[], cas?: Cas): Promise<boolean> {
    const id = ++this.seq;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.port.postMessage({ type: 'apply', id, ops, cas });
    });
  }
  subscribe(fn: () => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  now() {
    return Date.now();
  }
}

/* ------------------------------------------------------------- LocalDb */

interface ValueListener {
  path: string[];
  cb: (v: unknown) => void;
  last: string;
}
interface ChildListener {
  path: string[];
  cb: (k: string, v: unknown) => void;
  seen: Set<string>;
}

/** One client of a LocalStore. Same contract as FirebaseDb, no security rules. */
export class LocalDb implements Db {
  readonly kind = 'local' as const;
  private values = new Set<ValueListener>();
  private children = new Set<ChildListener>();
  private connListeners = new Set<(c: boolean) => void>();
  private disconnectOps = new Map<string, WriteOp[]>();
  private connected = true;
  private unsubStore: Unsub;
  private scheduled = false;

  constructor(private store: LocalStore) {
    this.unsubStore = store.subscribe(() => this.schedule());
  }

  /* ----- writes */

  async get<T>(path: string): Promise<T | null> {
    return clone(getAt(this.store.read(), segments(path))) as T | null;
  }

  async set(path: string, value: unknown) {
    await this.store.apply([{ path, value }]);
  }

  async update(values: Record<string, unknown>) {
    await this.store.apply(Object.entries(values).map(([path, value]) => ({ path, value })));
  }

  async remove(path: string) {
    await this.store.apply([{ path, value: null }]);
  }

  pushKey(_path?: string): string {
    return makePushKey(this.store.now());
  }

  /** Optimistic like Firebase: run fn on the latest value, compare-and-set, retry. */
  async transaction<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TxResult<T>> {
    const segs = segments(path);
    for (let attempt = 0; attempt < 25; attempt++) {
      const cur = clone(getAt(this.store.read(), segs)) as T | null;
      const next = fn(clone(cur));
      if (next === undefined) return { committed: false, value: cur };
      const ok = await this.store.apply([{ path, value: next }], { path, expect: JSON.stringify(cur) });
      if (ok) return { committed: true, value: clone(getAt(this.store.read(), segs)) as T | null };
    }
    throw new Error('transaction: too many retries');
  }

  /* ----- reads / listeners */

  onValue<T>(path: string, cb: (v: T | null) => void): Unsub {
    const l: ValueListener = { path: segments(path), cb: cb as (v: unknown) => void, last: '\u0000' };
    this.values.add(l);
    this.schedule();
    return () => this.values.delete(l);
  }

  onChildAdded<T>(path: string, cb: (k: string, v: T) => void, opts?: { limitToLast?: number }): Unsub {
    const segs = segments(path);
    const l: ChildListener = { path: segs, cb: cb as (k: string, v: unknown) => void, seen: new Set() };
    const existing = getAt(this.store.read(), segs);
    const keys = existing && typeof existing === 'object' ? Object.keys(existing).sort() : [];
    const skip = opts?.limitToLast ? Math.max(0, keys.length - opts.limitToLast) : 0;
    keys.slice(0, skip).forEach((k) => l.seen.add(k));
    this.children.add(l);
    this.schedule();
    return () => this.children.delete(l);
  }

  async topByChild<T>(path: string, child: string, limit: number) {
    const node = getAt(this.store.read(), segments(path)) as Record<string, Record<string, unknown>> | null;
    if (!node) return [];
    return Object.entries(node)
      .map(([key, value]) => ({ key, value: clone(value) as T }))
      .sort((a, b) => num((b.value as Record<string, unknown>)?.[child]) - num((a.value as Record<string, unknown>)?.[child]))
      .slice(0, limit);
  }

  async equalTo<T>(path: string, child: string, value: string | number | boolean) {
    const node = getAt(this.store.read(), segments(path)) as Record<string, Record<string, unknown>> | null;
    if (!node) return [];
    return Object.entries(node)
      .filter(([, v]) => v && v[child] === value)
      .map(([key, v]) => ({ key, value: clone(v) as T }));
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.dispatch();
    });
  }

  private dispatch() {
    if (!this.connected) return;
    const tree = this.store.read();
    for (const l of [...this.values]) {
      if (!this.values.has(l)) continue;
      const v = getAt(tree, l.path);
      const s = JSON.stringify(v);
      if (s === l.last) continue;
      l.last = s;
      try {
        l.cb(clone(v));
      } catch (e) {
        console.error('[localdb] listener failed', e);
      }
    }
    for (const l of [...this.children]) {
      if (!this.children.has(l)) continue;
      const node = getAt(tree, l.path) as Record<string, unknown> | null;
      if (!node || typeof node !== 'object') continue;
      for (const k of Object.keys(node).sort()) {
        if (l.seen.has(k)) continue;
        l.seen.add(k);
        try {
          l.cb(k, clone(node[k]));
        } catch (e) {
          console.error('[localdb] listener failed', e);
        }
      }
    }
  }

  /* ----- connection */

  onDisconnect(path: string): DisconnectOps {
    const key = segments(path).join('/');
    return {
      set: async (value) => void this.disconnectOps.set(key, [{ path: key, value }]),
      update: async (values) =>
        void this.disconnectOps.set(
          key,
          Object.entries(values).map(([k, v]) => ({ path: `${key}/${k}`, value: v })),
        ),
      remove: async () => void this.disconnectOps.set(key, [{ path: key, value: null }]),
      cancel: async () => void this.disconnectOps.delete(key),
    };
  }

  onConnected(cb: (c: boolean) => void): Unsub {
    this.connListeners.add(cb);
    queueMicrotask(() => cb(this.connected));
    return () => this.connListeners.delete(cb);
  }

  serverNow() {
    return this.store.now();
  }

  /** Runs registered onDisconnect operations, like the server would. */
  simulateDisconnect() {
    const ops = [...this.disconnectOps.values()].flat();
    this.disconnectOps.clear();
    if (ops.length) void this.store.apply(ops);
  }

  goOffline() {
    if (!this.connected) return;
    this.simulateDisconnect();
    this.connected = false;
    for (const cb of this.connListeners) cb(false);
  }

  goOnline() {
    if (this.connected) return;
    this.connected = true;
    for (const l of this.values) l.last = '\u0000';
    for (const cb of this.connListeners) cb(true);
    this.schedule();
  }

  /** Test helper: drop everything. */
  close() {
    this.unsubStore();
    this.values.clear();
    this.children.clear();
  }
}

const num = (v: unknown) => (typeof v === 'number' ? v : -Infinity);

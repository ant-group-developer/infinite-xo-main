import { makePushKey, segments, type Db, type DisconnectOps, type TxResult, type Unsub } from '../db';

/**
 * Shared JSON tree behind one or more LocalDb "clients".
 *  - MemoryStore: in-process (unit tests: several clients = several players)
 *  - BrowserStore: localStorage + BroadcastChannel (dev: one client per browser tab)
 */
export interface LocalStore {
  read(): Record<string, unknown>;
  write(tree: Record<string, unknown>): void;
  /** Notified after every write by any client. */
  subscribe(fn: () => void): Unsub;
  now(): number;
}

export class MemoryStore implements LocalStore {
  private tree: Record<string, unknown> = {};
  private subs = new Set<() => void>();
  /** Tests can move time forward. */
  clockOffset = 0;

  read() {
    return this.tree;
  }
  write(tree: Record<string, unknown>) {
    this.tree = tree;
    for (const fn of [...this.subs]) fn();
  }
  subscribe(fn: () => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  now() {
    return Date.now() + this.clockOffset;
  }
}

export class BrowserStore implements LocalStore {
  private key = 'infinite-xo:localdb';
  private subs = new Set<() => void>();
  private chan: BroadcastChannel | null = null;

  constructor() {
    try {
      this.chan = new BroadcastChannel('infinite-xo-localdb');
      this.chan.onmessage = () => this.notify();
    } catch {
      /* old browser: fall back to storage events */
    }
    window.addEventListener('storage', (e) => {
      if (e.key === this.key && !this.chan) this.notify();
    });
  }
  private notify() {
    for (const fn of [...this.subs]) fn();
  }
  read() {
    try {
      return JSON.parse(localStorage.getItem(this.key) || '{}');
    } catch {
      return {};
    }
  }
  write(tree: Record<string, unknown>) {
    localStorage.setItem(this.key, JSON.stringify(tree));
    this.notify();
    this.chan?.postMessage(1);
  }
  subscribe(fn: () => void): Unsub {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  now() {
    return Date.now();
  }
}

/* ------------------------------------------------------------- tree ops */

type Json = unknown;
const clone = <T>(v: T): T => (v === undefined ? (null as T) : JSON.parse(JSON.stringify(v)));

function getAt(tree: Json, segs: string[]): Json {
  let cur: Json = tree;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, Json>)[s];
    if (cur === undefined) return null;
  }
  return cur ?? null;
}

/** Firebase never stores empty objects or nulls. */
function normalize(v: Json): Json {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [String(i), x]));
  const out: Record<string, Json> = {};
  for (const [k, x] of Object.entries(v as Record<string, Json>)) {
    const n = normalize(x);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

function setAt(tree: Record<string, Json>, segs: string[], value: Json): Record<string, Json> {
  if (!segs.length) return (normalize(value) as Record<string, Json>) ?? {};
  const root = tree;
  const stack: [Record<string, Json>, string][] = [];
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    let next = cur[s];
    if (next === null || typeof next !== 'object') {
      next = {};
      cur[s] = next;
    }
    stack.push([cur, s]);
    cur = next as Record<string, Json>;
  }
  const last = segs[segs.length - 1];
  const n = normalize(value);
  if (n === null) delete cur[last];
  else cur[last] = n;
  // prune empty parents
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    const child = parent[key] as Record<string, Json>;
    if (child && typeof child === 'object' && Object.keys(child).length === 0) delete parent[key];
  }
  return root;
}

function resolveServerValues(v: Json, now: number): Json {
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, Json>;
  if (o['.sv'] === 'timestamp' && Object.keys(o).length === 1) return now;
  const out: Record<string, Json> = Array.isArray(v) ? ({} as Record<string, Json>) : {};
  for (const [k, x] of Object.entries(o)) out[k] = resolveServerValues(x, now);
  return out;
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
  private disconnectOps = new Map<string, { kind: 'set' | 'update' | 'remove'; value?: unknown }>();
  private connected = true;
  private unsubStore: Unsub;
  private scheduled = false;

  constructor(private store: LocalStore) {
    this.unsubStore = store.subscribe(() => this.schedule());
  }

  /* ----- writes */

  private commit(mutator: (tree: Record<string, Json>) => Record<string, Json>) {
    const tree = (clone(this.store.read()) as Record<string, Json> | null) ?? {};
    this.store.write(mutator(tree));
  }

  async get<T>(path: string): Promise<T | null> {
    return clone(getAt(this.store.read(), segments(path))) as T | null;
  }

  async set(path: string, value: unknown) {
    const now = this.store.now();
    this.commit((t) => setAt(t, segments(path), resolveServerValues(clone(value), now)));
  }

  async update(values: Record<string, unknown>) {
    const now = this.store.now();
    this.commit((t) => {
      for (const [p, v] of Object.entries(values)) t = setAt(t, segments(p), resolveServerValues(clone(v), now));
      return t;
    });
  }

  async remove(path: string) {
    this.commit((t) => setAt(t, segments(path), null));
  }

  pushKey(_path?: string): string {
    return makePushKey(this.store.now());
  }

  async transaction<T>(path: string, fn: (cur: T | null) => T | null | undefined): Promise<TxResult<T>> {
    const segs = segments(path);
    const tree = (clone(this.store.read()) as Record<string, Json> | null) ?? {};
    const cur = clone(getAt(tree, segs)) as T | null;
    const next = fn(cur);
    if (next === undefined) return { committed: false, value: cur };
    const resolved = resolveServerValues(clone(next), this.store.now()) as T | null;
    this.store.write(setAt(tree, segs, resolved));
    return { committed: true, value: resolved };
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
      l.cb(clone(v));
    }
    for (const l of [...this.children]) {
      if (!this.children.has(l)) continue;
      const node = getAt(tree, l.path) as Record<string, unknown> | null;
      if (!node || typeof node !== 'object') continue;
      for (const k of Object.keys(node).sort()) {
        if (l.seen.has(k)) continue;
        l.seen.add(k);
        l.cb(k, clone(node[k]));
      }
    }
  }

  /* ----- connection */

  onDisconnect(path: string): DisconnectOps {
    const key = segments(path).join('/');
    return {
      set: async (value) => void this.disconnectOps.set(key, { kind: 'set', value }),
      update: async (values) => void this.disconnectOps.set(key, { kind: 'update', value: values }),
      remove: async () => void this.disconnectOps.set(key, { kind: 'remove' }),
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
    const ops = [...this.disconnectOps];
    this.disconnectOps.clear();
    if (!ops.length) return;
    const now = this.store.now();
    this.commit((t) => {
      for (const [path, op] of ops) {
        const segs = segments(path);
        if (op.kind === 'remove') t = setAt(t, segs, null);
        else if (op.kind === 'set') t = setAt(t, segs, resolveServerValues(clone(op.value), now));
        else
          for (const [k, v] of Object.entries(op.value as Record<string, unknown>))
            t = setAt(t, [...segs, ...segments(k)], resolveServerValues(clone(v), now));
      }
      return t;
    });
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

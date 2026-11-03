/**
 * Minimal realtime-database surface used by the online features.
 *
 * Two implementations:
 *  - FirebaseDb  (src/net/firebase/firebaseDb.ts) – Firebase Realtime Database
 *  - LocalDb     (src/net/local/localDb.ts)       – in-browser / in-memory fake for
 *                                                   dev (multi-tab) and unit tests
 * Game code depends only on this interface, never on the Firebase SDK directly.
 */
export type Unsub = () => void;

/** Placeholder replaced by the server's clock on write (same shape as Firebase's). */
export const SERVER_TS = Object.freeze({ '.sv': 'timestamp' }) as unknown as number;

export interface TxResult<T> {
  committed: boolean;
  value: T | null;
}

export interface DisconnectOps {
  set(value: unknown): Promise<void>;
  update(values: Record<string, unknown>): Promise<void>;
  remove(): Promise<void>;
  cancel(): Promise<void>;
}

export interface Db {
  readonly kind: 'firebase' | 'local';

  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** Atomic multi-path update relative to the root. `null` deletes. */
  update(values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /** A new chronologically ordered child key (does not write). */
  pushKey(path: string): string;

  /** Return `undefined` from `fn` to abort. `fn` may be called more than once. */
  transaction<T>(path: string, fn: (current: T | null) => T | null | undefined): Promise<TxResult<T>>;

  onValue<T = unknown>(path: string, cb: (value: T | null) => void): Unsub;
  /** Fires for existing children (last `limitToLast` only) and every child added later. */
  onChildAdded<T = unknown>(path: string, cb: (key: string, value: T) => void, opts?: { limitToLast?: number }): Unsub;
  /** Children ordered by `child` descending (highest first), top `limit`. */
  topByChild<T = unknown>(path: string, child: string, limit: number): Promise<{ key: string; value: T }[]>;
  /** Children whose `child` equals `value`. */
  equalTo<T = unknown>(path: string, child: string, value: string | number | boolean): Promise<{ key: string; value: T }[]>;

  onDisconnect(path: string): DisconnectOps;
  onConnected(cb: (connected: boolean) => void): Unsub;
  /** Best estimate of the server clock in ms. */
  serverNow(): number;

  goOnline(): void;
  goOffline(): void;
}

/* ------------------------------------------------------------ helpers */

export const join = (...parts: (string | number)[]) =>
  parts
    .map(String)
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');

export const segments = (path: string) => path.split('/').filter(Boolean);

/** Chronological push id (same idea as Firebase push ids: time prefix + randomness). */
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
let lastRand: number[] = [];
export function makePushKey(now = Date.now()): string {
  let ts = '';
  let t = now;
  for (let i = 0; i < 8; i++) {
    ts = PUSH_CHARS.charAt(t % 64) + ts;
    t = Math.floor(t / 64);
  }
  if (now === lastPushTime) {
    let i = 11;
    while (i >= 0 && lastRand[i] === 63) lastRand[i--] = 0;
    if (i >= 0) lastRand[i]++;
  } else {
    lastRand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  }
  lastPushTime = now;
  return ts + lastRand.map((n) => PUSH_CHARS.charAt(n)).join('');
}

/** Short human-friendly code, no ambiguous characters (0/O, 1/I). */
export function makeCode(len = 6): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

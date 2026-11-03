import { LocalAuth } from '../../src/net/auth';
import type { Backend } from '../../src/net/backend';
import { LocalDb, MemoryStore } from '../../src/net/local/localDb';

/** Let queued listener notifications run. */
export const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** One simulated player connected to a shared in-memory database. */
export function client(store: MemoryStore, uid: string): Backend & { db: LocalDb } {
  return { mode: 'local', db: new LocalDb(store), auth: new LocalAuth(uid) };
}

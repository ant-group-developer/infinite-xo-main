import { describe, expect, it } from 'vitest';
import { SERVER_TS } from '../../src/net/db';
import { LocalDb, MemoryStore } from '../../src/net/local/localDb';
import { flush } from './helpers';

describe('LocalDb (fake realtime database)', () => {
  it('set / get / update / delete with null, prunes empty parents', async () => {
    const db = new LocalDb(new MemoryStore());
    await db.set('a/b', { c: 1, d: { e: 2 } });
    expect(await db.get('a/b/d/e')).toBe(2);
    await db.update({ 'a/b/c': null, 'a/x': 5 });
    expect(await db.get('a')).toEqual({ b: { d: { e: 2 } }, x: 5 });
    await db.remove('a/b/d/e');
    expect(await db.get('a')).toEqual({ x: 5 });
    expect(await db.get('missing/path')).toBeNull();
  });

  it('resolves server timestamps', async () => {
    const store = new MemoryStore();
    const db = new LocalDb(store);
    await db.set('t', { at: SERVER_TS });
    const v = await db.get<{ at: number }>('t');
    expect(typeof v!.at).toBe('number');
    expect(Math.abs(v!.at - Date.now())).toBeLessThan(1000);
  });

  it('notifies other clients (onValue) and only on real changes', async () => {
    const store = new MemoryStore();
    const a = new LocalDb(store);
    const b = new LocalDb(store);
    const seen: unknown[] = [];
    b.onValue('room/x', (v) => seen.push(v));
    await flush();
    await a.set('room/x', 1);
    await flush();
    await a.set('other', 1); // unrelated
    await flush();
    await a.set('room/x', 2);
    await flush();
    expect(seen).toEqual([null, 1, 2]);
  });

  it('onChildAdded honours limitToLast and reports new children in key order', async () => {
    const db = new LocalDb(new MemoryStore());
    for (let i = 0; i < 5; i++) await db.set(`chat/${db.pushKey('chat')}`, { n: i });
    const got: number[] = [];
    db.onChildAdded<{ n: number }>('chat', (_, v) => got.push(v.n), { limitToLast: 2 });
    await flush();
    await db.set(`chat/${db.pushKey('chat')}`, { n: 5 });
    await flush();
    expect(got).toEqual([3, 4, 5]);
  });

  it('transactions see the latest value and can abort', async () => {
    const store = new MemoryStore();
    const a = new LocalDb(store);
    const b = new LocalDb(store);
    const claim = (db: LocalDb, uid: string) =>
      db.transaction<string>('slots/X', (cur) => (cur ? undefined : uid));
    const r1 = await claim(a, 'alice');
    const r2 = await claim(b, 'bob');
    expect(r1.committed).toBe(true);
    expect(r2.committed).toBe(false);
    expect(await a.get('slots/X')).toBe('alice');
  });

  it('runs onDisconnect operations when the client goes away', async () => {
    const store = new MemoryStore();
    const a = new LocalDb(store);
    const b = new LocalDb(store);
    await a.set('members/alice', { name: 'A' });
    await a.onDisconnect('members/alice').remove();
    await a.onDisconnect('status/alice').set({ state: 'offline' });
    a.simulateDisconnect();
    expect(await b.get('members/alice')).toBeNull();
    expect(await b.get('status/alice')).toEqual({ state: 'offline' });
  });

  it('topByChild sorts descending', async () => {
    const db = new LocalDb(new MemoryStore());
    await db.update({ 's/a/rating': 1200, 's/b/rating': 1500, 's/c/rating': 900 });
    const top = await db.topByChild<{ rating: number }>('s', 'rating', 2);
    expect(top.map((r) => r.key)).toEqual(['b', 'a']);
  });
});

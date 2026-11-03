import { describe, expect, it } from 'vitest';
import { Game } from '../../src/core/game';
import { MemoryStore } from '../../src/net/local/localDb';
import { MatchSync, TURN_MS, startMatch, type MatchEvent } from '../../src/net/match';
import { RoomSession, createRoom, type MemberInfo } from '../../src/net/rooms';
import type { Room } from '../../src/net/schema';
import { client, flush } from './helpers';

const info = (name: string): MemberInfo => ({ name, avatar: 1, country: 'VN', rating: 1000 });
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};

async function arena() {
  const store = new MemoryStore();
  const A = client(store, 'alice');
  const B = client(store, 'bob');
  const C = client(store, 'carol');
  const id = await createRoom(A, 'alice', info('Alice'), { name: 'r', visibility: 'private' });
  const sa = new RoomSession(A, 'alice', id, info('Alice'));
  const sb = new RoomSession(B, 'bob', id, info('Bob'));
  await sa.join();
  await sb.join();
  await sa.claimSlot('X');
  await sb.claimSlot('O');
  await settle();
  const mk = (be: typeof A, uid: string) => {
    const g = new Game();
    const m = new MatchSync(be, id, uid, g);
    const events: MatchEvent[] = [];
    m.on((e) => events.push(e));
    m.start();
    return { m, g, events };
  };
  const a = mk(A, 'alice');
  const b = mk(B, 'bob');
  await startMatch(A, id, (await A.db.get<Room>(`rooms/${id}`))!);
  await settle();
  const cleanup = () => {
    a.m.dispose();
    b.m.dispose();
  };
  return { store, id, A, B, C, a, b, mk, cleanup, sa, sb };
}

describe('online match sync', () => {
  it('starts, alternates turns and mirrors moves to both players', async () => {
    const t = await arena();
    expect(t.a.m.mySide).toBe('X');
    expect(t.b.m.mySide).toBe('O');
    expect(t.a.events.some((e) => e.type === 'start')).toBe(true);
    expect(await t.b.m.move(0, 0)).toBe('not-your-turn');
    expect(await t.a.m.move(0, 0)).toBeNull();
    await settle();
    expect(t.b.g.moves).toEqual([{ x: 0, y: 0, p: 'X' }]);
    expect(t.b.m.doc!.turn).toBe('O');
    expect(await t.b.m.move(0, 0)).toBe('occupied');
    expect(await t.b.m.move(-3, 7)).toBeNull();
    await settle();
    expect(t.a.g.moves.length).toBe(2);
    expect(t.a.g.turn).toBe('X');
    t.cleanup();
  });

  it('a five ends the game for everyone, with the winning line stored', async () => {
    const t = await arena();
    for (let i = 0; i < 4; i++) {
      await t.a.m.move(i, 0);
      await settle();
      await t.b.m.move(i, 5);
      await settle();
    }
    await t.a.m.move(4, 0);
    await settle();
    const r = t.b.m.doc!.result!;
    expect(r).toMatchObject({ winner: 'X', reason: 'five', line: { sx: 0, sy: 0, dx: 1, dy: 0, len: 5 } });
    expect(t.b.g.status).toBe('won');
    expect(t.b.g.winner).toBe('X');
    expect(await t.b.m.move(9, 9)).toBe('over');
    t.cleanup();
  });

  it('spectators joining mid-game replay all moves', async () => {
    const t = await arena();
    await t.a.m.move(0, 0);
    await settle();
    await t.b.m.move(1, 1);
    await settle();
    const c = t.mk(t.C, 'carol');
    await settle();
    expect(c.m.mySide).toBeNull();
    expect(c.g.moves.length).toBe(2);
    expect(await c.m.move(5, 5)).toBe('not-player');
    c.m.dispose();
    t.cleanup();
  });

  it('resign and draw (offer, decline, accept)', async () => {
    const t = await arena();
    await t.a.m.offerDraw();
    await settle();
    expect(t.b.events.some((e) => e.type === 'draw-offer')).toBe(true);
    await t.b.m.answerDraw(false);
    await settle();
    expect(t.a.events.some((e) => e.type === 'draw-declined')).toBe(true);
    await t.b.m.offerDraw();
    await settle();
    await t.a.m.answerDraw(true);
    await settle();
    expect(t.b.m.doc!.result!.reason).toBe('draw');
    expect(t.b.m.doc!.result!.winner ?? null).toBeNull();
    expect(t.b.g.status).toBe('draw');

    // rematch → fresh game (seq 2), then a resignation
    await startMatch(t.A, t.id, (await t.A.db.get<Room>(`rooms/${t.id}`))!);
    await settle();
    expect(t.b.m.doc!.seq).toBe(2);
    expect(t.b.g.status).toBe('playing');
    await t.b.m.resign();
    await settle();
    expect(t.a.m.doc!.result).toMatchObject({ winner: 'X', reason: 'resign' });
    expect(t.a.g.winner).toBe('X');
    t.cleanup();
  });

  it('running out of the 2-minute move clock loses', async () => {
    const t = await arena();
    await t.a.m.move(0, 0);
    await settle();
    t.store.clockOffset += TURN_MS - 5_000;
    await (t.a.m as unknown as { checkTimeout(): Promise<void> }).checkTimeout();
    await settle();
    expect(t.a.m.doc!.result).toBeFalsy();
    t.store.clockOffset += 10_000;
    await (t.a.m as unknown as { checkTimeout(): Promise<void> }).checkTimeout();
    await settle();
    expect(t.b.m.doc!.result).toMatchObject({ winner: 'X', reason: 'timeout' });
    expect(t.b.g.isOver).toBe(true);
    t.cleanup();
  });
});

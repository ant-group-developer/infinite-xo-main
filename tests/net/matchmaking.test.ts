import { afterEach, describe, expect, it } from 'vitest';
import { Game } from '../../src/core/game';
import { personas, pickPersona, botStyle } from '../../src/ai/persona';
import { MemoryStore } from '../../src/net/local/localDb';
import { MatchSync, type GameDoc } from '../../src/net/match';
import { Matchmaker, windowFor, type MmEvent } from '../../src/net/matchmaking';
import { ProfileService } from '../../src/net/profile';
import { RoomSession, type MemberInfo } from '../../src/net/rooms';
import type { Room } from '../../src/net/schema';
import { client, flush } from './helpers';

const info = (name: string, rating = 1000): MemberInfo => ({ name, avatar: 1, country: 'VN', rating });
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await flush(10);
  }
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function searcher(store: MemoryStore, uid: string, rating: number) {
  const be = client(store, uid);
  await new ProfileService(be).init();
  if (rating !== 1000) await be.db.update({ [`stats/${uid}/rating`]: rating });
  const mm = new Matchmaker(be, uid, info(uid, rating), { tickMs: 30 });
  const events: MmEvent[] = [];
  mm.on((e) => events.push(e));
  cleanups.push(() => mm.cancel());
  return { be, mm, events, matched: () => events.find((e) => e.type === 'matched') as Extract<MmEvent, { type: 'matched' }> | undefined };
}

describe('matchmaking', () => {
  it('rating window widens with waiting time', () => {
    expect(windowFor(0)).toBe(100);
    expect(windowFor(5000)).toBe(150);
    expect(windowFor(40_000)).toBe(400);
    expect(windowFor(45_000)).toBe(Infinity);
  });

  it('pairs two waiting players into a ranked game; lower rating plays X', async () => {
    const store = new MemoryStore();
    await client(store, 'admin').db.set('config/matchmaking', { botEnabled: false });
    const a = await searcher(store, 'alice', 1080);
    const b = await searcher(store, 'bob', 1000);
    await a.mm.start();
    await flush(20);
    await b.mm.start();
    // the joining (non-host) side enters the room when told
    await until(() => !!a.matched() || !!b.matched());
    const guest = a.matched()?.host ? b : a;
    await until(() => !!guest.matched());
    const roomId = guest.matched()!.roomId;
    const s = new RoomSession(guest.be, guest === a ? 'alice' : 'bob', roomId, info('g'));
    await s.join();
    cleanups.push(() => s.leave());
    await until(() => (a.matched()?.roomId ?? '') === (b.matched()?.roomId ?? '-'));
    const doc = await guest.be.db.get<GameDoc>(`games/${roomId}`);
    expect(doc!.type).toBe('ranked');
    expect(doc!.players.X.uid).toBe('bob'); // 1000 < 1080
    expect(doc!.players.O.uid).toBe('alice');
    expect(await guest.be.db.get('queue')).toBeNull();
  });

  it('does not pair players far apart at first', async () => {
    const store = new MemoryStore();
    await client(store, 'admin').db.set('config/matchmaking', { botEnabled: false });
    const a = await searcher(store, 'alice', 1600);
    const b = await searcher(store, 'bob', 1000);
    await a.mm.start();
    await b.mm.start();
    await flush(200);
    expect(a.matched()).toBeUndefined();
    expect(b.matched()).toBeUndefined();
  });

  it('falls back to a bot that looks like a player, and the bot plays its moves', async () => {
    const store = new MemoryStore();
    await client(store, 'admin').db.set('config/matchmaking', { botEnabled: true, botAfterMinMs: 0, botAfterMaxMs: 0 });
    const a = await searcher(store, 'alice', 1000);
    await a.mm.start();
    await until(() => !!a.matched());
    const m = a.matched()!;
    expect(m.vsBot).toBe(true);
    const room = await a.be.db.get<Room>(`rooms/${m.roomId}`);
    expect(room!.meta.type).toBe('bot');
    const doc = (await a.be.db.get<GameDoc>(`games/${m.roomId}`))!;
    const botSide = doc.players.X.bot ? 'X' : 'O';
    const bot = doc.players[botSide];
    expect(bot.uid).toMatch(/^bot:\d+$/);
    expect(Math.abs(bot.rating - 1000)).toBeLessThanOrEqual(60);
    expect(personas().some((p) => p.name === bot.name)).toBe(true);

    // The human host writes the bot's moves through MatchSync.moveAs.
    const sync = new MatchSync(a.be, m.roomId, 'alice', new Game());
    sync.start();
    cleanups.push(() => sync.dispose());
    await until(() => !!sync.doc);
    if (botSide === 'X') expect(await sync.moveAs('X', 0, 0)).toBeNull();
    else {
      expect(await sync.move(0, 0)).toBeNull();
      await until(() => sync.doc!.n === 1);
      expect(await sync.moveAs('O', 1, 1)).toBeNull();
    }
    await until(() => sync.doc!.turn === (botSide === 'X' ? 'O' : 'X'));
    expect(await sync.moveAs(botSide === 'X' ? 'O' : 'X', 5, 5)).toBe('not-player'); // cannot move for a human
  });

  it('personas: stable ids, rating near the player, style by rating', () => {
    const list = personas();
    expect(list.length).toBeGreaterThan(100);
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    expect(list.every((p) => p.name.length <= 16)).toBe(true);
    const { persona, rating } = pickPersona(1500, [list[0].id], () => 0.5);
    expect(persona.id).not.toBe(list[0].id);
    expect(rating).toBe(1500);
    expect(botStyle(900).level).toBe('easy');
    expect(botStyle(1400).level).toBe('medium');
    expect(botStyle(2000).level).toBe('hard');
  });
});

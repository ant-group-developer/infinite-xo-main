import { afterEach, describe, expect, it } from 'vitest';
import { ChatService } from '../../src/net/chat';
import { MemoryStore } from '../../src/net/local/localDb';
import {
  RoomError,
  RoomSession,
  createRoom,
  findRoomByCode,
  listPublicRooms,
  type MemberInfo,
  type RoomEvent,
} from '../../src/net/rooms';
import type { ChatMessage, Room } from '../../src/net/schema';
import { client, flush } from './helpers';

const info = (name: string): MemberInfo => ({ name, avatar: 1, country: 'VN', rating: 1000 });
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};

const sessions: RoomSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.leave().catch(() => {});
});

async function setup() {
  const store = new MemoryStore();
  const alice = client(store, 'alice');
  const bob = client(store, 'bob');
  const carol = client(store, 'carol');
  const id = await createRoom(alice, 'alice', info('Alice'), { name: 'Phòng vui', visibility: 'public' });
  const join = async (be: typeof alice, uid: string, name: string) => {
    const s = new RoomSession(be, uid, id, info(name));
    const events: RoomEvent['type'][] = [];
    s.on((e) => events.push(e.type));
    sessions.push(s);
    await s.join();
    return { s, events, be };
  };
  return { store, id, alice, bob, carol, join };
}

describe('rooms', () => {
  it('creates a room with a code and a lobby entry', async () => {
    const { alice, id } = await setup();
    const room = await alice.db.get<Room>(`rooms/${id}`);
    expect(room!.meta.hostUid).toBe('alice');
    expect(await findRoomByCode(alice, room!.meta.code)).toBe(id);
    expect(await findRoomByCode(alice, room!.meta.code.toLowerCase())).toBe(id);
    const lobby = await listPublicRooms(alice);
    expect(lobby.map((r) => r.id)).toEqual([id]);
  });

  it('private rooms are not listed', async () => {
    const store = new MemoryStore();
    const a = client(store, 'a');
    await createRoom(a, 'a', info('A'), { name: 'secret', visibility: 'private' });
    expect(await listPublicRooms(a)).toEqual([]);
  });

  it('slots are first-come-first-served; players can switch to spectator', async () => {
    const env = await setup();
    const sa = await env.join(env.alice, 'alice', 'Alice');
    const sb = await env.join(env.bob, 'bob', 'Bob');
    await settle();
    await sa.s.claimSlot('X');
    await settle();
    await expect(sb.s.claimSlot('X')).rejects.toMatchObject({ code: 'slot-taken' });
    await sb.s.claimSlot('O');
    await settle();
    expect(sb.s.mySide).toBe('O');
    expect(sa.s.mySide).toBe('X');
    // switching sides releases the old slot
    await sb.s.leaveSlot();
    await settle();
    expect(sa.s.room!.slots?.O).toBeUndefined();
    expect(sa.s.spectators.map(([u]) => u)).toEqual(['bob']);
  });

  it('joining writes joinedAt exactly once (rules: write-once) even with the connected event racing', async () => {
    const env = await setup();
    const db = env.bob.db;
    let joinedAtWrites = 0;
    const count = (path: string, v: unknown) => {
      if (path.endsWith('/members/bob') && v && typeof v === 'object' && 'joinedAt' in v) joinedAtWrites++;
      if (path.endsWith('/members/bob/joinedAt')) joinedAtWrites++;
    };
    const set = db.set.bind(db);
    const update = db.update.bind(db);
    db.set = async (p, v) => (count(p, v), set(p, v));
    db.update = async (vals) => {
      for (const [p, v] of Object.entries(vals)) count(p, v);
      return update(vals);
    };
    const sb = await env.join(env.bob, 'bob', 'Bob');
    await settle();
    await sb.s.updateMe({ name: 'Bobby', avatar: 2, country: 'VN', rating: 1000 });
    await settle();
    expect(joinedAtWrites).toBe(1);
    expect(sb.s.members.bob.name).toBe('Bobby');
  });

  it('joining a room that does not exist fails cleanly', async () => {
    const env = await setup();
    const s = new RoomSession(env.carol, 'carol', 'nope', info('Carol'));
    await expect(s.join()).rejects.toMatchObject({ code: 'not-found' });
  });

  it('ready flags belong to the slot', async () => {
    const env = await setup();
    const sa = await env.join(env.alice, 'alice', 'Alice');
    await sa.s.claimSlot('X');
    await sa.s.setReady(true);
    await settle();
    expect(sa.s.room!.ready?.X).toBe(true);
    await sa.s.claimSlot('O'); // moving resets readiness
    await settle();
    expect(sa.s.room!.ready?.X).toBeUndefined();
    expect(sa.s.room!.slots?.X).toBeUndefined();
  });

  it('host can kick a player; the kicked player is told and cannot rejoin', async () => {
    const env = await setup();
    const sa = await env.join(env.alice, 'alice', 'Alice');
    const sb = await env.join(env.bob, 'bob', 'Bob');
    await sb.s.claimSlot('O');
    await settle();
    await expect(sb.s.kick('alice')).rejects.toBeInstanceOf(RoomError); // not host
    await sa.s.kick('bob');
    await settle();
    expect(sb.events).toContain('kicked');
    expect(sa.s.room!.slots?.O).toBeUndefined();
    expect(sa.s.members.bob).toBeUndefined();
    const again = new RoomSession(env.bob, 'bob', env.id, info('Bob'));
    await expect(again.join()).rejects.toMatchObject({ code: 'kicked' });
  });

  it('host hand-over when the host leaves; room deleted when the last member leaves', async () => {
    const env = await setup();
    const sa = await env.join(env.alice, 'alice', 'Alice');
    const sb = await env.join(env.bob, 'bob', 'Bob');
    const sc = await env.join(env.carol, 'carol', 'Carol');
    await settle();
    await sa.s.leave();
    await settle();
    expect(sb.s.isHost).toBe(true);
    await sb.s.leave();
    await settle();
    expect(sc.s.isHost).toBe(true);
    const code = sc.s.meta!.code;
    await sc.s.leave();
    expect(await env.alice.db.get(`rooms/${env.id}`)).toBeNull();
    expect(await env.alice.db.get(`roomCodes/${code}`)).toBeNull();
    expect(await env.alice.db.get(`roomIndex/${env.id}`)).toBeNull();
  });

  it('host disconnect (tab closed): next member takes over and frees vanished slots', async () => {
    const env = await setup();
    const sa = await env.join(env.alice, 'alice', 'Alice');
    const sb = await env.join(env.bob, 'bob', 'Bob');
    await sa.s.claimSlot('X');
    await settle();
    env.alice.db.simulateDisconnect(); // alice's onDisconnect removes her membership
    await settle();
    expect(sb.s.isHost).toBe(true);
    expect(sb.s.room!.slots?.X).toBeUndefined();
  });

  it('room deleted while inside -> closed event', async () => {
    const env = await setup();
    const sb = await env.join(env.bob, 'bob', 'Bob');
    await env.alice.db.remove(`rooms/${env.id}`);
    await settle();
    expect(sb.events).toContain('closed');
  });

  it('lobby cleans up stale rooms', async () => {
    const env = await setup();
    env.store.clockOffset = 31 * 60 * 1000;
    expect(await listPublicRooms(env.bob)).toEqual([]);
    await settle();
    expect(await env.bob.db.get(`rooms/${env.id}`)).toBeNull();
  });
});

describe('chat', () => {
  it('delivers messages, masks profanity, rate-limits, supports mute', async () => {
    const env = await setup();
    const ca = new ChatService(env.alice, env.id, 'alice');
    const cb = new ChatService(env.bob, env.id, 'bob');
    const got: ChatMessage[] = [];
    cb.subscribe((_, m) => got.push(m));
    expect(await ca.send('Alice', 'hello fuck')).toBe(true);
    expect(await ca.send('Alice', 'too fast')).toBe(false);
    expect(await ca.send('Alice', '   ')).toBe(false);
    await settle();
    expect(got.map((m) => m.text)).toEqual(['hello ****']);
    cb.toggleMute('alice');
    expect(cb.isMuted('alice')).toBe(true);
  });
});

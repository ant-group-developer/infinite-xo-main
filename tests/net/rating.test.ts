import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/net/local/localDb';
import type { GameDoc } from '../../src/net/match';
import { ProfileService } from '../../src/net/profile';
import { BOT_DAILY_RATED, applyRatedResult, leaderboard, matchId, myRank, recentHistory } from '../../src/net/rating';
import type { MatchRecord, PlayerStats } from '../../src/net/schema';
import { client, flush } from './helpers';

async function players() {
  const store = new MemoryStore();
  const A = client(store, 'alice');
  const B = client(store, 'bob');
  await new ProfileService(A).init();
  await new ProfileService(B).init();
  return { store, A, B };
}

const doc = (over: Partial<GameDoc> & { winner?: 'X' | 'O' | null }, seq = 1): GameDoc => ({
  seq,
  type: over.type ?? 'ranked',
  players: over.players ?? {
    X: { uid: 'alice', name: 'Alice', avatar: 0, country: 'VN', rating: 1000 },
    O: { uid: 'bob', name: 'Bob', avatar: 0, country: 'VN', rating: 1000 },
  },
  startedAt: 0,
  n: 9,
  turn: 'O',
  turnStart: 0,
  result: { winner: over.winner === undefined ? 'X' : over.winner, reason: 'five', at: 0 },
});

describe('rated results', () => {
  it('applies exactly once even when both players report it', async () => {
    const { A, B } = await players();
    const d = doc({});
    const [ra, rb] = await Promise.all([applyRatedResult(A, 'room1', d, 'alice'), applyRatedResult(B, 'room1', d, 'bob')]);
    await flush();
    expect(ra).toMatchObject({ before: 1000, after: 1020, delta: 20, outcome: 'w' });
    expect(rb).toMatchObject({ before: 1000, after: 980, delta: -20, outcome: 'l' });
    const a = await A.db.get<PlayerStats>('stats/alice');
    const b = await A.db.get<PlayerStats>('stats/bob');
    expect(a).toMatchObject({ rating: 1020, games: 1, w: 1, streak: 1, peak: 1020, lastMatch: matchId('room1', 1) });
    expect(b).toMatchObject({ rating: 980, games: 1, l: 1, streak: 0 });
    const rec = await A.db.get<MatchRecord>(`matches/${matchId('room1', 1)}`);
    expect(rec!.applied).toBe(true);
    // calling again is a no-op
    await applyRatedResult(A, 'room1', d, 'alice');
    expect((await A.db.get<PlayerStats>('stats/alice'))!.rating).toBe(1020);
  });

  it('casual games are not rated', async () => {
    const { A } = await players();
    expect(await applyRatedResult(A, 'r', doc({ type: 'casual' }), 'alice')).toBeNull();
    expect((await A.db.get<PlayerStats>('stats/alice'))!.games).toBe(0);
  });

  it('draws and history entries', async () => {
    const { A } = await players();
    await applyRatedResult(A, 'r', doc({ winner: null }), 'alice');
    const h = await recentHistory(A, 'alice');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ opp: 'Bob', res: 'd', delta: 0 });
    expect((await A.db.get<PlayerStats>('stats/bob'))!.d).toBe(1);
  });

  it('farming the same opponent: half value after 3 games, nothing after 5', async () => {
    const { A } = await players();
    const deltas: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const before = (await A.db.get<PlayerStats>('stats/alice'))!.rating;
      const bob = (await A.db.get<PlayerStats>('stats/bob'))!.rating;
      const d = doc({
        players: {
          X: { uid: 'alice', name: 'Alice', avatar: 0, country: 'VN', rating: before },
          O: { uid: 'bob', name: 'Bob', avatar: 0, country: 'VN', rating: bob },
        },
      }, i);
      const r = await applyRatedResult(A, 'farm', d, 'alice');
      deltas.push(r!.delta);
    }
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[3]).toBeLessThan(deltas[0]);
    expect(deltas[5]).toBe(0);
  });

  it('games against bots: only the human is rated, daily cap', async () => {
    const { A } = await players();
    const botDoc = (seq: number) =>
      doc({
        type: 'bot',
        players: {
          X: { uid: 'alice', name: 'Alice', avatar: 0, country: 'VN', rating: 1000 },
          O: { uid: 'bot:7', name: 'Mai', avatar: 3, country: 'VN', rating: 1000, bot: true },
        },
      }, seq);
    let last = 0;
    for (let i = 1; i <= BOT_DAILY_RATED + 1; i++) last = (await applyRatedResult(A, 'botroom', botDoc(i), 'alice'))!.delta;
    expect(last).toBe(0);
    const s = (await A.db.get<PlayerStats>('stats/alice'))!;
    expect(s.botToday).toBe(BOT_DAILY_RATED + 1);
    expect(s.games).toBe(BOT_DAILY_RATED + 1);
    expect(await A.db.get('stats/bot:7')).toBeNull();
  });

  it('leaderboard ignores unrated players and ranks by rating', async () => {
    const { A, B } = await players();
    await applyRatedResult(A, 'room', doc({}), 'alice');
    void B;
    const board = await leaderboard(A);
    expect(board.map((r) => r.uid)).toEqual(['alice', 'bob']);
    expect(await myRank(A, 'bob')).toBe(2);
    const vn = await leaderboard(A, { country: 'JP' });
    expect(vn).toEqual([]);
  });
});

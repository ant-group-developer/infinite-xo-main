import { pairMultiplier, promoted, ratingDelta, type Outcome } from '../core/elo';
import type { Backend } from './backend';
import { SERVER_TS } from './db';
import type { GameDoc } from './match';
import type { HistoryEntry, MatchRecord, PlayerStats, Side } from './schema';

/** Daily cap of rated games against bots (bots run on the client on the Spark plan). */
export const BOT_DAILY_RATED = 15;

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
  outcome: Outcome;
  promoted: boolean;
}

export const matchId = (roomId: string, seq: number) => `${roomId}_${seq}`;
export const pairKey = (a: string, b: string) => (a < b ? `${a}__${b}` : `${b}__${a}`);
/** UTC day number (days since epoch) – simple enough for database rules to check. */
export const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

const outcomeOf = (doc: GameDoc, side: Side): Outcome =>
  !doc.result?.winner ? 'd' : doc.result.winner === side ? 'w' : 'l';

/**
 * Apply a finished ranked / bot game to the players' ratings exactly once.
 * Both clients call this; a transaction on /matches/{id}/by picks who writes.
 * Returns the change for `myUid` (null for casual games or spectators).
 */
export async function applyRatedResult(
  be: Backend,
  roomId: string,
  doc: GameDoc,
  myUid: string,
): Promise<RatingChange | null> {
  if (!doc.result || doc.type === 'casual') return null;
  const mySide: Side | null = doc.players.X.uid === myUid ? 'X' : doc.players.O.uid === myUid ? 'O' : null;
  const { db } = be;
  const id = matchId(roomId, doc.seq);

  // Claim the right to write. A claim older than 30 s that never got applied can be taken over.
  const now0 = db.serverNow();
  const claim = await db.transaction<{ uid: string; at: number }>(`matches/${id}/by`, (cur) =>
    cur && !(cur.at < now0 - 30_000) ? undefined : { uid: myUid, at: SERVER_TS },
  );
  const applied = await db.get<boolean>(`matches/${id}/applied`);
  if (!claim.committed || applied) {
    const rec = await waitApplied(be, id);
    return mySide && rec ? changeFromRecord(rec, mySide) : null;
  }

  const sides: Side[] = ['X', 'O'];
  const humans = sides.filter((s) => !doc.players[s].bot);
  const now = db.serverNow();
  const day = utcDay(now);
  const stats: Partial<Record<Side, PlayerStats>> = {};
  for (const s of humans) stats[s] = (await db.get<PlayerStats>(`stats/${doc.players[s].uid}`)) ?? undefined;

  let pair = 0;
  const pk = humans.length === 2 ? pairKey(doc.players.X.uid, doc.players.O.uid) : null;
  if (pk) pair = (await db.get<number>(`pairCount/${pk}/${day}`)) ?? 0;

  const up: Record<string, unknown> = {};
  const record: MatchRecord = {
    by: { uid: myUid, at: now },
    applied: true,
    room: roomId,
    seq: doc.seq,
    type: doc.type,
    winner: doc.result.winner ?? null,
    reason: doc.result.reason,
    at: SERVER_TS,
    players: {} as MatchRecord['players'],
  };

  for (const s of sides) {
    const p = doc.players[s];
    const opp = doc.players[s === 'X' ? 'O' : 'X'];
    const st = stats[s];
    if (p.bot || !st) {
      record.players[s] = { uid: p.uid, name: p.name, before: p.rating, after: p.rating, ...(p.bot ? { bot: true } : {}) };
      continue;
    }
    const outcome = outcomeOf(doc, s);
    let mult = pk ? pairMultiplier(pair) : 1;
    let botDay = st.botDay ?? 0;
    let botToday = st.botToday ?? 0;
    if (opp.bot) {
      if (botDay !== day) {
        botDay = day;
        botToday = 0;
      }
      if (botToday >= BOT_DAILY_RATED) mult = 0;
      botToday++;
    }
    const delta = ratingDelta(st.rating, opp.rating, outcome, st.games, mult);
    const rating = st.rating + delta;
    const streak = outcome === 'w' ? st.streak + 1 : outcome === 'l' ? 0 : st.streak;
    const base = `stats/${p.uid}`;
    Object.assign(up, {
      [`${base}/rating`]: rating,
      [`${base}/games`]: st.games + 1,
      [`${base}/${outcome}`]: st[outcome] + 1,
      [`${base}/streak`]: streak,
      [`${base}/bestStreak`]: Math.max(st.bestStreak, streak),
      [`${base}/peak`]: Math.max(st.peak, rating),
      [`${base}/lastMatch`]: id,
    });
    if (opp.bot) {
      up[`${base}/botDay`] = botDay;
      up[`${base}/botToday`] = botToday;
    }
    record.players[s] = { uid: p.uid, name: p.name, before: st.rating, after: rating };
    up[`history/${p.uid}/${id}`] = {
      opp: opp.name,
      oppRating: opp.rating,
      ...(opp.bot ? { oppBot: true } : {}),
      res: outcome,
      delta,
      after: rating,
      at: SERVER_TS,
    } satisfies HistoryEntry;
  }
  if (pk) up[`pairCount/${pk}/${day}`] = pair + 1;
  // The record (with `applied`) goes in the same atomic update as the ratings.
  const claimed = claim.value ?? { uid: myUid, at: now };
  up[`matches/${id}`] = { ...record, by: claimed };
  await db.update(up);
  return mySide ? changeFromRecord({ ...record, at: now }, mySide, outcomeOf(doc, mySide)) : null;
}

function changeFromRecord(rec: MatchRecord, side: Side, outcome?: Outcome): RatingChange {
  const p = rec.players[side];
  const o: Outcome = outcome ?? (!rec.winner ? 'd' : rec.winner === side ? 'w' : 'l');
  return { before: p.before, after: p.after, delta: p.after - p.before, outcome: o, promoted: promoted(p.before, p.after) };
}

function waitApplied(be: Backend, id: string, ms = 8000): Promise<MatchRecord | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (rec: MatchRecord | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => off());
      resolve(rec);
    };
    const timer = setTimeout(() => finish(null), ms);
    const off = be.db.onValue<MatchRecord>(`matches/${id}`, (rec) => {
      if (rec?.applied && rec.players) finish(rec);
    });
  });
}

/* ------------------------------------------------------------ leaderboard */

export interface BoardRow {
  uid: string;
  rank: number;
  stats: PlayerStats;
}

/** Top players by rating; `country` filters (client-side over the top 500). */
export async function leaderboard(be: Backend, opts: { country?: string; limit?: number } = {}): Promise<BoardRow[]> {
  const limit = opts.limit ?? 100;
  const rows = await be.db.topByChild<PlayerStats>('stats', 'rating', opts.country ? 500 : Math.max(limit, 200));
  const played = rows.filter((r) => r.value.games > 0);
  const filtered = opts.country ? played.filter((r) => r.value.country === opts.country) : played;
  return filtered.slice(0, limit).map((r, i) => ({ uid: r.key, rank: i + 1, stats: r.value }));
}

/** My 1-based global position, or null if outside the top 1000 / unrated. */
export async function myRank(be: Backend, uid: string): Promise<number | null> {
  const rows = await be.db.topByChild<PlayerStats>('stats', 'rating', 1000);
  const i = rows.filter((r) => r.value.games > 0).findIndex((r) => r.key === uid);
  return i < 0 ? null : i + 1;
}

export async function recentHistory(be: Backend, uid: string, n = 20): Promise<(HistoryEntry & { id: string })[]> {
  const all = (await be.db.get<Record<string, HistoryEntry>>(`history/${uid}`)) ?? {};
  return Object.entries(all)
    .map(([id, h]) => ({ id, ...h }))
    .sort((a, b) => b.at - a.at)
    .slice(0, n);
}

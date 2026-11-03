/**
 * Rating maths (pure, shared by the client, tests and – later – Cloud Functions).
 *
 * Expected score is a linearised Elo curve: E = clamp(0.5 + Δ/700, 0.06, 0.94).
 * It matches the logistic curve closely for |Δ| ≤ 300 and is simple enough to
 * re-check in database rules if we ever need to.
 */

export const START_RATING = 1000;
export const MIN_RATING = 100;
export const MAX_DELTA = 40;

export type Outcome = 'w' | 'l' | 'd';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function expected(me: number, opp: number): number {
  return clamp(0.5 + (me - opp) / 700, 0.06, 0.94);
}

/** K: fast placement for the first 20 games, slower at the top. */
export function kFactor(gamesPlayed: number, rating: number): number {
  if (gamesPlayed < 20) return 40;
  if (rating < 2100) return 24;
  return 16;
}

/**
 * Anti-farming: games already played against the same opponent today.
 * 1st–3rd game full value, 4th–5th half, 6th+ nothing.
 */
export function pairMultiplier(gamesTodayVsOpp: number): number {
  if (gamesTodayVsOpp >= 5) return 0;
  if (gamesTodayVsOpp >= 3) return 0.5;
  return 1;
}

export function ratingDelta(me: number, opp: number, outcome: Outcome, gamesPlayed: number, mult = 1): number {
  const s = outcome === 'w' ? 1 : outcome === 'd' ? 0.5 : 0;
  const raw = kFactor(gamesPlayed, me) * mult * (s - expected(me, opp));
  let d = Math.round(raw);
  // Never lose points for a win / gain for a loss because of rounding.
  if (outcome === 'w') d = Math.max(0, d);
  if (outcome === 'l') d = Math.min(0, d);
  d = clamp(d, -MAX_DELTA, MAX_DELTA);
  if (me + d < MIN_RATING) d = MIN_RATING - me;
  return d;
}

/* ------------------------------------------------------------------ tiers */

export interface TierDef {
  id: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master' | 'grandmaster' | 'challenger';
  min: number;
  icon: string;
  color: string;
  /** Bronze..Diamond have divisions III / II / I */
  divisions: boolean;
}

export const TIERS: TierDef[] = [
  { id: 'bronze', min: 0, icon: '🥉', color: '#cd7f4f', divisions: true },
  { id: 'silver', min: 1100, icon: '🥈', color: '#c9d3e6', divisions: true },
  { id: 'gold', min: 1300, icon: '🥇', color: '#ffd23a', divisions: true },
  { id: 'platinum', min: 1500, icon: '💠', color: '#3dffb0', divisions: true },
  { id: 'diamond', min: 1700, icon: '💎', color: '#1ff4ff', divisions: true },
  { id: 'master', min: 1900, icon: '👑', color: '#c58bff', divisions: false },
  { id: 'grandmaster', min: 2100, icon: '🔥', color: '#ff6a3d', divisions: false },
  { id: 'challenger', min: 2100, icon: '⚡', color: '#ff2bd6', divisions: false },
];

export const CHALLENGER_TOP = 50;

export interface Tier {
  def: TierDef;
  /** 3, 2, 1 (III, II, I) or 0 when the tier has no divisions */
  division: 0 | 1 | 2 | 3;
  /** progress 0..1 inside the current division / tier */
  progress: number;
  /** rating needed for the next division/tier, or null at the top */
  next: number | null;
}

/** `rank` (1-based leaderboard position) unlocks Challenger. */
export function tierOf(rating: number, rank?: number): Tier {
  if (rating >= 2100 && rank !== undefined && rank <= CHALLENGER_TOP) {
    return { def: TIERS[7], division: 0, progress: 1, next: null };
  }
  let i = 0;
  for (let k = 0; k < 7; k++) if (rating >= TIERS[k].min) i = k;
  const def = TIERS[i];
  const upper = i < 6 ? TIERS[i + 1].min : null;
  if (!def.divisions || upper === null) {
    const span = upper === null ? 200 : upper - def.min;
    return { def, division: 0, progress: clamp((rating - def.min) / span, 0, 1), next: upper };
  }
  const span = (upper - def.min) / 3;
  const step = Math.min(2, Math.floor((rating - def.min) / span)); // 0,1,2
  const division = (3 - step) as 1 | 2 | 3;
  const lo = def.min + step * span;
  return { def, division, progress: clamp((rating - lo) / span, 0, 1), next: Math.round(lo + span) };
}

export const ROMAN = ['', 'I', 'II', 'III'] as const;

/** True if `after` is a higher tier/division than `before`. */
export function promoted(before: number, after: number): boolean {
  const a = tierOf(before);
  const b = tierOf(after);
  const ia = TIERS.indexOf(a.def);
  const ib = TIERS.indexOf(b.def);
  return ib > ia || (ib === ia && b.division !== 0 && b.division < a.division);
}

/** Soft reset at a new season. */
export const seasonReset = (rating: number) => Math.round(START_RATING + (rating - START_RATING) * 0.5);

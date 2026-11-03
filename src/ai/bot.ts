import { DIRECTIONS, other, type Cell, type Move, type Player } from '../core/types';
import { Shape, shapeOfCode } from './patterns';
import { SearchBoard } from './searchBoard';

export type Level = 'easy' | 'medium' | 'hard';

export interface BotRequest {
  moves: Move[];
  player: Player;
  level: Level;
  /** soft time budget in ms for hard search */
  timeMs?: number;
  seed?: number;
}

export interface BotReply {
  move: Cell;
  /** debugging / UI info */
  reason: 'first' | 'win' | 'block' | 'vcf' | 'anti-vcf' | 'search' | 'greedy' | 'random';
  score?: number;
  depth?: number;
}

/* ------------------------------------------------------------------ scoring */

const SHAPE_SCORE = [0, 12, 70, 90, 900, 1000, 60_000, 10_000_000];
const WIN = 10_000_000;

/** How good is it for `p` to stand on (x, y)? Combines the 4 directions. */
export function attackScore(b: SearchBoard, x: number, y: number, p: Player): number {
  const s = b.shapes(x, y, p);
  let fours = 0,
    threes = 0,
    sum = 0;
  for (const v of s) {
    if (v === Shape.Five) return WIN;
    if (v === Shape.OpenFour) return 100_000;
    if (v === Shape.Four) fours++;
    if (v === Shape.Three) threes++;
    sum += SHAPE_SCORE[v];
  }
  if (fours >= 2) return 90_000; // double four
  if (fours && threes) return 40_000; // four-three
  if (threes >= 2) return 15_000; // double open three
  return sum;
}

interface Scored extends Cell {
  atk: number;
  def: number;
  score: number;
}

export function scoreCandidates(b: SearchBoard, me: Player, defWeight = 1.35): Scored[] {
  const opp = other(me);
  const out: Scored[] = [];
  for (const c of b.candidates()) {
    const atk = attackScore(b, c.x, c.y, me);
    const def = attackScore(b, c.x, c.y, opp);
    out.push({ ...c, atk, def, score: atk + def * defWeight });
  }
  out.sort((a, z) => z.score - a.score);
  return out;
}

/* ------------------------------------------------------------- RNG helpers */

function makeRng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------- VCF */

/**
 * Victory by Continuous Fours: a sequence of moves, each making a four
 * (forcing a single reply), ending in an unstoppable position.
 * Returns the first move or null. Conservative: if a forced block gives the
 * defender a four of their own, that branch is abandoned.
 */
export function findVcf(b: SearchBoard, me: Player, maxDepth = 12, timeMs = 150): Cell | null {
  const opp = other(me);
  const deadline = performance.now() + timeMs;
  let nodes = 0;

  const rec = (depth: number): Cell | null => {
    if (depth === 0 || ((++nodes & 31) === 0 && performance.now() > deadline)) return null;
    for (const c of b.candidates()) {
      const s = b.shapes(c.x, c.y, me);
      const best = Math.max(...s);
      if (best === Shape.Five && b.wouldWin(c.x, c.y, me)) return c;
      if (best < Shape.Four) continue;

      b.place(c.x, c.y, me);
      const wins = b.winPointsAround(c.x, c.y, me);
      let ok = false;
      if (wins.length >= 2) ok = true;
      else if (wins.length === 1) {
        const w = wins[0];
        b.place(w.x, w.y, opp);
        const counter = b.winPointsAround(w.x, w.y, opp);
        if (counter.length === 0) ok = rec(depth - 1) !== null;
        b.undo();
      }
      b.undo();
      if (ok) return c;
    }
    return null;
  };

  // Do not start a VCF when the opponent already has a winning point.
  return rec(maxDepth);
}

/** Every immediate winning point for `p` anywhere on the board. */
function winningPoints(b: SearchBoard, p: Player): Cell[] {
  return b.candidates().filter((c) => b.wouldWin(c.x, c.y, p));
}

/* ------------------------------------------------------------ static eval */

// Value of an existing run (by its shape) for the evaluation function.
const RUN_VALUE = [0, 4, 30, 40, 700, 500, 40_000, WIN];

/**
 * Sum of run shapes for both players, from `me`'s point of view (me to move).
 * Each run is counted once per direction, at its first stone.
 */
export function evalBoard(b: SearchBoard, me: Player): number {
  let mine = 0,
    theirs = 0;
  for (const m of b.history) {
    for (const [dx, dy] of DIRECTIONS) {
      if (b.get(m.x - dx, m.y - dy) === m.p) continue; // not the first stone of this run
      const v = RUN_VALUE[shapeOfCode(b.lineCode(m.x, m.y, dx, dy, m.p))];
      if (m.p === me) mine += v;
      else theirs += v;
    }
  }
  return mine * 1.15 - theirs;
}

/**
 * Can one stone stop all of these opponent threat points? Heuristic: they all
 * lie on one line within a 6-cell span (a single open three's two ends do).
 */
function blockableByOne(pts: Cell[]): boolean {
  if (pts.length <= 1) return true;
  const a = pts[0];
  return pts.every((p) => {
    const dx = p.x - a.x,
      dy = p.y - a.y;
    const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    return aligned && Math.max(Math.abs(dx), Math.abs(dy)) <= 5;
  });
}

/** evalBoard + tempo: the side to move cashes in its threats first. */
function leafEval(b: SearchBoard, me: Player, cands: Scored[]): number {
  let myAtk = 0;
  const threats: Cell[] = [];
  for (const c of cands) {
    if (c.atk > myAtk) myAtk = c.atk;
    if (c.def >= 40_000) threats.push(c);
  }
  let bonus = 0;
  if (myAtk >= 100_000) bonus = 300_000; // I can make an open / double four now
  else if (myAtk >= 40_000) bonus = 150_000; // four-three
  else if (myAtk < 1000 && !blockableByOne(threats)) bonus = -150_000; // two separate threats, nothing forcing
  return evalBoard(b, me) + bonus;
}

/* ------------------------------------------------------------ alpha-beta */

class Timeout extends Error {}

function negamax(
  b: SearchBoard,
  me: Player,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  deadline: number,
  width: number,
  stats: { n: number },
): number {
  if ((++stats.n & 15) === 0 && performance.now() > deadline) throw new Timeout();
  const opp = other(me);
  const cands = scoreCandidates(b, me);
  if (!cands.length) return 0;
  if (cands.some((c) => c.atk >= WIN)) return WIN - ply;

  const oppWins = cands.filter((c) => c.def >= WIN);
  if (oppWins.length >= 2) return -(WIN - ply - 1);

  // Quiescence: a forced block at the horizon is searched, not evaluated
  // (otherwise chains of fours push real threats out of sight).
  if (depth <= 0 && (oppWins.length !== 1 || ply > 18)) return leafEval(b, me, cands);

  const moves = oppWins.length === 1 ? oppWins : cands.slice(0, width);
  let best = -Infinity;
  for (const m of moves) {
    b.place(m.x, m.y, me);
    let v: number;
    try {
      v = -negamax(b, opp, Math.max(0, depth - 1), -beta, -alpha, ply + 1, deadline, Math.max(6, width - 2), stats);
    } finally {
      b.undo();
    }
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchBest(
  b: SearchBoard,
  me: Player,
  timeMs: number,
  maxDepth: number,
  rng: () => number,
  rootMoves?: Scored[],
) {
  const deadline = performance.now() + timeMs;
  const opp = other(me);
  let order = rootMoves ?? scoreCandidates(b, me).slice(0, 14);
  let bestMove: Cell = order[0];
  let bestScore = -Infinity;
  let reached = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const results: { m: Scored; v: number }[] = [];
      let alpha = -Infinity;
      const stats = { n: 0 };
      for (const m of order) {
        if (depth > 1 && performance.now() > deadline) throw new Timeout();
        b.place(m.x, m.y, me);
        let v: number;
        try {
          v = -negamax(b, opp, depth - 1, -Infinity, -alpha, 1, deadline, 10, stats);
        } finally {
          b.undo();
        }
        results.push({ m, v });
        if (v > alpha) alpha = v;
      }
      results.sort((a, z) => z.v - a.v);
      // Everything loses (often a pruning artefact): keep the most solid heuristic move.
      if (results[0].v <= -WIN / 2) {
        if (depth === 1) bestMove = order[0];
        break;
      }
      const top = results.filter((r) => r.v >= results[0].v - 1);
      const pick = top[Math.floor(rng() * top.length)];
      bestMove = pick.m;
      bestScore = pick.v;
      reached = depth;
      order = results.map((r) => r.m);
      if (Math.abs(bestScore) > WIN / 2) break;
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
  }
  return { move: { x: bestMove.x, y: bestMove.y }, score: bestScore, depth: reached };
}

/* ------------------------------------------------------------ entry point */

export function chooseMove(req: BotRequest): BotReply {
  const rng = makeRng(req.seed);
  const me = req.player;
  const opp = other(me);
  const b = new SearchBoard(req.moves);

  if (b.stoneCount === 0) return { move: { x: 0, y: 0 }, reason: 'first' };
  if (b.stoneCount === 1) {
    const s = req.moves[0];
    const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]];
    const [dx, dy] = dirs[Math.floor(rng() * (req.level === 'hard' ? 4 : dirs.length))];
    return { move: { x: s.x + dx, y: s.y + dy }, reason: 'first' };
  }

  const level = req.level;
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

  // 1. Take an immediate win.
  const myWins = winningPoints(b, me);
  const winChance = level === 'easy' ? 0.7 : 1;
  if (myWins.length && rng() < winChance) return { move: pick(myWins), reason: 'win' };

  // 2. Block an immediate loss.
  const oppWins = winningPoints(b, opp);
  const blockChance = level === 'easy' ? 0.55 : 1;
  if (oppWins.length && rng() < blockChance) return { move: pick(oppWins), reason: 'block' };

  if (level === 'easy') {
    // Short-sighted: values its own shapes, defends weakly, and often picks a
    // merely "decent" move instead of the best one.
    const cands = scoreCandidates(b, me, 0.5).slice(0, 8);
    if (rng() < 0.45) return { move: pick(cands.slice(0, 2)), reason: 'greedy' };
    return { move: pick(cands), reason: 'random' };
  }

  if (level === 'medium') {
    const cands = scoreCandidates(b, me, 1.4);
    const top = cands.filter((c) => c.score >= cands[0].score * 0.95).slice(0, 3);
    // Occasionally plays a looser move, but never while facing a real threat.
    const urgent = cands[0].def >= 900 || cands[0].atk >= 900;
    const choice = !urgent && rng() < 0.2 ? pick(cands.slice(0, 5)) : pick(top);
    return { move: choice, reason: 'greedy', score: choice.score };
  }

  // HARD
  if (!oppWins.length) {
    const vcf = findVcf(b, me);
    if (vcf) return { move: vcf, reason: 'vcf' };
  }

  // If the opponent has a forced win by fours, find a move that breaks it.
  // If the opponent has a forced win by fours, only consider moves that break it.
  let rootMoves: Scored[] | undefined;
  const oppVcf = oppWins.length ? null : findVcf(b, opp, 10, 120);
  if (oppVcf) {
    const defenders = scoreCandidates(b, me).slice(0, 12);
    rootMoves = defenders.filter((d) => {
      b.place(d.x, d.y, me);
      const breaks = winningPoints(b, me).length > 0 || !findVcf(b, opp, 10, 25);
      b.undo();
      return breaks;
    });
    if (!rootMoves.length) rootMoves = undefined; // lost anyway: play the best-looking move
  }

  const res = searchBest(b, me, req.timeMs ?? 900, 6, rng, rootMoves);
  return { move: res.move, reason: rootMoves ? 'anti-vcf' : 'search', score: res.score, depth: res.depth };
}

/** Rough "who is better" from `p`'s view (used to decide draw offers). */
export function evaluate(moves: Move[], p: Player): number {
  const b = new SearchBoard(moves);
  const cands = scoreCandidates(b, p);
  let mine = 0,
    theirs = 0;
  for (const c of cands.slice(0, 20)) {
    mine = Math.max(mine, c.atk);
    theirs = Math.max(theirs, c.def);
  }
  return mine - theirs;
}

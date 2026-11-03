import { describe, expect, it } from 'vitest';
import { expected, kFactor, pairMultiplier, promoted, ratingDelta, seasonReset, tierOf } from '../src/core/elo';

describe('elo', () => {
  it('expected score is symmetric and clamped', () => {
    expect(expected(1000, 1000)).toBe(0.5);
    expect(expected(1200, 1000) + expected(1000, 1200)).toBeCloseTo(1);
    expect(expected(3000, 1000)).toBe(0.94);
    expect(expected(1000, 3000)).toBe(0.06);
  });

  it('K: placement 40, then 24, 16 at the top', () => {
    expect(kFactor(0, 1000)).toBe(40);
    expect(kFactor(25, 1500)).toBe(24);
    expect(kFactor(25, 2200)).toBe(16);
  });

  it('even match: +20 / -20 during placement, draw 0', () => {
    expect(ratingDelta(1000, 1000, 'w', 0)).toBe(20);
    expect(ratingDelta(1000, 1000, 'l', 0)).toBe(-20);
    expect(ratingDelta(1000, 1000, 'd', 0)).toBe(0);
  });

  it('beating a stronger player is worth more; win never loses points', () => {
    expect(ratingDelta(1000, 1300, 'w', 30)).toBeGreaterThan(ratingDelta(1300, 1000, 'w', 30));
    expect(ratingDelta(2500, 900, 'w', 30)).toBeGreaterThanOrEqual(0);
    expect(ratingDelta(900, 2500, 'l', 30)).toBeLessThanOrEqual(0);
  });

  it('rating floor and farming multiplier', () => {
    expect(100 + ratingDelta(100, 1000, 'l', 30)).toBe(100);
    expect(pairMultiplier(0)).toBe(1);
    expect(pairMultiplier(3)).toBe(0.5);
    expect(pairMultiplier(5)).toBe(0);
    expect(ratingDelta(1000, 1000, 'w', 0, 0)).toBe(0);
  });

  it('tiers and divisions', () => {
    expect(tierOf(1000).def.id).toBe('bronze');
    expect(tierOf(1099).division).toBe(1);
    expect(tierOf(1100)).toMatchObject({ division: 3 });
    expect(tierOf(1100).def.id).toBe('silver');
    expect(tierOf(1950).def.id).toBe('master');
    expect(tierOf(2200).def.id).toBe('grandmaster');
    expect(tierOf(2200, 10).def.id).toBe('challenger');
    expect(tierOf(2200, 80).def.id).toBe('grandmaster');
    expect(promoted(1090, 1110)).toBe(true); // bronze -> silver
    expect(promoted(1100, 1170)).toBe(true); // silver III -> II
    expect(promoted(1170, 1100)).toBe(false);
  });

  it('season soft reset halves the distance to 1000', () => {
    expect(seasonReset(1600)).toBe(1300);
    expect(seasonReset(800)).toBe(900);
  });
});

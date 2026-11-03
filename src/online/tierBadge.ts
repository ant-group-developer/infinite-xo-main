import { ROMAN, tierOf, type Tier } from '../core/elo';
import { ot, type OKey } from './strings';

export const tierName = (t: Tier) => `${ot(`tier.${t.def.id}` as OKey)}${t.division ? ' ' + ROMAN[t.division] : ''}`;

/** Inline tier pill: "🥈 Bạc II". */
export function tierBadge(rating: number, rank?: number, small = false): string {
  const t = tierOf(rating, rank);
  return `<span class="tier${small ? ' sm' : ''}" style="--tc:${t.def.color}">${t.def.icon} ${tierName(t)}</span>`;
}

/** Big card with progress to the next division. */
export function tierCard(rating: number, rank?: number): string {
  const t = tierOf(rating, rank);
  const nextTier = t.next !== null ? tierOf(t.next) : null;
  const pct = Math.round(t.progress * 100);
  return `<div class="tier-card" style="--tc:${t.def.color}">
    <div class="tc-icon">${t.def.icon}</div>
    <div class="tc-main">
      <b>${tierName(t)}</b>
      <span class="tc-rating">${rating}</span>
      <div class="tc-bar"><i style="width:${pct}%"></i></div>
      <small>${nextTier && t.next !== null ? ot('rank.next', { n: t.next - rating, tier: tierName(nextTier) }) : ot('rank.top')}</small>
    </div>
  </div>`;
}

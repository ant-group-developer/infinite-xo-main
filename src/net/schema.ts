/** Shapes of the data stored in the realtime database (mirrors database.rules.json). */

export interface UserProfile {
  name: string;
  avatar: number;
  country: string;
  createdAt: number;
  linked: boolean;
}

export interface PlayerStats {
  rating: number;
  games: number;
  w: number;
  l: number;
  d: number;
  streak: number;
  bestStreak: number;
  peak: number;
  season: number;
  /** denormalised for the leaderboard query */
  name: string;
  avatar: number;
  country: string;
}

export const START_RATING = 1000;
export const CURRENT_SEASON = 1;

export const freshStats = (p: Pick<UserProfile, 'name' | 'avatar' | 'country'>): PlayerStats => ({
  rating: START_RATING,
  games: 0,
  w: 0,
  l: 0,
  d: 0,
  streak: 0,
  bestStreak: 0,
  peak: START_RATING,
  season: CURRENT_SEASON,
  name: p.name,
  avatar: p.avatar,
  country: p.country,
});

export const AVATARS = [
  '🦊', '🐼', '🐯', '🐸', '🐙', '🦄', '🐲', '🦉',
  '🐺', '🐧', '🐨', '🦁', '🐵', '🐰', '🐻', '🐮',
  '🦖', '🐬', '🦋', '🐝', '🦀', '🐢', '🦜', '🐳',
  '👾', '🤖', '👻', '🎃', '⭐', '🔥', '⚡', '🍀',
];

export const avatarOf = (i: number) => AVATARS[((i % AVATARS.length) + AVATARS.length) % AVATARS.length];

export const COUNTRIES = [
  'VN', 'US', 'GB', 'JP', 'KR', 'CN', 'TW', 'HK', 'TH', 'ID', 'MY', 'SG', 'PH', 'IN',
  'AU', 'CA', 'FR', 'DE', 'ES', 'IT', 'NL', 'PL', 'RU', 'UA', 'TR', 'BR', 'MX', 'AR',
];

/** Regional-indicator emoji flag from an ISO country code. */
export const flagOf = (cc: string) =>
  /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🏳️';

export function guessCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && COUNTRIES.includes(region)) return region;
  } catch {
    /* ignore */
  }
  return 'VN';
}

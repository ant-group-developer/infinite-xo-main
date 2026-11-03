import type { Level } from './bot';

/**
 * Bot opponents used by matchmaking when nobody else is searching.
 * They look like regular players: name, avatar, country, rating close to the
 * human's. Personas are generated deterministically so a persona id always
 * maps to the same identity.
 */
export interface Persona {
  id: string; // "bot:<n>"
  name: string;
  avatar: number;
  country: string;
}

const VN_NAMES = [
  'Minh Khôi', 'Bảo Ngọc', 'Tuấn Anh', 'Thu Hà', 'Quốc Bảo', 'Gia Huy', 'Ngọc Ánh', 'Hoàng Long', 'Khánh Linh', 'Đức Thịnh',
  'Phương Thảo', 'Minh Thư', 'Anh Khoa', 'Thanh Tâm', 'Hải Đăng', 'Mai Anh', 'Trung Kiên', 'Yến Nhi', 'Tiến Đạt', 'Hà My',
  'Nhật Nam', 'Quỳnh Anh', 'Văn Toàn', 'Thùy Linh', 'Đăng Khoa', 'Bích Ngọc', 'Hữu Phước', 'Diệu Linh', 'Công Minh', 'Tường Vy',
];
const VN_TAGS = [
  'khoa_pro', 'minhcaro', 'linhxinh', 'tuananh99', 'baongoc2k5', 'huyhoang', 'long.vu', 'thao_nguyen', 'nam1102', 'ductrong',
  'caro_master', 'xo.king', 'boy_pho_nui', 'meo_con', 'hanhbeo', 'quangvinh', 'phuongpham', 'thanhnhan', 'datnguyen', 'trang2k3',
];
const INTL = [
  ['Alex', 'US'], ['Mia', 'US'], ['Ethan', 'CA'], ['Olivia', 'GB'], ['Lucas', 'BR'], ['Sofia', 'MX'], ['Yuki', 'JP'], ['Haruto', 'JP'],
  ['Minjun', 'KR'], ['Jiwoo', 'KR'], ['Wei', 'CN'], ['Lin', 'TW'], ['Arjun', 'IN'], ['Priya', 'IN'], ['Somchai', 'TH'], ['Nok', 'TH'],
  ['Budi', 'ID'], ['Siti', 'ID'], ['Aiman', 'MY'], ['Joshua', 'PH'], ['Lena', 'DE'], ['Hugo', 'FR'], ['Elena', 'ES'], ['Marco', 'IT'],
  ['Daan', 'NL'], ['Oskar', 'PL'], ['Ivan', 'RU'], ['Emre', 'TR'], ['Mateo', 'AR'], ['Chloe', 'AU'],
] as const;
const SUFFIX = ['', '', '', '7', '99', '_x', 'xo', '23', '2k', 'GG', '11', '_vn'];

let cache: Persona[] | null = null;

function rngFrom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function personas(): Persona[] {
  if (cache) return cache;
  const rnd = rngFrom(20261103);
  const out: Persona[] = [];
  const add = (name: string, country: string) =>
    out.push({ id: `bot:${out.length}`, name: name.slice(0, 16), avatar: Math.floor(rnd() * 24), country });
  for (const n of VN_NAMES) add(n, 'VN');
  for (const t of VN_TAGS) add(t, 'VN');
  for (const [n, c] of INTL) add(n + SUFFIX[Math.floor(rnd() * SUFFIX.length)], c);
  // A second wave of tags mixing parts, so lists feel varied.
  for (let i = 0; i < 60; i++) {
    const base = VN_TAGS[Math.floor(rnd() * VN_TAGS.length)].split(/[._]/)[0];
    add(`${base}${Math.floor(rnd() * 900 + 100)}`, rnd() < 0.85 ? 'VN' : INTL[Math.floor(rnd() * INTL.length)][1]);
  }
  cache = out;
  return out;
}

export const personaById = (id: string) => personas().find((p) => p.id === id) ?? null;

/** A persona the player has not met recently, with a rating near theirs. */
export function pickPersona(playerRating: number, recent: string[] = [], rnd = Math.random) {
  const list = personas().filter((p) => !recent.includes(p.id));
  const p = list[Math.floor(rnd() * list.length)] ?? personas()[0];
  const rating = Math.max(100, Math.round(playerRating + (rnd() * 2 - 1) * 60));
  return { persona: p, rating };
}

/**
 * How strong a bot of a given rating plays. Mixing levels per move gives
 * in-between strengths. Calibrate with `npm run bench` when tuning.
 */
export function botStyle(rating: number, rnd = Math.random): { level: Level; timeMs: number } {
  if (rating < 1100) return { level: 'easy', timeMs: 100 };
  if (rating < 1300) return { level: rnd() < 0.5 ? 'easy' : 'medium', timeMs: 120 };
  if (rating < 1500) return { level: 'medium', timeMs: 150 };
  if (rating < 1700) return rnd() < 0.7 ? { level: 'medium', timeMs: 150 } : { level: 'hard', timeMs: 150 };
  if (rating < 1900) return { level: 'hard', timeMs: 300 };
  return { level: 'hard', timeMs: 700 };
}

/** Human-looking thinking time for the bot's next move (ms). */
export function thinkTime(moveNo: number, forced: boolean, rnd = Math.random): number {
  if (moveNo < 2) return 1500 + rnd() * 2000;
  if (forced) return 1800 + rnd() * 2500;
  const long = rnd() < 0.08;
  if (long) return 12000 + rnd() * 10000;
  if (moveNo < 8) return 2000 + rnd() * 3500;
  return 3000 + rnd() * 9000;
}

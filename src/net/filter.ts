/**
 * Very small profanity / abuse filter for names and chat.
 * Not meant to be complete – just the obvious cases. Matching is on whole
 * words and ignores case + Vietnamese diacritics, so "ĐỊT" and "dit" both match.
 */
const WORDS = [
  // vi – only unambiguous forms: folding diacritics turns common words
  // (các, lớn, buổi, đeo…) into lookalikes, so those are deliberately absent.
  'dit', 'dm', 'dmm', 'dcm', 'dkm', 'vcl', 'vkl', 'clm', 'cmm', 'dit me', 'du ma', 'deo me',
  // en
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'asshole',
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

const tokenRe = new RegExp(`(^|[^a-z0-9])(${WORDS.map((w) => w.replace(/ /g, '[^a-z0-9]*')).join('|')})(?=$|[^a-z0-9])`, 'g');

export function hasProfanity(s: string): boolean {
  tokenRe.lastIndex = 0;
  return tokenRe.test(fold(s));
}

/** Replace offending words with ***, keeping the rest of the message. */
export function cleanText(s: string): string {
  const folded = fold(s);
  if (folded.length !== s.length) {
    // Diacritics changed the length (rare) – fall back to whole-message masking.
    return hasProfanity(s) ? '***' : s;
  }
  let out = s;
  tokenRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(folded))) {
    const start = m.index + m[1].length;
    const len = m[2].length;
    out = out.slice(0, start) + '*'.repeat(len) + out.slice(start + len);
  }
  return out;
}

export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Returns an error key or null if the display name is acceptable. */
export function validateName(raw: string): 'short' | 'long' | 'chars' | 'bad' | null {
  const name = raw.trim();
  if (name.length < NAME_MIN) return 'short';
  if (name.length > NAME_MAX) return 'long';
  if (/[\u0000-\u001f<>]/.test(name)) return 'chars';
  if (hasProfanity(name)) return 'bad';
  return null;
}

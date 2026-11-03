const svg = (body: string, vb = '0 0 24 24') => `<svg class="ic" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const S = 'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"';

export const icons = {
  soundOn: svg(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" ${S}/>`),
  soundOff: svg(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" ${S}/>`),
  help: svg(`<circle cx="12" cy="12" r="9" ${S}/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8" ${S}/><circle cx="12" cy="17.3" r="1.3" fill="currentColor"/>`),
  stats: svg(`<path d="M5 20V12M12 20V5M19 20v-6" ${S}/>`),
  undo: svg(`<path d="M9 7 4.5 11.5 9 16" ${S}/><path d="M5 11.5h9a5 5 0 0 1 0 10h-3" ${S}/>`),
  hint: svg(`<path d="M9 18h6M10 21h4" ${S}/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" ${S}/>`),
  flag: svg(`<path d="M5 21V4" ${S}/><path d="M5 4h11l-2.5 4L16 12H5" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  handshake: svg(`<path d="M2.5 11 6 7.5l3 1.5 3-2 3 2 3-1.5 3.5 3.5" ${S}/><path d="M6 12.5l4 4c.6.6 1.5.6 2 0l.6-.6M9 14l2.5 2.5M8 10.5l3.5-2.5 4.5 4.5c.5.5.5 1.3 0 1.8s-1.3.5-1.8 0" ${S}/>`),
  refresh: svg(`<path d="M20 11a8 8 0 1 0-2.3 5.7" ${S}/><path d="M20 4v7h-7" ${S}/>`),
  target: svg(`<circle cx="12" cy="12" r="7" ${S}/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" ${S}/>`),
  plus: svg(`<path d="M12 5v14M5 12h14" ${S}/>`),
  minus: svg(`<path d="M5 12h14" ${S}/>`),
  bot: svg(`<rect x="4" y="7.5" width="16" height="12" rx="4" ${S}/><path d="M12 7.5V4" ${S}/><circle cx="12" cy="3.2" r="1.3" fill="currentColor"/><circle cx="9" cy="13.5" r="1.6" fill="currentColor"/><circle cx="15" cy="13.5" r="1.6" fill="currentColor"/>`),
  users: svg(`<circle cx="8.5" cy="8.5" r="3.3" ${S}/><path d="M2.5 19.5a6 6 0 0 1 12 0" ${S}/><circle cx="16.5" cy="7.5" r="2.7" ${S}/><path d="M16 13.2a5 5 0 0 1 5.5 5.3" ${S}/>`),
  swap: svg(`<path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20M20.5 16.5H7" ${S}/>`),
  globe: svg(`<circle cx="12" cy="12" r="9" ${S}/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9" ${S}/>`),
  trophy: svg(`<path d="M7 4h10v5a5 5 0 0 1-10 0z" ${S}/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v3.5M8 20.5h8M9.5 17.5h5v3h-5z" ${S}/>`),
};

/** Neon X / O mark for HUD cards. */
export const mark = (p: 'X' | 'O') =>
  p === 'X'
    ? `<svg class="mark mx" viewBox="0 0 100 100" aria-hidden="true"><path d="M26 26L74 74M74 26L26 74"/></svg>`
    : `<svg class="mark mo" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="27"/></svg>`;

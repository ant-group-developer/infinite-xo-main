// Security-rules smoke test against the REAL Firebase project (no emulator needed).
//
//   1. Fill .env.local (see .env.example) and enable Anonymous sign-in.
//   2. Deploy the rules:  npm run rules:deploy
//   3. Run:               npm run rules:smoke
//
// Two anonymous users ("A", "B") try legal actions (must be ALLOWED) and
// cheats (must be DENIED). Everything is written under a throw-away room and
// cleaned up at the end. Exit code 1 if any expectation fails.
import { readFileSync } from 'node:fs';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { get, getDatabase, goOffline, ref, remove, serverTimestamp, set, update } from 'firebase/database';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*VITE_FIREBASE_/.test(l))
    .map((l) => l.split('=').map((x) => x.trim()))
    .map(([k, ...v]) => [k.replace('VITE_FIREBASE_', ''), v.join('=')]),
);
const cfg = {
  apiKey: env.API_KEY,
  authDomain: env.AUTH_DOMAIN,
  databaseURL: env.DATABASE_URL,
  projectId: env.PROJECT_ID,
  appId: env.APP_ID,
};
if (!cfg.apiKey || !cfg.databaseURL) {
  console.error('Missing VITE_FIREBASE_API_KEY / VITE_FIREBASE_DATABASE_URL in .env.local');
  process.exit(2);
}

async function user(name) {
  const app = initializeApp(cfg, name);
  const cred = await signInAnonymously(getAuth(app));
  return { app, db: getDatabase(app), uid: cred.user.uid };
}

let failed = 0;
async function expect(label, shouldAllow, fn) {
  let allowed = true;
  let err = '';
  try {
    await fn();
  } catch (e) {
    allowed = false;
    err = e.code || e.message;
  }
  const ok = allowed === shouldAllow;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${shouldAllow ? 'allow' : 'deny '}  ${label}${!ok && err ? `  (${err})` : ''}`);
}

const A = await user('A');
const B = await user('B');
const TS = serverTimestamp();
const profile = (name) => ({ name, avatar: 1, country: 'VN', createdAt: TS, linked: false });
const stats = (name) => ({ rating: 1000, games: 0, w: 0, l: 0, d: 0, streak: 0, bestStreak: 0, peak: 1000, season: 1, name, avatar: 1, country: 'VN' });

console.log(`A=${A.uid}  B=${B.uid}\n`);

// ---------------------------------------------------------------- profiles
await expect('A creates own profile', true, () => set(ref(A.db, `users/${A.uid}`), profile('SmokeA')));
await expect('B creates own profile', true, () => set(ref(B.db, `users/${B.uid}`), profile('SmokeB')));
await expect('A writes B profile', false, () => set(ref(A.db, `users/${B.uid}/name`), 'Hacked'));
await expect('A creates stats at 1000', true, () => set(ref(A.db, `stats/${A.uid}`), stats('SmokeA')));
await expect('B creates stats at 1000', true, () => set(ref(B.db, `stats/${B.uid}`), stats('SmokeB')));
await expect('A sets own rating to 3000', false, () => set(ref(A.db, `stats/${A.uid}/rating`), 3000));
await expect('A creates stats for B', false, () => set(ref(A.db, `stats/${B.uid}x`), stats('Nope')));

// ------------------------------------------------------------------- room
const rid = `smoke${Date.now()}`;
const code = `S${Math.random().toString(36).slice(2, 7).toUpperCase()}`.slice(0, 6).padEnd(6, 'Z');
const member = (name) => ({ name, avatar: 1, country: 'VN', rating: 1000, joinedAt: TS });
await expect('A reserves room code', true, () => set(ref(A.db, `roomCodes/${code}`), rid));
await expect('A creates room (host)', true, () =>
  update(ref(A.db), {
    [`rooms/${rid}/meta`]: { hostUid: A.uid, name: 'smoke', visibility: 'private', code, type: 'casual', createdAt: TS, lastActive: TS, status: 'waiting' },
    [`rooms/${rid}/members/${A.uid}`]: member('SmokeA'),
  }),
);
await expect('B joins as member', true, () => set(ref(B.db, `rooms/${rid}/members/${B.uid}`), member('SmokeB')));
await expect('B joins with fake rating 2500', false, () => set(ref(B.db, `rooms/${rid}/members/${B.uid}/rating`), 2500));
await expect('A sits X', true, () => set(ref(A.db, `rooms/${rid}/slots/X`), A.uid));
await expect('B steals seat X', false, () => set(ref(B.db, `rooms/${rid}/slots/X`), B.uid));
await expect('B sits O', true, () => set(ref(B.db, `rooms/${rid}/slots/O`), B.uid));
await expect('B changes room name (not host)', false, () => set(ref(B.db, `rooms/${rid}/meta/name`), 'pwned'));
await expect('B kicks A (not host)', false, () => set(ref(B.db, `rooms/${rid}/kicked/${A.uid}`), true));

// ------------------------------------------------------------------- game
const info = (uid, name) => ({ uid, name, avatar: 1, country: 'VN', rating: 1000 });
await expect('B starts the game (not host)', false, () =>
  set(ref(B.db, `games/${rid}`), { seq: 1, type: 'casual', players: { X: info(A.uid, 'SmokeA'), O: info(B.uid, 'SmokeB') }, startedAt: TS, n: 0, turn: 'X', turnStart: TS }),
);
await expect('A (host) starts the game', true, () =>
  update(ref(A.db), {
    [`games/${rid}`]: { seq: 1, type: 'casual', players: { X: info(A.uid, 'SmokeA'), O: info(B.uid, 'SmokeB') }, startedAt: TS, n: 0, turn: 'X', turnStart: TS },
    [`rooms/${rid}/meta/status`]: 'playing',
  }),
);
const move = (u, n, x, y, p, extra = {}) =>
  update(ref(u.db), {
    [`games/${rid}/moves/${n}`]: { x, y, p, t: TS },
    [`games/${rid}/board/${x}_${y}`]: p,
    [`games/${rid}/n`]: n + 1,
    [`games/${rid}/turn`]: p === 'X' ? 'O' : 'X',
    [`games/${rid}/turnStart`]: TS,
    ...extra,
  });
await expect('B moves first (not his turn)', false, () => move(B, 0, 5, 5, 'O'));
await expect('A plays X at 0,0', true, () => move(A, 0, 0, 0, 'X'));
await expect('A plays again (not her turn)', false, () => move(A, 1, 1, 0, 'X'));
await expect('B plays on an occupied cell', false, () => move(B, 1, 0, 0, 'O'));
await expect('B plays O at 0,5', true, () => move(B, 1, 0, 5, 'O'));
await expect('A claims a fake five', false, () =>
  move(A, 2, 1, 0, 'X', { [`games/${rid}/result`]: { winner: 'X', reason: 'five', line: { sx: 0, sy: 0, dx: 1, dy: 0, len: 5 }, at: TS } }),
);
await expect('A plays X at 1,0', true, () => move(A, 2, 1, 0, 'X'));
await expect('A claims timeout before 2 minutes', false, () => set(ref(A.db, `games/${rid}/result`), { winner: 'X', reason: 'timeout', at: TS }));
await expect('B resigns for A (wrong player)', false, () => set(ref(B.db, `games/${rid}/result`), { winner: 'O', reason: 'resign', at: TS }));
// Moves so far: 0:X(0,0) 1:O(0,5) 2:X(1,0). Build X's row 0..4 while O plays row 5.
await move(B, 3, 1, 5, 'O');
await move(A, 4, 2, 0, 'X');
await move(B, 5, 2, 5, 'O');
await move(A, 6, 3, 0, 'X');
await move(B, 7, 3, 5, 'O');
const n = 8;
await expect('A wins with a real five (rules re-check the line)', true, () =>
  move(A, n, 4, 0, 'X', { [`games/${rid}/result`]: { winner: 'X', reason: 'five', line: { sx: 0, sy: 0, dx: 1, dy: 0, len: 5 }, at: TS } }),
);
const res = await get(ref(A.db, `games/${rid}/result`));
console.log(`      result = ${JSON.stringify(res.val())}`);
await expect('B moves after the game is over', false, () => move(B, n + 1, 9, 9, 'O'));

// ----------------------------------------------------------------- chat
await expect('A chats', true, () => set(ref(A.db, `roomChat/${rid}/m1`), { uid: A.uid, name: 'SmokeA', text: 'gg', t: TS }));
await expect('B chats as A', false, () => set(ref(B.db, `roomChat/${rid}/m2`), { uid: A.uid, name: 'SmokeA', text: 'fake', t: TS }));

// -------------------------------------------------------------- cleanup
await expect('A (host) deletes the room', true, () =>
  update(ref(A.db), { [`rooms/${rid}`]: null, [`games/${rid}`]: null, [`roomChat/${rid}`]: null, [`roomCodes/${code}`]: null }),
);
await remove(ref(A.db, `users/${A.uid}`)).catch(() => {});
await remove(ref(B.db, `users/${B.uid}`)).catch(() => {});

console.log(`\n${failed ? `${failed} expectation(s) FAILED` : 'All rule checks passed'}`);
for (const u of [A, B]) {
  goOffline(u.db);
  await deleteApp(u.app);
}
process.exit(failed ? 1 : 0);

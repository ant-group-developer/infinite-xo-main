// Generates the rating-related security rules: /stats (rated updates), /matches,
// /history, /pairCount. Usage: node scripts/gen-rating-rules.cjs database.rules.json
//
// Trust chain on the Spark plan (no Cloud Functions):
//   games/{room}/result   — checked by rules (5-in-a-row re-verified on the board)
//   matches/{room_seq}    — must match that game (players, type, winner)
//   stats/{uid}           — may only change together with a new match record,
//                           by that record's claimer, by at most ±40, in the right
//                           direction, and once per match.
const fs = require('fs');
const rf = process.argv[2];
const r = JSON.parse(fs.readFileSync(rf, 'utf8'));

/* ------------------------------------------------------------- /stats */
const S = 'newData.parent()'; // the stats node after the write (from a field rule)
const O = 'data.parent()'; // before
const MID = `${S}.child('lastMatch').val()`;
const ROOT_NEW = `${S}.parent().parent()`;
const MREC = `${ROOT_NEW}.child('matches/' + ${MID})`;
const RATED = `(${S}.child('lastMatch').exists() && ${MID} !== ${O}.child('lastMatch').val() && ${MREC}.child('applied').val() === true && !root.child('matches/' + ${MID} + '/applied').exists() && root.child('matches/' + ${MID} + '/by/uid').val() === auth.uid && (${MREC}.child('players/X/uid').val() === $uid || ${MREC}.child('players/O/uid').val() === $uid))`;
const SIDE = `(${MREC}.child('players/X/uid').val() === $uid ? 'X' : 'O')`;
const OPP = `(${MREC}.child('players/X/uid').val() === $uid ? 'O' : 'X')`;
const WIN = `${MREC}.child('winner').val()`;
const RES_W = `(${WIN} === ${SIDE})`;
const RES_L = `(${MREC}.child('winner').exists() && ${WIN} !== ${SIDE})`;
const RES_D = `(!${MREC}.child('winner').exists())`;
const same = 'newData.val() === data.val()';
const plus1 = 'newData.val() === data.val() + 1';
const DAY = '((now - now % 86400000) / 86400000)';
const OPP_BOT = `(${MREC}.child('players/' + ${OPP} + '/bot').val() === true)`;

const stats = r.rules.stats;
stats.$uid['.write'] = `auth != null && (auth.uid === $uid || (root.child('matches/' + newData.child('lastMatch').val() + '/by/uid').val() === auth.uid && !root.child('matches/' + newData.child('lastMatch').val() + '/applied').exists()))`;
const created = (v) => `(!data.exists() && newData.val() === ${v})`;
stats.$uid.rating = {
  '.validate': `${created(1000)} || ${same} || (${RATED} && newData.isNumber() && newData.val() >= 100 && newData.val() - data.val() <= 40 && data.val() - newData.val() <= 40 && (!${RES_W} || newData.val() >= data.val()) && (!${RES_L} || newData.val() <= data.val()) && ${MREC}.child('players/' + ${SIDE} + '/after').val() === newData.val() && ${MREC}.child('players/' + ${SIDE} + '/before').val() === data.val() && (!${OPP_BOT} || ${S}.child('botToday').val() <= 15 || ${same}))`,
};
stats.$uid.games = { '.validate': `${created(0)} || ${same} || (${RATED} && ${plus1})` };
stats.$uid.w = { '.validate': `${created(0)} || ${same} || (${RATED} && ${RES_W} && ${plus1})` };
stats.$uid.l = { '.validate': `${created(0)} || ${same} || (${RATED} && ${RES_L} && ${plus1})` };
stats.$uid.d = { '.validate': `${created(0)} || ${same} || (${RATED} && ${RES_D} && ${plus1})` };
stats.$uid.streak = {
  '.validate': `${created(0)} || ${same} || (${RATED} && ((${RES_W} && ${plus1}) || (${RES_L} && newData.val() === 0)))`,
};
stats.$uid.bestStreak = {
  '.validate': `${created(0)} || ${same} || (${RATED} && newData.val() > data.val() && newData.val() === ${S}.child('streak').val())`,
};
stats.$uid.peak = {
  '.validate': `${created(1000)} || ${same} || (${RATED} && newData.val() > data.val() && newData.val() === ${S}.child('rating').val())`,
};
stats.$uid.lastMatch = { '.validate': `newData.isString() && (${same} || ${RATED})` };
stats.$uid.botDay = {
  '.validate': `newData.isNumber() && (${same} || (${RATED} && ${OPP_BOT} && newData.val() === ${DAY}))`,
};
stats.$uid.botToday = {
  '.validate': `newData.isNumber() && (${same} || (${RATED} && ${OPP_BOT} && (${S}.child('botDay').val() === ${O}.child('botDay').val() ? ${plus1} : newData.val() === 1)))`,
};

/* ----------------------------------------------------------- /matches */
const M = 'newData'; // at /matches/$mid
const G = `root.child('games/' + ${M}.child('room').val())`;
r.rules.matches = {
  '.read': 'auth != null',
  $mid: {
    by: {
      // claim (or take over a stale claim) to become the one who applies the result
      '.write': `auth != null && newData.child('uid').val() === auth.uid && newData.child('at').val() === now && (!data.exists() || (data.child('at').val() < now - 30000 && !data.parent().child('applied').exists()))`,
      '.validate': "newData.hasChildren(['uid', 'at'])",
    },
    '.write': `auth != null && !data.child('applied').exists() && data.child('by/uid').val() === auth.uid`,
    '.validate': `!newData.child('applied').exists() || (${M}.child('applied').val() === true && $mid === ${M}.child('room').val() + '_' + ${M}.child('seq').val() && ${G}.child('seq').val() === ${M}.child('seq').val() && ${G}.child('result').exists() && ${G}.child('type').val() === ${M}.child('type').val() && ${M}.child('type').val() !== 'casual' && ${G}.child('players/X/uid').val() === ${M}.child('players/X/uid').val() && ${G}.child('players/O/uid').val() === ${M}.child('players/O/uid').val() && ${G}.child('result/winner').val() === ${M}.child('winner').val() && ${G}.child('result/reason').val() === ${M}.child('reason').val())`,
  },
};

/* ----------------------------------------------------------- /history */
r.rules.history = {
  $uid: {
    '.read': 'auth != null',
    $mid: {
      '.write': `auth != null && !data.exists() && root.child('matches/' + $mid + '/by/uid').val() === auth.uid && !root.child('matches/' + $mid + '/applied').exists() && newData.parent().parent().parent().child('matches/' + $mid + '/applied').val() === true`,
      '.validate': "newData.hasChildren(['opp', 'oppRating', 'res', 'delta', 'after', 'at']) && newData.child('at').val() === now && newData.child('opp').val().length <= 16",
    },
  },
};

/* --------------------------------------------------------- /pairCount */
r.rules.pairCount = {
  $pair: {
    '.read': 'auth != null',
    $day: {
      '.write': 'auth != null',
      '.validate': 'newData.isNumber() && newData.val() === (data.exists() ? data.val() + 1 : 1)',
    },
  },
};

fs.writeFileSync(rf, JSON.stringify(r, null, 2) + '\n');
console.log('rules bytes', fs.statSync(rf).size);

// Generates the /games security rules (long expressions are easier to build in JS).
const fs = require('fs');
const rf = process.argv[2];
const r = JSON.parse(fs.readFileSync(rf, 'utf8'));

const G = "root.child('games/' + $rid";
const room = (p) => `root.child('rooms/' + $rid + '/${p}')`;
const roomNew = (p) => `newData.parent().parent().child('rooms/' + $rid + '/${p}')`;
const isBotHost = `(${room('meta/type')}.val() === 'bot' && ${room('meta/hostUid')}.val() === auth.uid)`;
const turnPlayerIsMe = `(${G} + '/players/' + ${G} + '/turn').val() + '/uid').val() === auth.uid || (${G} + '/players/' + ${G} + '/turn').val() + '/bot').val() === true && ${isBotHost}))`;
const noResult = `!${G} + '/result').exists()`;
const inTime = `now <= ${G} + '/turnStart').val() + 123000`;
const playerWrite = `auth != null && ${noResult} && ${turnPlayerIsMe} && ${inTime}`;

// Winning line check. `newData` is the result node; the board after the
// update is newData.parent().child('board/<x>_<y>').
const SX = "newData.child('line/sx').val()";
const SY = "newData.child('line/sy').val()";
const DX = "newData.child('line/dx').val()";
const DY = "newData.child('line/dy').val()";
const LEN = "newData.child('line/len').val()";
const B = (i) => `newData.parent().child('board/' + (${SX} + (${i}) * ${DX}) + '_' + (${SY} + (${i}) * ${DY})).val()`;
const W = "newData.child('winner').val()";
const OPP = `(${W} === 'X' ? 'O' : 'X')`;
const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  .map((i) => (i < 5 ? `${B(i)} === ${W}` : `(${LEN} <= ${i} || ${B(i)} === ${W})`))
  .join(' && ');
const before = B(-1);
const after = `newData.parent().child('board/' + (${SX} + ${LEN} * ${DX}) + '_' + (${SY} + ${LEN} * ${DY})).val()`;
const dirOk = `((${DX} === 1 && (${DY} === 0 || ${DY} === 1 || ${DY} === -1)) || (${DX} === 0 && ${DY} === 1))`;
const five = `newData.child('reason').val() === 'five' && ${W} === data.parent().child('turn').val() && ${dirOk} && ${LEN} >= 5 && ${LEN} <= 9 && ${cells} && ${before} !== ${W} && ${after} !== ${W} && !(${before} === ${OPP} && ${after} === ${OPP})`;
const timeout = `newData.child('reason').val() === 'timeout' && now > data.parent().child('turnStart').val() + 120000 && ${W} !== data.parent().child('turn').val() && (${W} === 'X' || ${W} === 'O')`;
const resign = `(newData.child('reason').val() === 'resign' || newData.child('reason').val() === 'abandon') && (${W} === 'X' || ${W} === 'O') && (data.parent().child('players/' + ${OPP} + '/uid').val() === auth.uid || (data.parent().child('players/' + ${OPP} + '/bot').val() === true && ${isBotHost}))`;
const draw = `newData.child('reason').val() === 'draw' && !newData.child('winner').exists() && data.parent().child('drawOffer').exists() && (data.parent().child('players/' + (data.parent().child('drawOffer').val() === 'X' ? 'O' : 'X') + '/uid').val() === auth.uid || (data.parent().child('players/' + (data.parent().child('drawOffer').val() === 'X' ? 'O' : 'X') + '/bot').val() === true && ${isBotHost}))`;
const roomGone = `(${room('meta/hostUid')}.val() === auth.uid || !${room('meta')}.exists() || ${room('meta/lastActive')}.val() < now - 1800000)`;

r.rules.games = {
  $rid: {
    '.read': 'auth != null',
    '.write': `auth != null && ((newData.exists() && ${roomNew('meta/hostUid')}.val() === auth.uid && newData.child('n').val() === 0 && !newData.child('moves').exists() && !newData.child('board').exists() && !newData.child('result').exists() && !newData.child('drawOffer').exists() && newData.child('turn').val() === 'X' && newData.child('seq').val() === (data.exists() ? data.child('seq').val() + 1 : 1) && newData.child('players/X/uid').val() === ${roomNew('slots/X')}.val() && newData.child('players/O/uid').val() === ${roomNew('slots/O')}.val()) || (!newData.exists() && ${roomGone}))`,
    '.validate': "newData.hasChildren(['seq', 'type', 'players', 'startedAt', 'n', 'turn', 'turnStart'])",
    seq: { '.validate': 'newData.isNumber()' },
    type: { '.validate': "newData.val() === 'casual' || newData.val() === 'ranked' || newData.val() === 'bot'" },
    players: {
      $side: {
        '.validate': "($side === 'X' || $side === 'O') && newData.hasChildren(['uid', 'name', 'avatar', 'country', 'rating'])",
        uid: { '.validate': 'newData.isString()' },
        name: { '.validate': 'newData.isString() && newData.val().length <= 16' },
        avatar: { '.validate': 'newData.isNumber()' },
        country: { '.validate': 'newData.isString() && newData.val().length === 2' },
        rating: { '.validate': 'newData.isNumber()' },
        bot: { '.validate': 'newData.isBoolean()' },
        $other: { '.validate': false },
      },
    },
    startedAt: { '.validate': 'newData.val() === now || newData.val() === data.val()' },
    n: {
      '.write': playerWrite,
      '.validate':
        "newData.isNumber() && (!data.exists() ? newData.val() === 0 : (newData.val() === data.val() + 1 && newData.parent().child('moves/' + data.val()).exists()))",
    },
    turn: {
      '.write': playerWrite,
      '.validate':
        "(newData.val() === 'X' || newData.val() === 'O') && (!data.exists() ? newData.val() === 'X' : (newData.val() !== data.val() && newData.parent().child('n').val() === data.parent().child('n').val() + 1))",
    },
    turnStart: { '.write': playerWrite, '.validate': 'newData.val() === now' },
    moves: {
      $i: {
        '.write': playerWrite,
        '.validate':
          "!data.exists() && newData.hasChildren(['x', 'y', 'p', 't']) && newData.child('x').isNumber() && newData.child('y').isNumber() && newData.child('p').val() === data.parent().parent().child('turn').val() && newData.child('t').val() === now && !data.parent().parent().child('board/' + newData.child('x').val() + '_' + newData.child('y').val()).exists() && newData.parent().parent().child('board/' + newData.child('x').val() + '_' + newData.child('y').val()).val() === newData.child('p').val() && newData.parent().parent().child('n').val() === data.parent().parent().child('n').val() + 1",
      },
    },
    board: {
      $cell: {
        '.write': playerWrite,
        '.validate':
          "!data.exists() && newData.val() === data.parent().parent().child('turn').val() && newData.parent().parent().child('n').val() === data.parent().parent().child('n').val() + 1",
      },
    },
    drawOffer: {
      '.write': `auth != null && ${noResult} && (newData.exists() ? ${G} + '/players/' + newData.val() + '/uid').val() === auth.uid : (${G} + '/players/X/uid').val() === auth.uid || ${G} + '/players/O/uid').val() === auth.uid || ${isBotHost}))`,
      '.validate': "newData.val() === 'X' || newData.val() === 'O'",
    },
    result: {
      '.write': 'auth != null && !data.exists()',
      '.validate': `newData.hasChildren(['reason', 'at']) && newData.child('at').val() === now && ((${five}) || (${timeout}) || (${resign}) || (${draw}))`,
      winner: { '.validate': "newData.val() === 'X' || newData.val() === 'O'" },
      reason: { '.validate': 'newData.isString()' },
      line: { '.validate': "newData.hasChildren(['sx', 'sy', 'dx', 'dy', 'len'])" },
      at: { '.validate': 'newData.val() === now' },
      $other: { '.validate': false },
    },
    $other: { '.validate': false },
  },
};

fs.writeFileSync(rf, JSON.stringify(r, null, 2) + '\n');
console.log('rules bytes', fs.statSync(rf).size);

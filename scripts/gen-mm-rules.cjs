// Matchmaking rules: /queue and the extra seat-assignment cases on /rooms.
// Usage: node scripts/gen-mm-rules.cjs database.rules.json
const fs = require('fs');
const rf = process.argv[2];
const r = JSON.parse(fs.readFileSync(rf, 'utf8'));

r.rules.queue = {
  '.read': 'auth != null',
  $uid: {
    // owner manages its ticket; a searcher holding a 'locked' ticket may claim a waiting one
    '.write': `auth != null && ($uid === auth.uid || (data.child('state').val() === 'waiting' && newData.child('state').val() === 'matched' && newData.child('by').val() === auth.uid && root.child('queue/' + auth.uid + '/state').val() === 'locked'))`,
    '.validate': "newData.hasChildren(['rating', 'name', 'avatar', 'country', 'joinedAt', 'state'])",
    rating: { '.validate': "newData.val() === root.child('stats/' + $uid + '/rating').val()" },
    name: { '.validate': 'newData.isString() && newData.val().length >= 3 && newData.val().length <= 16' },
    avatar: { '.validate': 'newData.isNumber()' },
    country: { '.validate': 'newData.isString() && newData.val().length === 2' },
    joinedAt: { '.validate': 'newData.val() === now || newData.val() === data.val()' },
    state: { '.validate': "newData.val() === 'waiting' || newData.val() === 'locked' || newData.val() === 'matched'" },
    by: { '.validate': 'newData.isString()' },
    match: { '.validate': 'newData.isString()' },
    $other: { '.validate': false },
  },
};

// Seats: besides "sit yourself", the host may seat
//  - the opponent it just matched (their ticket points at this room)
//  - a bot persona in a 'bot' room (created in the same update)
const slot = r.rules.rooms.$rid.slots.$side;
const hostAfter = "newData.parent().parent().child('meta/hostUid').val() === auth.uid";
const extra = ` || (auth != null && ${hostAfter} && (root.child('queue/' + newData.val() + '/match').val() === $rid || (newData.val().beginsWith('bot:') && newData.parent().parent().child('meta/type').val() === 'bot')))`;
if (!slot['.write'].includes("beginsWith('bot:')")) slot['.write'] = `(${slot['.write']})${extra}`;

fs.writeFileSync(rf, JSON.stringify(r, null, 2) + '\n');
console.log('rules bytes', fs.statSync(rf).size);

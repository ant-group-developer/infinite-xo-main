const vi = {
  title: 'XO VÔ HẠN',
  subtitle: 'INFINITE',
  you: 'Bạn',
  bot: 'Máy',
  p1: 'Người 1',
  p2: 'Người 2',
  draws: 'Hòa',
  'opp.bot': 'Đấu máy',
  'opp.two': '2 người',
  'level.easy': 'Dễ',
  'level.medium': 'Vừa',
  'level.hard': 'Khó',
  'turn.you': 'Lượt của bạn!',
  'turn.bot': 'Máy đang nghĩ…',
  'turn.player': 'Lượt của {name}',
  'sub.start': 'Chạm vào ô bất kỳ để đánh • Kéo để di chuyển • Cuộn/chụm để phóng to',
  'sub.moves': 'Nước thứ {n}',
  'res.win': 'Bạn thắng!',
  'res.lose': 'Máy thắng!',
  'res.pwin': '{name} thắng!',
  'res.draw': 'Hòa!',
  'res.resignYou': 'Bạn đã đầu hàng.',
  'res.resignBot': 'Máy đầu hàng!',
  'res.resignP': '{name} đầu hàng.',
  'res.line': 'Chuỗi {n} quân liên tiếp',
  'res.agreed': 'Hai bên đồng ý hòa.',
  next: 'Ván mới',
  close: 'Đóng',
  undo: 'Hoàn tác',
  hint: 'Gợi ý',
  resign: 'Đầu hàng',
  offerDraw: 'Xin hòa',
  newGame: 'Ván mới',
  playAs: 'Cầm',
  recenter: 'Về vùng đang chơi',
  zoomIn: 'Phóng to',
  zoomOut: 'Thu nhỏ',
  sound: 'Âm thanh',
  help: 'Cách chơi',
  stats: 'Thống kê',
  lang: 'Ngôn ngữ',
  'confirm.resignT': 'Đầu hàng?',
  'confirm.resignB': 'Bạn sẽ thua ván này.',
  'confirm.resignP': '{name} sẽ thua ván này.',
  'confirm.newT': 'Bắt đầu ván mới?',
  'confirm.newB': 'Ván đang chơi sẽ bị hủy.',
  yes: 'Đồng ý',
  no: 'Không',
  cancel: 'Hủy',
  'draw.askT': '{name} đề nghị hòa',
  'draw.askB': '{name}, bạn có đồng ý hòa không?',
  'draw.accept': 'Đồng ý hòa',
  'draw.decline': 'Từ chối',
  'draw.botDeclined': 'Máy từ chối hòa!',
  'draw.declined': '{name} từ chối hòa.',
  'draw.thinking': 'Máy đang cân nhắc…',
  'toast.occupied': 'Ô này đã có quân!',
  'toast.wait': 'Chờ máy đánh đã!',
  'toast.noUndo': 'Không còn nước để hoàn tác',
  'stats.sub': 'Kết quả đấu với máy',
  'stats.won': 'Thắng',
  'stats.lost': 'Thua',
  'stats.drawn': 'Hòa',
  'stats.streak': 'Chuỗi thắng',
  'stats.best': 'Kỷ lục',
  'stats.reset': 'Xóa thống kê',
  'help.title': 'Cách chơi',
  'help.body': `<p>Hai người lần lượt đặt <b class="cx">X</b> hoặc <b class="co">O</b> vào các ô trống trên <b>bàn cờ không giới hạn</b>. X luôn đi trước.</p>
<p>Ai tạo được <b>ít nhất 5 quân liên tiếp</b> theo hàng ngang, dọc hoặc chéo, <b>mà không bị đối thủ chặn cả hai đầu</b>, sẽ thắng ngay.</p>
<ul class="rules">
<li><code>· X X X X X ·</code><span class="ok">Thắng</span></li>
<li><code>O X X X X X ·</code><span class="ok">Thắng — chặn 1 đầu vẫn thắng</span></li>
<li><code>O X X X X X O</code><span class="no">Không thắng — bị chặn 2 đầu</span></li>
<li><code>· X X X X X X ·</code><span class="ok">Thắng — 6+ quân cũng được</span></li>
<li><code>· X X O X X X ·</code><span class="no">Không — bị O ngắt giữa</span></li>
</ul>
<p>Mép màn hình <b>không phải</b> mép bàn: kéo để di chuyển, cuộn chuột / chụm 2 ngón để phóng to. Nút ⌖ đưa bạn về vùng đang chơi.</p>
<p>Bạn có thể <b>xin hòa</b> hoặc <b>đầu hàng</b> bất cứ lúc nào.</p>`,
} as const;

type Dict = Record<keyof typeof vi, string>;

const en: Dict = {
  title: 'INFINITE XO',
  subtitle: 'NO LIMITS',
  you: 'You',
  bot: 'Bot',
  p1: 'Player 1',
  p2: 'Player 2',
  draws: 'Draws',
  'opp.bot': 'vs Bot',
  'opp.two': '2 Players',
  'level.easy': 'Easy',
  'level.medium': 'Medium',
  'level.hard': 'Hard',
  'turn.you': 'Your turn!',
  'turn.bot': 'Bot is thinking…',
  'turn.player': "{name}'s turn",
  'sub.start': 'Tap any cell to play • Drag to move • Scroll/pinch to zoom',
  'sub.moves': 'Move {n}',
  'res.win': 'You win!',
  'res.lose': 'Bot wins!',
  'res.pwin': '{name} wins!',
  'res.draw': 'Draw!',
  'res.resignYou': 'You resigned.',
  'res.resignBot': 'The bot resigned!',
  'res.resignP': '{name} resigned.',
  'res.line': '{n} in a row',
  'res.agreed': 'Both players agreed to a draw.',
  next: 'New game',
  close: 'Close',
  undo: 'Undo',
  hint: 'Hint',
  resign: 'Resign',
  offerDraw: 'Offer draw',
  newGame: 'New game',
  playAs: 'Play as',
  recenter: 'Back to the action',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  sound: 'Sound',
  help: 'How to play',
  stats: 'Stats',
  lang: 'Language',
  'confirm.resignT': 'Resign?',
  'confirm.resignB': 'You will lose this game.',
  'confirm.resignP': '{name} will lose this game.',
  'confirm.newT': 'Start a new game?',
  'confirm.newB': 'The current game will be abandoned.',
  yes: 'Yes',
  no: 'No',
  cancel: 'Cancel',
  'draw.askT': '{name} offers a draw',
  'draw.askB': '{name}, do you accept the draw?',
  'draw.accept': 'Accept draw',
  'draw.decline': 'Decline',
  'draw.botDeclined': 'The bot declined the draw!',
  'draw.declined': '{name} declined the draw.',
  'draw.thinking': 'Bot is considering…',
  'toast.occupied': 'That cell is taken!',
  'toast.wait': 'Wait for the bot!',
  'toast.noUndo': 'Nothing to undo',
  'stats.sub': 'Your games vs the bot',
  'stats.won': 'Won',
  'stats.lost': 'Lost',
  'stats.drawn': 'Draw',
  'stats.streak': 'Win streak',
  'stats.best': 'Best',
  'stats.reset': 'Reset stats',
  'help.title': 'How to play',
  'help.body': `<p>Players take turns placing <b class="cx">X</b> or <b class="co">O</b> on an <b>endless board</b>. X always starts.</p>
<p>Make <b>5 or more in a row</b> — horizontally, vertically or diagonally — <b>without being blocked by your opponent at both ends</b>, and you win instantly.</p>
<ul class="rules">
<li><code>· X X X X X ·</code><span class="ok">Win</span></li>
<li><code>O X X X X X ·</code><span class="ok">Win — one end blocked is fine</span></li>
<li><code>O X X X X X O</code><span class="no">No win — blocked at both ends</span></li>
<li><code>· X X X X X X ·</code><span class="ok">Win — 6+ counts too</span></li>
<li><code>· X X O X X X ·</code><span class="no">No — broken by O</span></li>
</ul>
<p>The screen edge is <b>not</b> the board edge: drag to move, scroll or pinch to zoom. ⌖ brings you back to the action.</p>
<p>You can <b>offer a draw</b> or <b>resign</b> at any time.</p>`,
};

export type Lang = 'vi' | 'en';
export type TKey = keyof typeof vi;
const dicts: Record<Lang, Dict> = { vi, en };

let lang: Lang = 'vi';

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
}
export const getLang = () => lang;

export function t(key: TKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

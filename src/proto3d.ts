/**
 * 3D PROTOTYPE page (proto3d.html) – for design review only, not linked from
 * the game. Real rules (src/core), real bot, Three.js renderer.
 */
import { chooseMove } from './ai/bot';
import { Game } from './core/game';
import { ThreeBoard, type CameraPreset, type Theme3D } from './view3d/ThreeBoard';

const css = `
  :root { --pink:#ff2bd6; --cyan:#1ff4ff; --gold:#ffd23a; --dim:#b9a9ff; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; overflow:hidden; background:#05010f; color:#fff;
    font-family:'Baloo 2',system-ui,sans-serif; font-weight:600; user-select:none; }
  #stage3d { position:fixed; inset:0; }
  .hud { position:fixed; z-index:2; pointer-events:none; }
  .hud > * { pointer-events:auto; }
  .top { top:12px; left:12px; right:12px; display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .brand { line-height:1.25; padding:.12em 0 .06em; font-size:26px; font-weight:800; letter-spacing:.03em;
    background:linear-gradient(90deg,var(--pink),#c58bff 55%,var(--cyan)); -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 10px #ff2bd666); }
  .brand small { display:block; font-size:12px; letter-spacing:.2em; color:var(--gold); -webkit-text-fill-color:var(--gold); }
  .status { padding:8px 16px; border-radius:999px; background:#12062cd9; border:1px solid #8a6bff66; font-size:18px; backdrop-filter:blur(6px); }
  .status b.x { color:var(--pink) } .status b.o { color:var(--cyan) }
  .panel { position:fixed; z-index:2; right:12px; top:70px; width:250px; padding:12px; border-radius:18px;
    background:#12062ce6; border:1px solid #8a6bff55; box-shadow:0 12px 40px #000a; backdrop-filter:blur(8px); display:grid; gap:10px; }
  .panel h4 { margin:0; font-size:12px; color:var(--dim); font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .seg { display:flex; gap:4px; padding:3px; border-radius:999px; background:#ffffff0d; border:1px solid #8a6bff40; }
  .seg button { flex:1; }
  button { font:inherit; color:#e9e1ff; background:#ffffff10; border:1px solid #8a6bff55; border-radius:12px; height:34px; padding:0 10px; cursor:pointer; font-size:13px; }
  .seg button { border:0; background:none; border-radius:999px; height:30px; color:var(--dim); padding:0 4px; font-size:12px; white-space:nowrap; }
  .seg button.on { color:#1a0b3a; background:linear-gradient(90deg,#ffd9f6,#d9fbff); }
  button.primary { color:#1a0b3a; font-weight:800; border:0; background:linear-gradient(90deg,var(--pink),#b56bff 50%,var(--cyan)); }
  button.on:not(.seg button) { border-color:var(--cyan); color:#fff; box-shadow:0 0 12px -4px var(--cyan); }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .stats { font:12px ui-monospace,Consolas,monospace; color:var(--dim); display:grid; grid-template-columns:1fr 1fr; gap:2px 8px; }
  .stats b { color:#fff; }
  .hint { position:fixed; z-index:2; left:50%; bottom:14px; transform:translateX(-50%); padding:8px 16px; border-radius:999px;
    font-size:13px; color:var(--dim); background:#12062cc0; border:1px solid #8a6bff33; white-space:nowrap; }
  .tag { position:fixed; z-index:2; left:12px; bottom:14px; font-size:11px; letter-spacing:.15em; color:var(--gold);
    padding:4px 10px; border:1px dashed #ffd23a88; border-radius:8px; background:#ffd23a14; }
  .toggle { position:fixed; z-index:3; right:12px; top:70px; display:none; }
  @media (max-width:700px) {
    .panel { top:auto; bottom:62px; left:12px; right:12px; width:auto; max-height:46vh; overflow:auto; }
    .panel.collapsed { display:none; }
    .toggle { display:block; top:auto; bottom:14px; right:12px; }
    .hint { display:none; } .brand { font-size:20px; }
  }
`;
document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

document.body.insertAdjacentHTML(
  'beforeend',
  `<div class="hud top">
     <div class="brand">XO VÔ HẠN<small>PROTOTYPE 3D</small></div>
     <div class="status" id="status"></div>
   </div>
   <div class="panel" id="panel">
     <h4>Ván cờ</h4>
     <div class="row"><button class="primary" data-a="new">Ván mới</button><button data-a="demo" id="bDemo">▶ Tự đánh</button></div>
     <div class="row"><button data-a="center">⌖ Về giữa</button><button data-a="stress">+300 quân</button></div>
     <h4>Góc camera</h4>
     <div class="seg" id="cams"><button data-cam="tilt" class="on">Nghiêng</button><button data-cam="top">Từ trên</button><button data-cam="cinema">Điện ảnh</button></div>
     <h4>Bộ màu</h4>
     <div class="seg" id="themes"><button data-theme="neon" class="on">Neon</button><button data-theme="sunset">Hoàng hôn</button><button data-theme="ice">Băng</button></div>
     <h4>Hiệu ứng</h4>
     <div class="row"><button data-a="bloom" id="bBloom" class="on">✨ Phát sáng</button><button data-a="hide">Ẩn bảng</button></div>
     <h4>Hiệu năng</h4>
     <div class="stats"><span>FPS <b id="sFps">–</b></span><span>Quân <b id="sPieces">0</b></span><span>Draw calls <b id="sCalls">–</b></span><span>Tam giác <b id="sTris">–</b></span></div>
   </div>
   <button class="toggle" id="toggle">⚙</button>
   <div class="hint">Chuột trái: đặt quân · Kéo: di chuyển · Chuột phải: xoay · Cuộn: phóng to</div>
   <div class="tag">BẢN MÔ PHỎNG — CHƯA TÍCH HỢP</div>`,
);

const $ = (id: string) => document.getElementById(id)!;
const game = new Game();
// Start with an interesting mid-game position (placed before the board exists → no drop animation).
for (const [x, y] of [
  [0, 0], [1, 1], [1, 0], [2, 0], [0, 1], [-1, 2], [0, -1], [0, 2], [-1, 0], [2, 2],
] as const) game.play(x, y);
const board = new ThreeBoard($('stage3d'), game);
(window as unknown as { board: ThreeBoard; game: Game }).board = board;
(window as unknown as { game: Game }).game = game;

function renderStatus() {
  const s = $('status');
  if (game.status === 'won') s.innerHTML = `<b class="${game.winner === 'X' ? 'x' : 'o'}">${game.winner}</b> thắng! Chuỗi ${game.winLine?.length} quân`;
  else s.innerHTML = `Lượt của <b class="${game.turn === 'X' ? 'x' : 'o'}">${game.turn}</b> · nước ${game.moves.length}`;
  board.setInteractive(game.isOver || demo ? null : game.turn);
}
game.on(() => renderStatus());
board.onCellTap = (c) => {
  if (demo) return;
  game.play(c.x, c.y);
};

/* ---------------------------------------------------------------- demo */
let demo = false;
let demoTimer: ReturnType<typeof setTimeout> | undefined;
function demoStep() {
  if (!demo) return;
  if (game.isOver) {
    demoTimer = setTimeout(() => {
      game.reset('X');
      demoStep();
    }, 3500);
    return;
  }
  const r = chooseMove({ moves: game.moves, player: game.turn, level: Math.random() < 0.5 ? 'medium' : 'hard', timeMs: 120 });
  game.play(r.move.x, r.move.y);
  demoTimer = setTimeout(demoStep, 650);
}
function setDemo(on: boolean) {
  demo = on;
  $('bDemo').classList.toggle('on', on);
  $('bDemo').textContent = on ? '⏸ Dừng' : '▶ Tự đánh';
  clearTimeout(demoTimer);
  renderStatus();
  if (on) demoStep();
}

/* -------------------------------------------------------------- panel */
let bloom = true;
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!t) return;
  if (t.dataset.cam) {
    document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b === t));
    board.setCameraPreset(t.dataset.cam as CameraPreset);
  }
  if (t.dataset.theme) {
    document.querySelectorAll('#themes button').forEach((b) => b.classList.toggle('on', b === t));
    board.setTheme(t.dataset.theme as Theme3D['id']);
  }
  switch (t.dataset.a) {
    case 'new':
      setDemo(false);
      game.reset('X');
      board.recenter();
      break;
    case 'demo':
      setDemo(!demo);
      break;
    case 'center':
      board.recenter();
      break;
    case 'bloom':
      bloom = !bloom;
      board.setBloom(bloom);
      t.classList.toggle('on', bloom);
      break;
    case 'stress': {
      // decorative stones far from the play area (do not affect the game)
      const base = 12 + Math.floor(Math.random() * 6) * 20;
      for (let i = 0; i < 300; i++) board.addStatic(base + (i % 20), -10 + Math.floor(i / 20), (i + Math.floor(i / 20)) % 2 ? 'X' : 'O');
      break;
    }
    case 'hide':
      $('panel').classList.add('collapsed');
      $('panel').style.display = 'none';
      break;
  }
});
$('toggle').onclick = () => {
  const p = $('panel');
  p.style.display = p.style.display === 'none' ? '' : 'none';
};

setInterval(() => {
  $('sFps').textContent = String(board.stats.fps);
  $('sCalls').textContent = String(board.stats.calls);
  $('sTris').textContent = board.stats.triangles.toLocaleString('vi-VN');
  $('sPieces').textContent = String(board.stats.pieces);
}, 500);

renderStatus();
board.setCameraPreset('tilt', false);

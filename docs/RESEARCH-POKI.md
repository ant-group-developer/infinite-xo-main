# Nghiên cứu source `tic-tac-toe-poki`

> Đối tượng: `tic-tac-toe-poki/public/index.html` (bản mirror của "Tic Tac Toe Ultimate" trên Poki, ~411 KB, 1 file HTML duy nhất).
> Mục đích: hiểu kiến trúc / UX / AI để thiết kế **Infinite XO** có cảm giác tương tự — **không copy code hay asset** của họ.

## 1. Đóng gói & công nghệ

| Hạng mục | Thực tế trong source |
|---|---|
| Build | Vite (module preload polyfill ở đầu bundle), **vanilla JS**, không framework |
| Render | **DOM + SVG**: bàn là CSS grid `.board > .cell`, quân X/O là `<svg>` vẽ bằng `<path pathLength=1>` để animate "vẽ nét" bằng `stroke-dashoffset` |
| CSS | ~131 KB, nhúng font **Fredoka** (woff2, OFL) dạng data URI |
| Âm thanh | **Không có file audio** — toàn bộ synth bằng WebAudio (`OscillatorNode` + noise buffer qua `BiquadFilter`) |
| Lưu trữ | `localStorage` prefix `ttt-neon:` (profile, stats, skin, ngôn ngữ) |
| i18n | 14 ngôn ngữ, mỗi ngôn ngữ là 1 chuỗi `a|b|c…` map theo danh sách key |
| SDK | Poki SDK (quảng cáo, rewarded video, `measure` analytics) – bản local bỏ đi, game tự chạy nhánh dev |
| Online | WebRTC qua `wss://netlib.poki.io` (không chạy offline) |

## 2. Layout & UX (`#app` là CSS grid 1 cột)

```
top    : logo "TIC TAC TOE / ULTIMATE"  | Skins Stats Sound Help Lang
score  : [P1 mark tên điểm]  [Hòa n | streak]  [P2 …]   ← card đang tới lượt phát sáng
status : [Hint]   "Your turn!" / "Bot is thinking…"   [Undo]
stage  : .board (vuông, size = --bs tính theo viewport)
ctrl   : modes (Classic/Infinity/4×4/5×5/6×6) ; seg Opp (vs Bot/2P) ; seg Level (Easy/Medium/Hard)
overlay: modal kết quả / skins / stats / help ; #toast ; #fx (particles) ; #flash
```

Điểm "juice" đáng học:
- Nền **synthwave**: gradient tím + 2 quầng sáng blur + **sàn lưới perspective** (`rotateX(64deg)`) chạy vô tận bằng `@keyframes translateY`.
- Quân **neon**: stroke màu (#ff2bd6 hồng cho X, #1ff4ff cyan cho O) + filter glow + lõi trắng.
- Đặt quân: `markPop` (scale 0.55→1 với cubic-bezier overshoot) + `drawIn` (vẽ nét) + ô "ping".
- Thắng: quân thắng `winPulse`, quân khác mờ 35%, đường thắng `.gl` phát sáng; thua: bàn `shake`.
- Bot luôn có độ trễ "đang nghĩ" để cảm giác tự nhiên.
- Streak thắng, stats theo level, "second chance" (undo sau khi thua – gắn rewarded ad).

## 3. Logic game (rút gọn từ bundle)

```js
modes = {
  classic : { size: 3, k: 3 },
  infinity: { size: 3, k: 3, keep: 3, maxMoves: 40 },  // ⚠ "Infinity" = mỗi bên giữ 3 quân, quân cũ nhất biến mất
  four    : { size: 4, k: 4 }, five: { size: 5, k: 4 }, six: { size: 6, k: 4 },
}
state = { cells: Int[size*size], queue, turn, moves, result, line, vanished, last }
```
- Danh sách tất cả các "line" k-ô được tính sẵn và cache theo `(size,k)`, kèm index ngược `cell → lines` → kiểm tra thắng chỉ duyệt các line đi qua ô vừa đánh.
- State là **immutable** (`N(state, move)` trả state mới) → tiện cho minimax.

**Quan trọng:** chế độ "Infinity" của Poki **không phải** bàn vô hạn. Game mình làm là bàn vô hạn + 5 quân (gần Gomoku/Caro) → phải thiết kế lại phần board, camera và AI, không tái dùng được mô hình mảng cố định.

## 4. AI của Poki

| Bàn | Thuật toán |
|---|---|
| 3×3 | Minimax đầy đủ có memo (transposition table theo chuỗi cells) |
| 4×4–6×6 | Negamax **alpha-beta + iterative deepening + giới hạn thời gian** (Hard 350 ms, Medium 120 ms), move ordering bằng heuristic, chỉ xét ô kề quân đã có |
| Heuristic | Với mỗi line: chỉ có quân mình → `+[0,1,6,40,400,5000][n]`, chỉ có quân địch → trừ ×1.2 |
| Độ khó | Xác suất "lấy nước thắng" / "chặn" / "chơi thông minh" khác nhau theo level (ví dụ Easy chỉ chặn 25–35%) |

Bài học áp dụng: độ khó = **xác suất mắc lỗi có kiểm soát** + độ sâu tìm kiếm; luôn có giới hạn thời gian; ưu tiên nước thắng/chặn trước khi search.

## 5. Khác biệt cần thiết kế lại cho Infinite XO

| Vấn đề | Poki | Infinite XO |
|---|---|---|
| Bàn | mảng `size*size` | `Map` thưa, toạ độ âm/dương không giới hạn |
| Hiển thị | DOM grid | **Canvas 2D** (hàng nghìn ô lưới, pan/zoom 60fps) → sau này Three.js |
| Tương tác | click ô | click + **kéo / zoom / pinch**, nút "về vùng đang chơi", mũi tên chỉ nước cuối khi ra ngoài màn hình |
| Luật thắng | k ô liên tiếp trong line cố định | chuỗi **liên tục tối đa ≥ 5** và **không bị chặn cả 2 đầu** (xem `infinite-xo-game-rules.md`) |
| Hòa | hết ô | chỉ hòa khi **hai bên đồng ý** |
| AI | minimax/alpha-beta trên bàn nhỏ | phân loại "shape" theo luật chặn 2 đầu + VCF + alpha-beta có cắt tỉa ứng viên |

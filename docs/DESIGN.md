# Thiết kế Infinite XO

Luật: [`../../infinite-xo-game-rules.md`](../../infinite-xo-game-rules.md) — thắng khi `count >= 5 && !(blockedStart && blockedEnd)` trên **chuỗi liên tục tối đa** chứa quân vừa đánh.

## 1. Kiến trúc

```
src/
  core/               ← thuần TS, không phụ thuộc DOM (dùng lại được cho server online)
    types.ts          Player, Move, DIRECTIONS, WinLine
    board.ts          Board: Map<number, Player> thưa, key số (x,y) → không giới hạn, toạ độ âm OK
    rules.ts          checkWinAt / checkWin / wouldWin  (đúng §9 của spec)
    game.ts           Game: state machine + event emitter (play/undo/resign/offerDraw/respondDraw)
  ai/
    patterns.ts       Phân loại shape 1 line 11 ô (Five/OpenFour/Four/Three/…) theo luật chặn 2 đầu, memo 3^11
    searchBoard.ts    Bàn cho search: place/undo + tập ứng viên tăng dần (ô trống trong bán kính 2)
    bot.ts            chooseMove(): Easy / Medium / Hard (VCF + anti-VCF + alpha-beta)
    bot.worker.ts     Chạy bot trong Web Worker
    BotClient.ts      Promise API + huỷ (undo/new game) + fallback main thread
  view/BoardView.ts   ★ Interface renderer — 2D hôm nay, Three.js ngày mai
  view2d/
    camera.ts         Camera 2D: cx, cy, scale; pan, zoomAt (giữ điểm dưới con trỏ), tween
    CanvasView.ts     Renderer Canvas 2D
  ui/                 icons (SVG tự vẽ), modal/toast
  app.ts              Controller: mode, lượt, bot, undo, hint, hòa, đầu hàng, stats, i18n
  audio.ts            Synth WebAudio
  i18n.ts             vi / en
```

Luồng dữ liệu một chiều:

```
input (tap) ─► App.onTap ─► Game.play ─► emit('move'|'win'…) ─┬─► CanvasView (animate)
                                                              ├─► App.render (HUD)
                                                              └─► App.maybeBotMove ─► Worker ─► Game.play
```
Renderer **chỉ đọc** Game và báo tap; không bao giờ sửa state. Nhờ vậy thay renderer 3D không đụng logic.

## 2. Core

- `Board` dùng key số `(x+2^20)*2^21 + (y+2^20)` thay vì chuỗi `"x,y"` → không tạo string mỗi lần lookup.
- `Game.play(x, y, by?)` từ chối: `game-over` (TC15), `wrong-turn` (TC14), `occupied` (TC13), `invalid-coord`. Nước bị từ chối không đổi bàn, không đổi lượt.
- Thắng → `status='won'`, dừng nhận nước (không cho chặn sau khi thắng – §5.3).
- Hòa chỉ qua `offerDraw` + `respondDraw` của **người còn lại** (TC20). Không có hòa do hết ô.
- `undo(n)` chỉ khi ván đang chơi.
- **Test:** `tests/rules.test.ts` phủ đủ TC01–TC20 của spec + vài case thêm (chuỗi 7 được tô toàn bộ, chặn ở chuỗi tối đa chứ không phải cửa sổ 5).

## 3. AI

### 3.1 Phân loại shape (patterns.ts)
Một line = 11 ô quanh ô đang xét (−5..+5), mã hoá base‑3 (0 trống, 1 mình, 2 địch). Shape được suy ra **tổng quát** bằng "còn bao nhiêu nước nữa thì thắng", dùng chính luật thắng:

| Shape | Định nghĩa |
|---|---|
| Five | chuỗi qua tâm thắng hợp lệ |
| OpenFour | ≥ 2 điểm thắng (đối thủ chặn không xuể) |
| Four | đúng 1 điểm thắng |
| Three / Three3 | đặt thêm 1 quân thành OpenFour / Four |
| Two / Two2 | đặt thêm 1 quân thành Three / Three3 |

→ Tự động đúng với luật riêng: `O X X X X · O` **không** phải "four" (lấp vào thành 5 bị chặn 2 đầu). Kết quả memo trong `Int8Array(177147)`.

### 3.2 Chấm điểm ô
`attackScore` gộp 4 hướng (Five, OpenFour, double-four, four-three, double-three…). Điểm ô = `atk(mình) + defWeight × atk(địch)`. Thực nghiệm greedy-vs-greedy: `defWeight ≈ 1.3–1.6` mạnh nhất (0.8 thua rõ).

### 3.3 Độ khó
| Level | Hành vi |
|---|---|
| Dễ | Thắng ngay 70%, chặn nước thua 55%, chọn ngẫu nhiên trong top 8 (thiên về tấn công) |
| Vừa | Luôn thắng/chặn, greedy với defWeight 1.4, thỉnh thoảng đi lỏng khi **không** bị đe doạ |
| Khó | Thắng/chặn → **VCF** (thắng bằng chuỗi nước tứ) → **anti-VCF** (nếu đối thủ có VCF, chỉ xét nước phá được) → **alpha-beta** iterative deepening (≤ 700 ms), cắt tỉa top‑N ứng viên, **mở rộng nước bắt buộc** ở lá (chống horizon effect), eval = tổng shape mọi chuỗi + bonus nhịp đi |

Benchmark (`npm run bench`): Vừa thắng Dễ ~16–3, Khó thắng Dễ ~8–2 và thắng Vừa đa số. Lưu ý: trong Gomoku tự do, bên đi trước (X) có lợi thế lớn.

## 4. Renderer 2D (CanvasView)

- Camera: `toScreen/toWorld`, `zoomAt(factor, sx, sy)` giữ điểm dưới con trỏ, tween cho recenter.
- Vẽ lưới chỉ trong vùng nhìn thấy; vạch đậm mỗi 5 ô; mờ dần khi zoom xa.
- Quân neon cache thành **sprite** offscreen theo mức zoom (shadowBlur đắt → chỉ vẽ 1 lần).
- Hiệu ứng: pop + vẽ nét khi đặt, gợn sóng, ô nước cuối nhấp nháy, ghost khi hover, beam thắng + rung quân thắng + mờ quân khác + particles, viền đỏ khi bấm ô đã có quân, **mũi tên chỉ nước cuối** khi nó ở ngoài màn hình (bấm để bay tới).
- Input: Pointer Events thống nhất chuột/cảm ứng; tap vs drag bằng ngưỡng px; pinch 2 ngón; wheel zoom; quán tính khi thả; phím mũi tên / `+` `-` / `0`.
- Tự cuộn camera khi nước mới sát mép; khi thắng, fit cả chuỗi thắng.

## 5. Mở rộng tiếp

- **Online:** `core/` không phụ thuộc DOM → chạy nguyên trên server (Node/WebSocket) để xác thực nước đi như spec §9.3 khuyến nghị.
- **3D:** xem [`THREEJS-3D.md`](./THREEJS-3D.md).
- Có thể thêm: hẹn giờ, replay/xuất ván, skin, Renju (cấm 3‑3/4‑4) như một biến thể riêng.

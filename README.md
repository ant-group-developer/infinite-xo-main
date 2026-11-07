# Infinite XO — XO Vô Hạn

Cờ XO trên **bàn cờ không giới hạn**: ai có **≥ 5 quân liên tiếp** (ngang/dọc/chéo) mà **không bị chặn cả hai đầu** thì thắng.
Luật đầy đủ: [`../infinite-xo-game-rules.md`](../infinite-xo-game-rules.md). Phong cách neon/synthwave lấy cảm hứng từ Tic Tac Toe Ultimate (Poki); toàn bộ code, hình và âm thanh là tự viết.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit test luật (TC01–TC20) + AI cơ bản
npm run bench      # bot-vs-bot đo độ mạnh (chậm, vài phút)
npm run build      # typecheck + build ra dist/
```

## Tính năng

- Bàn vô hạn: kéo để di chuyển, cuộn chuột / chụm 2 ngón để zoom, phím mũi tên, `+`/`-`, `0` để về giữa.
- Đấu máy (Dễ / Vừa / Khó — bot chạy trong Web Worker) hoặc 2 người cùng máy; chọn cầm X hay O.
- Hoàn tác, gợi ý, xin hòa (máy tự quyết định nhận hay không), đầu hàng, ván mới.
- Tô sáng toàn bộ chuỗi thắng (kể cả > 5), mũi tên chỉ nước cuối khi nó ở ngoài màn hình.
- Thống kê thắng/thua/hòa theo độ khó + chuỗi thắng (localStorage), âm thanh synth, tiếng Việt / English.

## Deploy (Docker)

```bash
cp .env.example .env   # cổng, FRAME_ANCESTORS (nhúng iframe), Firebase…
docker compose up -d --build
```

Cấu hình đọc từ biến môi trường **lúc chạy** (không cần build lại khi đổi). Chi tiết, đoạn nhúng iframe: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Tài liệu

- [`docs/RESEARCH-POKI.md`](docs/RESEARCH-POKI.md) — phân tích source game Poki.
- [`docs/DESIGN.md`](docs/DESIGN.md) — kiến trúc, AI, renderer.
- [`docs/THREEJS-3D.md`](docs/THREEJS-3D.md) — nghiên cứu bản 3D bằng Three.js.
- [`docs/3D-PROTOTYPE.md`](docs/3D-PROTOTYPE.md) — bản 3D: cách dùng, ảnh, hiệu năng.

## Online

Phòng chơi (2 ghế + người xem, chat, chủ phòng kick, báo cáo), ghép trận xếp hạng (có bot đóng vai người khi vắng), Elo + bậc Đồng → Thách Đấu, bảng xếp hạng, lịch sử trận, mùa giải. Chi tiết: `docs/ONLINE-PLAN.md`.

### Chạy thử không cần Firebase
Chưa có `.env.local` → Online dùng backend **Local**: một SharedWorker trong trình duyệt đóng vai server. **Mỗi tab là một người chơi** → mở 2–3 tab để thử phòng, chat, kick, ghép trận, người xem.

### Dùng Firebase thật
1. Tạo project theo `docs/FIREBASE-SETUP.md`; copy `.env.example` → `.env.local` và điền config.
2. Đăng nhập Firebase CLI một lần (`npx firebase-tools login`, phải tự gõ vì cần trình duyệt), rồi `npm run rules:deploy` để đẩy `database.rules.json`.
3. `npm run rules:smoke` — kiểm tra luật trên project thật bằng 2 tài khoản ẩn danh: thao tác hợp lệ phải được phép, gian lận phải bị chặn.
4. `npm run dev` (thêm `?local=1` vào URL để quay lại backend Local). Deploy web + luật: `npm run deploy`.

### Cấu hình trên Firebase console (Realtime Database → Data)
| Node | Ý nghĩa |
|---|---|
| `/config/matchmaking` | `{ botEnabled: true, botAfterMinMs: 4000, botAfterMaxMs: 12000 }` — bật/tắt bot và thời gian chờ trước khi ghép bot |
| `/config/season` | số mùa hiện tại (tăng lên 2, 3… để mở mùa mới; điểm tự reset mềm khi người chơi đăng nhập) |
| `/reports` | báo cáo người chơi (client chỉ ghi được, xem trên console) |

### Luật bảo mật
`database.rules.json` là bản gốc; các phần phức tạp được sinh lại bằng `npm run rules:build` (`scripts/gen-*.cjs`).
Trên gói Spark (không có Cloud Functions), luật đóng vai trọng tài: đúng lượt, không đánh đè, 2 phút/nước, **kiểm tra lại chuỗi 5 + luật chặn 2 đầu từ bàn cờ**, điểm chỉ thay đổi kèm hồ sơ trận hợp lệ (tối đa ±40, đúng chiều thắng/thua, một lần mỗi trận).

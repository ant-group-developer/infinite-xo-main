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

## Tài liệu

- [`docs/RESEARCH-POKI.md`](docs/RESEARCH-POKI.md) — phân tích source game Poki.
- [`docs/DESIGN.md`](docs/DESIGN.md) — kiến trúc, AI, renderer.
- [`docs/THREEJS-3D.md`](docs/THREEJS-3D.md) — nghiên cứu & kế hoạch bản 3D bằng Three.js.

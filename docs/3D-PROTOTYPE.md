# Prototype 3D — bản mô phỏng để duyệt

> Trạng thái: **chờ duyệt**. Game chính chưa bị thay đổi gì; prototype là một trang riêng.

## Xem thử

```bash
npm run dev            # rồi mở  http://localhost:<PORT>/proto3d.html
```

Trang dùng **đúng luật game** (`src/core`) và **đúng bot** (`src/ai`). Bấm chuột để đặt quân, thắng thật, hiệu ứng thật. Bảng bên phải dùng để so sánh các lựa chọn:

| Nút | Để làm gì |
|---|---|
| ▶ Tự đánh | Bot tự đánh với nhau liên tục để xem hiệu ứng rơi quân / thắng |
| Góc camera: Nghiêng · Từ trên · Điện ảnh | 3 góc nhìn đề xuất |
| Bộ màu: Neon · Hoàng hôn · Băng | 3 phong cách |
| ✨ Phát sáng | Bật/tắt hiệu ứng bloom (để so sánh, và để đo hiệu năng) |
| +300 quân | Thử tải: thêm 300 quân trang trí ở xa |
| Hiệu năng | FPS, số lệnh vẽ (draw call), số tam giác, số quân |

## Ảnh

| | |
|---|---|
| ![Neon, góc nghiêng](3d/01-neon-nghieng.jpg) **Neon – Nghiêng** (đề xuất mặc định) | ![Khoảnh khắc thắng](3d/02-thang-dien-anh.jpg) **Khoảnh khắc thắng**: tia laser nối chuỗi, quân thắng nhảy + xoay, quân còn lại tối đi, camera tự bay tới |
| ![Neon, điện ảnh](3d/03-neon-dien-anh.jpg) **Neon – Điện ảnh**: đường chân trời, mặt trời synthwave kẻ sọc, sương | ![Hoàng hôn](3d/04-hoang-hon.jpg) **Hoàng hôn** |
| ![Băng, từ trên](3d/05-bang-tu-tren.jpg) **Băng – Từ trên** (gần giống bản 2D) | ![Điện thoại](3d/06-dien-thoai.jpg) **Điện thoại 390px** (bảng điều khiển của prototype, bản thật dùng HUD hiện có) |

## Thiết kế

**Thế giới**
- Bàn vô hạn là **một mặt phẳng duy nhất chạy theo camera**. Lưới vẽ bằng shader: vạch mảnh mỗi ô, vạch đậm mỗi 5 ô (giống bản 2D), mờ dần ra xa rồi tan vào sương chân trời. Kéo đi bao xa cũng không có mép.
- Bầu trời gradient, ~900 ngôi sao, **mặt trời synthwave kẻ sọc** luôn nằm giữa chân trời theo hướng nhìn.

**Quân cờ**
- Dựng hoàn toàn bằng code, không dùng file model nào. X là 2 thanh capsule bắt chéo; O là vòng xuyến (torus). Vật liệu tự phát sáng màu neon.
- **Đặt quân:** quân rơi từ trên xuống, nảy nhẹ khi chạm bàn, có vòng sóng lan ra trên mặt bàn.
- **Rê chuột:** hiện quân mờ lơ lửng, xoay nhẹ, kèm ô sáng; vòng sáng nhấp nháy dưới nước vừa đánh.
- **Thắng:** tia laser trắng kèm quầng màu người thắng chạy dọc chuỗi (đủ dài kể cả >5 quân); các quân thắng nhảy lần lượt rồi xoay chậm; quân khác tối đi; bắn hạt; camera bay tới khung cả chuỗi.

**Điều khiển** (giống bản 2D để người chơi không phải học lại)
- Chuột trái: bấm = đặt quân, kéo = trượt bàn.
- Cuộn chuột: phóng to/thu nhỏ. Chuột phải: xoay.
- Cảm ứng: 1 ngón kéo, 2 ngón phóng to/xoay.
- Góc nghiêng bị giới hạn để không bao giờ nhìn xuống dưới mặt bàn.
- Xác định ô được bấm bằng cách chiếu tia chuột lên mặt phẳng bàn, không cần kiểm tra từng ô.

## Đo hiệu năng (máy test: GTX 1650, 1920×911)

| Trường hợp | Thời gian GPU / khung hình | Ghi chú |
|---|---|---|
| 10 quân, có bloom | **0,28 ms** | dư sức 60 FPS (ngân sách 16,7 ms) |
| 10 quân, không bloom | 0,16 ms | |
| 310 quân, có bloom | 0,40 ms | |
| FPS thực tế khi cửa sổ đang hiển thị | **61** | |

- Draw call: 34–54 lệnh vẽ với 10 quân. Mỗi X là 2 mesh, mỗi O là 1 mesh. Nếu **300 quân cùng nằm trong khung nhìn** sẽ lên khoảng 450 lệnh vẽ, vẫn ổn trên máy tính nhưng nặng cho điện thoại yếu. Bản thật sẽ gộp bằng `InstancedMesh` (2 lệnh vẽ cho mọi quân X, 1 cho mọi quân O).
- **Dung lượng:** Three.js + bloom ≈ **150 KB gzip**. Sẽ chỉ tải khi người chơi bật 3D (dynamic import), nên game 2D vẫn ~44 KB gzip như bây giờ.
- Chưa đo trên điện thoại thật. Bloom tốn nhiều băng thông điểm ảnh nhất, nên bản thật sẽ có chế độ chất lượng tự hạ khi FPS thấp (tắt bloom, giảm độ phân giải).

## Kế hoạch tích hợp (sau khi duyệt)

1. `ThreeView` cài đúng interface `BoardView` mà bản 2D đang dùng: `onCellTap`, `setInteractive`, `showHint`, `recenter`, `zoomBy`, `reject`. Toàn bộ luật, bot, online, phòng, xếp hạng **không phải sửa gì**, vì renderer chỉ đọc `Game`.
2. Nút **2D / 3D** trên thanh trên cùng, lưu lựa chọn. 3D tải lazy; máy không có WebGL thì tự quay về 2D.
3. Bổ sung phần prototype còn thiếu:
   - đánh dấu ô gợi ý,
   - chớp đỏ khi bấm ô đã có quân,
   - mũi tên chỉ nước cuối khi nằm ngoài màn hình (lớp HTML trên canvas),
   - chuyển `InstancedMesh`,
   - chế độ chất lượng tự động.
4. Tôn trọng `prefers-reduced-motion`: tắt nảy/rung/bay camera. Khi bàn đứng yên thì chỉ vẽ lại lúc có thay đổi để đỡ tốn pin.
5. Test: chạy lại toàn bộ test hiện có, thêm test chuyển 2D↔3D giữa ván (kể cả đang đánh online).

Ước lượng: **khoảng 2 ngày công.**

## Cần mày chốt

1. **Phong cách:** Neon / Hoàng hôn / Băng — chọn một làm mặc định, hay cho người chơi tự chọn cả ba?
2. **Góc camera mặc định:** Nghiêng (đề xuất), Từ trên, hay Điện ảnh? Có cho người chơi xoay tự do không?
3. **Quân cờ:** đang **nằm phẳng** trên bàn. Ở góc Điện ảnh, X nhìn hơi dẹt (xem ảnh Hoàng hôn). Phương án khác là **dựng quân đứng** (dễ nhìn ở góc thấp, giống quân cờ thật) hoặc nghiêng nhẹ về phía camera.
4. **3D là tuỳ chọn** (mặc định vẫn 2D, bật 3D bằng nút) hay **3D là mặc định**, có nút về 2D?
5. Hiệu ứng thắng: giữ như hiện tại hay muốn mạnh/nhẹ hơn?

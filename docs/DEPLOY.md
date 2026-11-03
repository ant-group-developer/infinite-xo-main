# Deploy bằng Docker

Image = trang web tĩnh (Vite build) phục vụ bởi **nginx**. Mọi cấu hình lấy từ **biến môi trường lúc chạy container**: build một lần, dùng cho mọi môi trường. Image không chứa giá trị Firebase nào.

## Chạy nhanh

```bash
cp .env.example .env.local  # điền Firebase + PORT/HOST_PORT…
npm run docker:up           # = docker compose --env-file .env.local up -d --build
# → http://<server>:<HOST_PORT>
npm run docker:logs         # xem log;  npm run docker:down  để dừng
```

Dùng file `.env` thay vì `.env.local` thì chạy thẳng `docker compose up -d --build`.

Không dùng compose:

```bash
docker build -t infinite-xo .
docker run -d --name infinite-xo -p 8080:8080 --env-file .env infinite-xo
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8080` | Cổng nginx lắng nghe **trong** container |
| `HOST_PORT` | `8080` | (compose) cổng mở ra máy chủ |
| `FRAME_ANCESTORS` | `*` | Trang nào được nhúng game bằng iframe — xem bên dưới |
| `VITE_ONLINE_ENABLED` | `true` | `false` = ẩn Online + Hồ sơ (game offline thuần) |
| `VITE_PUBLIC_URL` | (rỗng) | **Để trống**: link mời tự lấy theo tên miền người chơi đang mở, trỏ bao nhiêu tên miền về cùng container cũng đúng. Chỉ đặt khi muốn ép link về một URL cố định |
| `VITE_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_DATABASE_URL`, `…_PROJECT_ID`, `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID`, `…_MEASUREMENT_ID` | (rỗng) | Firebase web config. Thiếu API key / database URL → Online dùng backend giả lập trong trình duyệt |

Cùng tên biến với `.env.local` khi chạy `npm run dev`, nên một file `.env` dùng cho cả hai.

**Cơ chế:** khi container khởi động, `docker/40-app-config.sh` ghi mọi biến `VITE_*` vào `/config.js` (`window.__APP_CONFIG__`). Trang tải file này trước app. nginx render `PORT` / `FRAME_ANCESTORS` từ `docker/*.template`. Đổi cấu hình chỉ cần **restart container**, không cần build lại.

> Các giá trị `VITE_*` đều **công khai** (trình duyệt nào cũng đọc được). Bảo mật nằm ở `database.rules.json`. Đừng đặt bí mật thật (service account, khoá admin) vào các biến này.

## Nhúng vào trang khác (iframe)

Server **không** gửi `X-Frame-Options`. Quyền nhúng do header CSP `frame-ancestors` quyết định, lấy từ `FRAME_ANCESTORS`:

```bash
FRAME_ANCESTORS=*                                         # mọi trang (mặc định)
FRAME_ANCESTORS='self' https://example.com https://*.example.com   # chỉ các trang này
FRAME_ANCESTORS='none'                                    # cấm nhúng
```

Đoạn nhúng:

```html
<iframe
  src="https://game.example.com/"
  width="960" height="680"
  style="border:0;max-width:100%"
  allow="clipboard-write; autoplay; fullscreen"
  title="XO Vô Hạn"
></iframe>
```

- `allow="clipboard-write"`: để nút "Sao chép link mời" hoạt động trong iframe (nếu thiếu, game sẽ hiện link để chép tay).
- Game gửi `postMessage({ source: 'infinite-xo', type: 'ready' })` lên trang cha khi đã tải xong.
- Mở thẳng vào một phòng: `src="https://game.example.com/?room=ABC123"`.

**Link mời dẫn về trang nhúng:** đặt `VITE_PUBLIC_URL=https://site.com/choi-xo`. Link mời sẽ là `https://site.com/choi-xo#/r/ABC123`. Trang đó cần chuyển mã phòng vào iframe:

```html
<iframe id="xo" src="https://game.example.com/" allow="clipboard-write; autoplay" style="border:0;width:100%;height:680px"></iframe>
<script>
  const m = location.hash.match(/^#\/r\/([A-Z0-9]{6})$/i);
  if (m) document.getElementById('xo').src = 'https://game.example.com/?room=' + m[1];
</script>
```

**Lưu ý khi nhúng ở tên miền khác:**
- Trình duyệt tách bộ nhớ của iframe theo trang nhúng. Tài khoản ẩn danh **trong iframe khác với** tài khoản khi mở game trực tiếp. Người chơi nên "Liên kết Google" để dùng chung tài khoản.
- Nút "Liên kết Google" trong iframe ở tên miền khác có thể bị trình duyệt chặn (cookie bên thứ ba). Khi đó mở game trực tiếp để liên kết.
- Thêm tên miền **của game** (không phải trang nhúng) vào Firebase → Authentication → Settings → **Authorized domains**.

## Endpoint

| Đường dẫn | Ghi chú |
|---|---|
| `/healthz` | `200 ok` — dùng cho health check / load balancer (Docker `HEALTHCHECK` đã cấu hình sẵn) |
| `/config.js` | cấu hình runtime, `Cache-Control: no-store` |
| `/assets/*` | file có hash, cache 1 năm `immutable` |
| `/`, `/index.html` | `no-cache` |

Build dùng đường dẫn tương đối nên đặt sau reverse proxy ở đường dẫn con (vd `https://site.com/games/xo/`) vẫn chạy.

## Sau reverse proxy / HTTPS

Container chỉ phục vụ HTTP. Đặt sau Nginx / Traefik / Caddy / Cloudflare để có HTTPS. Firebase Auth và clipboard cần HTTPS khi chạy trên tên miền thật (`localhost` là ngoại lệ).

## Luật Firebase

Luật bảo mật **không** nằm trong container. Deploy riêng:

```bash
npx firebase-tools login         # một lần
npm run rules:deploy
npm run rules:smoke              # kiểm tra luật trên project thật
```

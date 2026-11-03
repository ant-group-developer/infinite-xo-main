# Hướng dẫn tạo Firebase project (gói Spark)

Làm xong gửi lại cho tao **đoạn `firebaseConfig`** ở bước 2. Không cần gửi gì khác.
(Giao diện console có thể đổi chút ít, tên nút có thể khác nhẹ.)

## 1. Tạo project
1. Vào https://console.firebase.google.com → **Create a project** (Tạo dự án).
2. Đặt tên, ví dụ `infinite-xo`.
3. **Google Analytics:** nên bật (để đo giữ chân D1/D7 sau này). Chọn/tạo tài khoản Analytics.
4. Đợi tạo xong. Mặc định là **gói Spark** (miễn phí), **không** cần thẻ.

## 2. Đăng ký Web app → lấy config
1. Trang tổng quan project → biểu tượng **`</>` (Web)**.
2. App nickname: `infinite-xo-web`. **Chưa** cần tick Firebase Hosting.
3. Màn hình hiện đoạn code có:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...firebaseapp.com",
     databaseURL: "https://...firebasedatabase.app",   // có thể chưa có, xem bước 4
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
     measurementId: "G-..."
   };
   ```
   **Copy cả object này gửi tao.** `apiKey` ở đây **không phải bí mật** (ai mở web cũng thấy). Bảo mật nằm ở Security Rules. Gửi qua chat được.
   Lỡ đóng mất: ⚙️ **Project settings** → tab **General** → kéo xuống **Your apps** → **SDK setup and configuration** → chọn **Config**.

## 3. Bật đăng nhập (Authentication)
1. Menu **Build → Authentication → Get started**.
2. Tab **Sign-in method**:
   - **Anonymous** → Enable → Save.
   - **Google** → Enable → chọn **Project support email** (email của mày) → Save.
3. Tab **Settings → Authorized domains**: `localhost` đã có sẵn. Thêm **`127.0.0.1`** (dev server của tao đang chạy địa chỉ này). Sau này deploy lên domain nào thì thêm domain đó.

## 4. Tạo Realtime Database
1. **Build → Realtime Database → Create Database**.
2. **Location: Singapore (`asia-southeast1`)**, gần Việt Nam nhất nên độ trễ thấp. ⚠️ Location **không đổi được** sau khi tạo.
3. Security rules: chọn **Start in locked mode** (khóa hết). Tao sẽ viết rules thật và mày dán vào sau.
4. Sau khi tạo, quay lại **Project settings → Your apps → Config**: lúc này `databaseURL` đã có (dạng `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`). **Gửi tao bản config có `databaseURL`.**

## 5. (Tuỳ chọn) Cho tao chạy deploy rules từ máy này
Không bắt buộc, mày có thể tự dán rules trên console. Nếu muốn tao deploy giúp:
```bash
npm i -g firebase-tools
firebase login          # mở trình duyệt, đăng nhập Google của mày
```
Lệnh `firebase login` cần mày tự gõ vì phải đăng nhập tương tác. Trong Claude Code gõ: `! firebase login`.

## 6. Việc KHÔNG cần làm lúc này
- Không nâng cấp Blaze.
- Không bật Cloud Functions, Firestore, Storage.
- Không cần tạo service account / private key. **Đừng gửi** file service account cho ai, đó mới là bí mật thật.

## Checklist gửi lại
- [ ] Đoạn `firebaseConfig` **có `databaseURL`**
- [ ] Đã bật Anonymous + Google
- [ ] Đã thêm `127.0.0.1` vào Authorized domains
- [ ] (Tuỳ chọn) đã `firebase login`

Trong lúc chờ, tao làm trước P1 trên **Firebase Emulator** (chạy giả lập trên máy, không cần project thật).

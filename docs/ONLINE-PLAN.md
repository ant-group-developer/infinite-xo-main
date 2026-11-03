# Kế hoạch tính năng Online — Infinite XO (v2)

> Phạm vi: phòng chơi (2 slot chơi + slot xem, chat, chủ phòng kick), ghép trận (có bot "giả người" khi vắng người), tài khoản (ẩn danh → Google tuỳ chọn), xếp hạng quốc tế theo Elo + bậc Đồng/Bạc/Vàng…
> Backend: **Firebase Realtime Database (RTDB) + Firebase Auth, gói Spark (miễn phí)**. Lên Blaze khi đông người.
> Phiên bản lúc viết (2026‑11‑03): `firebase` 13.2.0, `firebase-tools` 15.34.2.
> Hướng dẫn tạo project: [`FIREBASE-SETUP.md`](./FIREBASE-SETUP.md).

---

## Trạng thái triển khai (2026-11-03, nhánh `feat/online`)

| Phase | Commit | Nội dung |
|---|---|---|
| P1 Nền tảng | `566b6c5` | Lớp `Db`/`Auth` 2 bản cài đặt (Firebase + Local), hồ sơ, presence, liên kết Google |
| P2 Phòng | `b57fd3a` | Mã phòng + link mời, ghế/người xem, kick, chuyển host, chat |
| P3 Ván online | `ed629b5` | Đồng bộ nước, 2 phút/nước, hòa/đầu hàng/rời trận, đấu lại, người xem vào giữa ván |
| P4 Xếp hạng | `05fdbf1` | Elo, bậc, bảng xếp hạng, lịch sử, mùa giải |
| P5 Ghép trận | `9be9d35` | Hàng chờ + transaction, bot persona theo Elo |
| P6 Hoàn thiện | commit cuối | Giới hạn 100 kết nối, báo cáo, Analytics, script deploy + kiểm tra luật |

**Khác với plan:**
- Máy không có Java → không dùng Firebase Emulator. Thay bằng backend **Local** (SharedWorker) cho dev + unit test, và `npm run rules:smoke` để kiểm tra luật trên project thật.
- Luật **không** tính lại chính xác từng điểm Elo (dễ sai khi chưa test được). Thay vào đó: điểm chỉ đổi khi có hồ sơ trận khớp với ván đã được luật xác minh, tối đa ±40, đúng chiều thắng/thua, mỗi trận một lần.
- **Chưa kiểm chứng trên project thật:** toàn bộ `database.rules.json` (đặc biệt phép tính số / ghép chuỗi trong luật kiểm tra chuỗi 5). Phải chạy `npm run rules:smoke` ngay khi có config.

## 0. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | **Gói Spark trước, Blaze sau.** Không có Cloud Functions → toàn bộ kiểm soát dùng **Security Rules** + client. Code chia lớp `Authority` để sau này đổi sang Functions mà không sửa phần khác. |
| D2 | **Chỉ trận ghép (ranked) mới tính điểm.** Phòng tự tạo = casual. |
| D3 | **Bảng xếp hạng cho tất cả tài khoản**, kể cả ẩn danh; xếp theo Elo/điểm hạng. Người chơi tự sửa tên/avatar/quốc gia. Liên kết Google là tuỳ chọn (để giữ tài khoản khi đổi máy). |
| D4 | **Đồng hồ: 2 phút cho mỗi nước** (reset sau mỗi nước). Hết giờ = thua. |
| D5 | **Ranked: người Elo thấp hơn cầm X (đi trước)**; bằng điểm → random. |
| D6 | **Vắng người → ghép với bot đóng vai người thật**, độ mạnh theo rank/Elo của người chơi. |

---

## 1. Hệ quả của gói Spark và cách xử lý

| Giới hạn Spark | Ảnh hưởng | Cách xử lý |
|---|---|---|
| **100 kết nối đồng thời** (quá là bị từ chối) | Đông người là có người không vào được | Chỉ mở kết nối RTDB khi vào màn online; rời màn online hoặc tab bị ẩn > 60s thì `goOffline()`. Bảng xếp hạng đọc 1 lần (`get`) rồi cache. Kết nối thất bại → báo "Máy chủ đang đông" và **tự chuyển sang trận với bot** (offline). Theo dõi số kết nối trên console để biết lúc nào lên Blaze. |
| Không có Cloud Functions | Không có server xác minh thắng/thua, điểm, ghép trận | **Rules làm trọng tài** (mục 5): kiểm tra lượt, ô trống, chuỗi thắng, hết giờ, công thức Elo. Ghép trận chạy ở client bằng **transaction**. |
| Bot chạy trên máy người chơi | Người sửa client có thể "cho bot thua" để ăn điểm | Giới hạn điểm từ trận bot (mục 3.4). Khi lên Blaze thì chuyển nước đi của bot lên server. |

> Phần "rules kiểm tra chuỗi thắng / công thức Elo" dùng phép tính số và ghép chuỗi trong rules. **Việc đầu tiên của P1** là dựng thử trên Emulator để xác nhận. Nếu rules không làm được, phương án dự phòng: ghi kết quả + điểm từ client (chấp nhận rủi ro gian lận đến khi lên Blaze).

---

## 2. Tài khoản & hồ sơ

1. Mở chế độ online lần đầu → `signInAnonymously()` → **uid** ổn định trên máy đó. Tự đặt tên `Khách#4821`, avatar + quốc gia (theo locale), người chơi tự sửa được.
2. Nút **"Liên kết Google"** (tuỳ chọn) → `linkWithPopup` **giữ nguyên uid**, điểm và lịch sử. Đổi máy chỉ cần đăng nhập Google là lấy lại tài khoản.
3. Google đã gắn với tài khoản khác (`auth/credential-already-in-use`) → hỏi "Chuyển sang tài khoản đó?" → `signInWithCredential`.
4. Tên hiển thị: 3–16 ký tự, lọc từ cấm, rules kiểm tra độ dài.

```
/users/{uid}     { name, avatar, country, createdAt, linked }
/stats/{uid}     { rating, games, w, l, d, streak, bestStreak, peak, season, lastMatch, botToday, botDay }
/status/{uid}    { state, lastSeen }        // presence: .info/connected + onDisconnect
```

---

## 3. Ghép trận (ranked) + bot đóng vai người

### 3.1 Luồng
```
Bấm "Tìm trận"
  ├─ ghi /queue/{uid} { rating, joinedAt, botAt }   (onDisconnect → xoá)
  ├─ quét queue tìm người có |Δ| ≤ cửa sổ (100, +50 mỗi 5s)
  │    → transaction chiếm vé của đối thủ (2 người ghép trùng thì chỉ 1 transaction thành công)
  │    → tạo /rooms/{id} type 'ranked'; Elo thấp hơn cầm X
  └─ đến thời điểm botAt mà chưa có người → ghép với BOT (trông như người thật)
```
- `botAt` = hiện tại + **random 4–12 giây** (thời gian "đang tìm" trông tự nhiên).
- Ngưỡng nằm trong `/config/matchmaking { botEnabled, botAfterMinMs, botAfterMaxMs }` → **chỉnh trên Firebase console**, không cần deploy lại. Khi đông người thì tăng thời gian chờ hoặc tắt bot.

### 3.2 Hồ sơ bot (persona)
- Một danh sách ~200 persona cố định, sinh bằng script seed: tên (Việt + quốc tế), avatar, quốc gia, "số trận đã chơi", Elo nền.
- Khi ghép: chọn persona có Elo **≈ Elo người chơi ± 60** (ngẫu nhiên), chưa gặp người này trong 10 trận gần nhất.
- Elo của persona trôi nhẹ theo kết quả để hồ sơ trông "sống".
- **Đề xuất:** persona **không** lên bảng xếp hạng (giữ bảng là người thật, tránh người chơi đuổi theo "người" không tồn tại). Nếu mày muốn bot xuất hiện trên bảng thì làm được, nhưng nên giới hạn ngoài top 100.

### 3.3 Độ mạnh bot theo Elo
Một tham số `skill` liên tục thay cho 3 mức Dễ/Vừa/Khó:

| Elo người chơi | Bậc | Bot tương ứng |
|---|---|---|
| < 1100 | Đồng | gần **Dễ**: chặn nước thua 60–75%, hay chọn nước "tạm được" |
| 1100–1299 | Bạc | giữa Dễ và Vừa |
| 1300–1499 | Vàng | **Vừa** |
| 1500–1699 | Bạch Kim | Vừa + tìm kiếm nông (150 ms) |
| 1700–1899 | Kim Cương | **Khó** 300 ms |
| ≥ 1900 | Cao Thủ+ | Khó 700 ms + VCF đầy đủ |

**Hiệu chỉnh:** chạy giải bot-vs-bot (đã có `npm run bench`) để đo Elo thật của từng mức `skill`, rồi map vào bảng trên để người chơi thắng khoảng **50%** trước bot cùng trình.

### 3.4 Hành vi "giống người"
- Thời gian nghĩ **3–15 giây** (đồng hồ 2 phút/nước): nhanh khi chỉ có một nước bắt buộc, lâu hơn ở thế phức tạp, thỉnh thoảng nghĩ lâu bất thường.
- Thua chắc (người chơi đã có nước thắng không chặn được) → đôi khi **đầu hàng**; còn lại đánh tới cùng.
- Xin hòa: chấp nhận theo đánh giá thế cờ (logic đã có).
- Không chat chữ; thỉnh thoảng thả emoji (nếu làm tính năng emoji).
- Bot không bao giờ "rớt mạng", không treo hết giờ.

### 3.5 Điểm từ trận bot
- Tính Elo bình thường để người chơi thấy tiến bộ.
- **Chống farm khi bot chạy trên client:** tối đa **15 trận bot có tính điểm mỗi ngày** (rules kiểm tra `botToday`); K giảm một nửa khi Elo > 1700.

### 3.6 Lưu ý
- Nhiều game mobile làm vậy. Nên có một dòng trong **Điều khoản**: *"Khi ít người chơi, hệ thống có thể ghép bạn với đối thủ AI."* Rủi ro bị review xấu thấp hơn nhiều so với không ghi.
- Khi lượng người tăng: giảm dần tỉ lệ bot qua `/config` để người chơi gặp người thật nhiều hơn.

---

## 4. Phòng chơi (casual)

| Yêu cầu | Thiết kế |
|---|---|
| Tạo phòng | `/rooms/{id}` + mã 6 ký tự `/roomCodes/{CODE}`; công khai (hiện ở sảnh) hoặc riêng tư (chỉ vào bằng mã/link `#/r/CODE`) |
| 2 slot chơi + slot xem | `slots {X, O}`; thành viên không ở slot = người xem (tối đa 30) |
| Tự chọn slot chơi/xem | Bấm slot trống → **transaction** chiếm slot; bấm "Xem" → nhả slot (chỉ khi chưa vào ván) |
| Chủ phòng kick | Host ghi `kicked/{uid}` + xoá khỏi `members`/`slots` → client bị kick tự rời + toast; **không vào lại được** phòng đó |
| Chat | 50 tin gần nhất, ≤ 200 ký tự, rules giới hạn 1 tin/giây, lọc từ cấm, nút tắt tiếng người khác |
| Host rời đi | Chuyển host cho thành viên vào sớm nhất (client còn lại tự nhận qua transaction) |
| Bắt đầu / đấu lại | Đủ 2 slot + cả hai bấm **Sẵn sàng** → host bấm Bắt đầu. Hết ván → **Đấu lại** (đổi X/O) |
| Dọn phòng (không có Functions) | Thành viên cuối cùng rời → xoá phòng (onDisconnect). Phòng mồ côi: client nào mở sảnh thì dọn phòng có `lastActive` > 30 phút (rules cho phép xoá khi quá hạn) |

```
/rooms/{id}
  meta    { hostUid, name, visibility, code, type: 'casual'|'ranked'|'bot', createdAt, lastActive, status }
  slots   { X: uid|null, O: uid|null }       ready { X, O }
  members { [uid]: { name, avatar, joinedAt } }
  kicked  { [uid]: true }
  bot     { personaId, skill }               // chỉ khi type = 'bot'
  game    { moves: {[i]: {x,y,p,t}}, board: {"x_y": p}, n, turn, turnStart,
            result: { winner, reason: 'five'|'timeout'|'resign'|'draw', line? } }
  chat    { [pushId]: { uid, name, text, t } }
/roomIndex/{id}  { name, players, spectators, status, lastActive }   // danh sách sảnh
```

**Đồng bộ ván:** `OnlineGameController` nghe `game/moves` → gọi `game.play()` trên `Game` local, nên toàn bộ renderer, HUD, âm thanh, hiệu ứng (và bản 3D sau này) giữ nguyên. Bấm ô → ghi multi‑path atomic (`moves/n`, `board/x_y`, `n`, `turn`, `turnStart = serverTimestamp`), hiện trước rồi rollback nếu rules từ chối.

---

## 5. Rules làm trọng tài (thay Cloud Functions)

Mỗi mục dưới đây sẽ có test bằng `@firebase/rules-unit-testing` trên Emulator.

| Kiểm tra | Cách làm |
|---|---|
| Đúng lượt, đúng người | `moves/$i`: `p == turn` và `slots/p == auth.uid` (hoặc là chủ trận bot, khi ghi nước của bot) |
| Không đánh đè | `board/$cell: !data.exists()` |
| Thứ tự nước | `$i == n` cũ; `n` mới = `n` cũ + 1 |
| Thời gian | `t == now`, `turnStart == now` |
| **Hết giờ** | Ghi `result {reason:'timeout'}` chỉ hợp lệ khi `now > turnStart + 120000` và người thắng là bên **không** tới lượt |
| **Thắng bằng chuỗi 5** | `result.line = {sx, sy, dx, dy, len}` (5 ≤ len ≤ 9). Rules đọc từng ô `board/(sx+i*dx)_(sy+i*dy)` (viết sẵn cho i = 0..8, kèm điều kiện `len > i`), kiểm tra 2 ô ngoài hai đầu **không phải quân mình** (đúng là chuỗi tối đa) và **không đồng thời là quân đối thủ**. Đây đúng luật trong spec. |
| Đầu hàng | chỉ chủ slot được ghi mình thua |
| Hòa | cần cờ đồng ý của **cả hai** slot |
| **Elo** | Bên ghi kết quả ghi luôn `/stats` của cả hai trong cùng một update. Rules kiểm tra: `rating_mới ≈ rating_cũ + K·(S − E)` (sai số ±1) với `E = clamp(0.5 + (R_mình − R_đối)/700, 0.06, 0.94)` (Elo tuyến tính hoá vì rules không có hàm mũ; lệch nhỏ so với Elo chuẩn trong khoảng ±300 điểm). Thêm `/matches/{id}/rated/{uid}` chỉ ghi được một lần → **mỗi trận chỉ cộng điểm một lần**. |

**Còn hở trên Spark:** trận với bot (client điều khiển cả hai bên) → đã giới hạn ở 3.4–3.5. Lên Blaze thì thay bằng Function. Phần này nằm sau interface `Authority` nên đổi được mà không sửa chỗ khác.

---

## 6. Điểm, bậc, mùa giải, bảng xếp hạng

- Elo bắt đầu **1000**. K = 40 trong 20 trận đầu, 24 đến 2100, 16 từ 2100 trở lên. Đầu hàng / hết giờ = thua; hòa = 0.5.
- Bậc (mỗi bậc chia III/II/I): 🥉 Đồng < 1100 · 🥈 Bạc 1100–1299 · 🥇 Vàng 1300–1499 · 💠 Bạch Kim 1500–1699 · 💎 Kim Cương 1700–1899 · 👑 Cao Thủ 1900–2099 · 🔥 Đại Cao Thủ ≥ 2100 · ⚡ Thách Đấu = top 50 và ≥ 2100.
- Hoạt cảnh thăng/giáng hạng sau trận; huy hiệu bậc cạnh tên ở mọi nơi.
- Mùa giải 2 tháng. Reset mềm `R = 1000 + (R − 1000) × 0.5`; thưởng khung avatar theo bậc cao nhất mùa. Không có Functions → **client đầu tiên đăng nhập sau khi mùa mới mở** sẽ tự áp reset cho chính mình (rules kiểm tra công thức + số mùa).
- Bảng xếp hạng: `/stats` có `.indexOn: rating` → `orderByChild('rating').limitToLast(100)`. Hai tab **Toàn cầu** / **Quốc gia**; luôn hiện hạng của chính mình. Cache 60 giây để tiết kiệm kết nối.
- Chống nuôi điểm (rules): từ trận thứ 4 với cùng đối thủ trong ngày → K × 0.5; từ trận thứ 6 → 0.

---

## 7. Cấu trúc code

```
src/net/
  firebase.ts            init (lazy import), connect Emulator khi dev, goOnline/goOffline
  auth.ts  profile.ts  presence.ts
  rooms.ts  chat.ts  matchmaking.ts
  authority/             interface Authority { submitResult, applyRating, claimTimeout }
    RulesAuthority.ts    (Spark)  → FunctionsAuthority.ts (Blaze, sau này)
  OnlineGameController.ts
src/ai/persona.ts        persona + skill map + think-time "giống người"
src/screens/             Home · Lobby · Room · Match · Profile · Leaderboard (router hash)
database.rules.json      + tests/rules/*.test.ts (Emulator)
firebase.json            emulators: auth, database
scripts/seed-personas.ts tạo /bots + /config
```

---

## 8. Lộ trình (1 dev)

| Giai đoạn | Nội dung | Thời gian |
|---|---|---|
| **P1 Nền tảng** | Firebase SDK + Emulator; **kiểm chứng rules trọng tài**; auth ẩn danh + link Google; hồ sơ; presence; router màn hình | 3 ngày |
| **P2 Phòng** | Tạo/vào phòng, mã/link, slot chơi/xem, ready/start, kick, chuyển host, chat, dọn phòng, test rules | 4–5 ngày |
| **P3 Ván online** | Đồng bộ nước, đồng hồ 2 phút/nước + nhận thắng khi hết giờ, đầu hàng/hòa, vào lại sau rớt mạng, người xem vào giữa ván, đấu lại | 3–4 ngày |
| **P4 Ranking** | Elo + rules kiểm Elo, bậc, hoạt cảnh lên hạng, bảng xếp hạng, lịch sử trận, mùa giải | 3–4 ngày |
| **P5 Ghép trận + bot persona** | Queue + transaction, nới cửa sổ, bot giả người theo Elo, hiệu chỉnh skill bằng bench, `/config` | 3–4 ngày |
| **P6 Hoàn thiện** | Xử lý giới hạn 100 kết nối, lọc chat, báo cáo/chặn, Analytics, deploy Firebase Hosting | 2–3 ngày |
| | **Tổng** | **~3–4 tuần** |

---

## 9. Đề xuất thêm (giữ chân & kéo người)

| # | Tính năng | Lý do | Công sức |
|---|---|---|---|
| 1 | **Câu đố hằng ngày "Thắng trong 3 nước"** + chuỗi ngày | Lý do quay lại mỗi ngày; solver VCF có sẵn sinh/kiểm đề | Thấp |
| 2 | **Nhiệm vụ ngày + điểm danh → xu → skin/theme/hiệu ứng thắng** | Vòng lặp giữ chân kiểu Poki | TB |
| 3 | **Đấu lại, link mời, bạn bè, ai đang online** | Lan truyền | TB |
| 4 | **Replay & chia sẻ khoảnh khắc thắng** | Viral | Thấp–TB |
| 5 | **Bot phân tích sau trận** | Người chơi tiến bộ → gắn bó ranked | TB |
| 6 | Thành tựu / huy hiệu | Mục tiêu dài hạn | Thấp |
| 7 | Emoji reaction trong trận | Vui, an toàn hơn chat | Thấp |
| 8 | Xem trận top đang diễn ra | Có sẵn nhờ người xem | Thấp |
| 9 | Giải đấu cuối tuần | Sự kiện định kỳ | Cao |
| 10 | PWA + thông báo đẩy | Kéo người quay lại | TB |
| 11 | Swap2 cho rank cao | Công bằng lượt đi | TB |

---

## Nguồn
- RTDB limits: https://firebase.google.com/docs/database/usage/limits
- RTDB Security Rules API (`now`, `root/data/newData`, `$` vars): https://firebase.google.com/docs/reference/security/database
- Functions FAQ (Blaze): https://firebase.google.com/docs/functions/faq-and-troubleshooting
- Anonymous auth / link: https://firebase.google.com/docs/auth/flutter/anonymous-auth
- Presence / onDisconnect: https://firebase.google.com/docs/database/flutter/offline-capabilities
- Authorized domains: https://support.google.com/firebase/answer/6400741

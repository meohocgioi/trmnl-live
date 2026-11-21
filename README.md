# TRMNL Live – TikTok Live trên TRMNL

Plugin TRMNL hiện trạng thái live của các tài khoản **TikTok, YouTube, Facebook**:

- **Đang live** → ảnh chụp màn hình phòng live hiện tại.
- **Không live** → avatar + chữ **OFFLINE**.
- Tối đa 3 người hiện cạnh nhau trên màn hình (ưu tiên người đang live).
- Điều khiển bằng bot Telegram, báo tin khi ai đó bắt đầu / kết thúc live.

Chạy hoàn toàn trên **Cloudflare Workers** (không cần máy chủ). Code mới chỉ được deploy khi bấm **/update** trên Telegram (hoặc *Run workflow* trên GitHub) — không tự động, không kiểm tra định kỳ.

## Cài đặt (1 lần)

### 1. Cloudflare API token
Cloudflare → *My Profile → API Tokens → Create Token* → dùng mẫu **Edit Cloudflare Workers**, rồi **thêm quyền**:
- `Account › Browser Rendering › Edit`

(Mẫu đã có sẵn Workers Scripts, Workers KV Storage, Account Settings.)

### 2. GitHub Secrets
Repo → *Settings → Secrets and variables → Actions → New repository secret*:

| Tên | Giá trị | Bắt buộc |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | token ở bước 1 | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID Cloudflare | ✅ |
| `TELEGRAM_BOT_TOKEN` | token từ @BotFather | cho bot |
| `TELEGRAM_OWNER_ID` | Telegram user ID của bạn | không (nếu bỏ trống, người đầu tiên bấm /start là chủ) |
| `TIKTOK_COOKIE` | cookie TikTok (nếu phòng live yêu cầu đăng nhập) | không |
| `GH_TOKEN` | GitHub fine-grained token, quyền **Actions: Read and write** cho repo này (để /update chạy được) | cho /update |
| `FACEBOOK_COOKIE` | cookie Facebook (bắt buộc nếu theo dõi Facebook; nên dùng tài khoản phụ) | cho Facebook |

Sau đó vào tab **Actions → Deploy Worker → Run workflow**.

### 3. TRMNL
Tạo **Private Plugin** → Strategy **Polling** → Polling URL:
`https://trmnl-live.<subdomain>.workers.dev/trmnl`
Markup: dán nội dung file [`trmnl/full.liquid`](trmnl/full.liquid).

## Lệnh Telegram
`/status` `/shot` `/shot tên` `/add link` (TikTok/YouTube/Facebook) `/add yt tên` `/add fb tên` `/add tt tên` `/remove tên` `/list` `/settings` `/trmnl` `/help`

- TikTok: chụp màn hình phòng live (tốn quota trình duyệt), dự phòng ảnh cover.
- YouTube: ảnh thumbnail live do YouTube cập nhật, không tốn quota.
- Facebook (thử nghiệm): cần `FACEBOOK_COOKIE`.

## Giới hạn gói Free
- Browser Rendering: 10 phút/ngày → bot tự dừng chụp màn hình ở 540s và chuyển sang ảnh cover.
- KV: 1.000 lượt ghi/ngày → kiểm tra mỗi 10 phút (mặc định) là an toàn.

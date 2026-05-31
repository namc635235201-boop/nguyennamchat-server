# 🤖 NGUYENNAMCHAT — TÀI LIỆU HƯỚNG DẪN TOOL

> **Tác giả:** Nguyễn Nam  
> **Ngày tạo:** 31/05/2026  
> **Mục đích:** Chatbot tự động trả lời tin nhắn Fanpage Facebook bằng AI

---

## 📌 TOOL NÀY LÀM GÌ?

Khi khách hàng nhắn tin vào **Fanpage Facebook** của mày → Bot AI tự động đọc tin nhắn và trả lời ngay lập tức, 24/7 — không cần mày ngồi trực.

```
Khách nhắn tin Fanpage
       ↓
Facebook gửi tin về Server (Webhook)
       ↓
Server gọi Groq AI tạo câu trả lời
       ↓
Bot gửi trả lời cho khách ngay lập tức
```

---

## 🗂 CẤU TRÚC THƯ MỤC

```
d:\chatbot\
│
├── index.html          → Trang Landing Page (giao diện khách hàng thấy)
├── dashboard.html      → Trang Quản Trị (của chủ tool)
├── app.js              → Logic frontend (đăng nhập FB, kết nối fanpage)
├── style.css           → Giao diện toàn bộ tool
│
└── messenger-bot\      → SERVER BACKEND
    ├── server.js       → Server chính (xử lý webhook, gọi AI)
    ├── script.js       → Kịch bản mặc định cho AI
    ├── .env            → Thông tin bí mật (API keys)
    ├── config.json     → Cấu hình hệ thống
    ├── pages.json      → Danh sách Fanpage đã kết nối
    └── package.json    → Thư viện Node.js
```

---

## ⚙️ CÔNG NGHỆ SỬ DỤNG

| Thành phần | Công nghệ | Mục đích |
|-----------|-----------|----------|
| Frontend | HTML + CSS + JavaScript | Giao diện người dùng |
| Backend | Node.js + Express | Server xử lý webhook |
| AI | Groq API (Llama 3.3 70B) | Tạo câu trả lời tự động |
| Webhook | Facebook Graph API | Nhận tin nhắn từ Fanpage |
| Deploy | Railway.app | Host server trên internet |

---

## 🔑 THÔNG TIN CẤU HÌNH

### File `.env` (d:\chatbot\messenger-bot\.env)

```
FB_APP_ID=your_facebook_app_id
FB_APP_SECRET=your_facebook_app_secret
VERIFY_TOKEN=your_verify_token
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
PORT=3000
```

> ⚠️ Thay các giá trị `your_*` bằng thông tin thật của bạn. Không bao giờ commit API key thật lên GitHub!

### Tài khoản liên quan
- **Facebook App:** developers.facebook.com/apps/759513787182248
- **Groq API:** console.groq.com
- **Railway Deploy:** railway.app

---

## 🚀 CÁCH CHẠY SERVER (Local)

Mở PowerShell, chạy lần lượt:

```powershell
cd d:\chatbot\messenger-bot
npm install
node server.js
```

- Server: `http://localhost:3000`
- Dashboard: `http://localhost:3000/dashboard`

---

## 🌐 DEPLOY LÊN RAILWAY (Chạy 24/7)

```powershell
railway login
cd d:\chatbot\messenger-bot
railway init
railway up --detach
railway domain
```

→ Sẽ có link: `https://nguyennamchat.up.railway.app`

---

## 📡 CÀI WEBHOOK FACEBOOK

Vào: developers.facebook.com/apps/759513787182248/messenger/settings/

1. Webhooks → Edit
2. Callback URL: `https://nguyennamchat.up.railway.app/webhook`
3. Verify Token: `mysecrettoken123`
4. Tick: messages + messaging_postbacks → Save
5. Pages → chọn Fanpage → Add Subscriptions

---

## 🔌 KẾT NỐI FANPAGE

1. Mở Dashboard trên Railway
2. Đăng nhập Facebook
3. Chọn Fanpage → Kết nối
4. ✅ Bot bắt đầu tự trả lời

---

## 📋 CÁC API ENDPOINT

| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| GET | `/` | Trang chủ server |
| GET | `/dashboard` | Trang quản trị |
| GET | `/webhook` | Facebook xác minh |
| POST | `/webhook` | Nhận tin nhắn |
| GET | `/api/connected-pages` | Danh sách Fanpage |
| POST | `/api/connect-page` | Kết nối Fanpage mới |
| POST | `/api/update-script` | Cập nhật kịch bản AI |
| POST | `/api/save-config` | Lưu cấu hình |
| POST | `/api/reset-all` | Reset hệ thống |
| GET | `/orders` | Xem đơn hàng |

---

## ⚠️ LƯU Ý QUAN TRỌNG

- Không chia sẻ file `.env` với ai
- Groq miễn phí: 14,400 requests/ngày
- Railway miễn phí: 500 giờ/tháng
- Facebook App đang ở chế độ Development → cần submit review để dùng công khai

---

## 🛠 XỬ LÝ SỰ CỐ

| Vấn đề | Cách sửa |
|--------|----------|
| Bot không trả lời | Cài lại webhook Facebook |
| Bot trả lời sai | Sửa Script trong Dashboard |
| Server lỗi 500 | Kiểm tra file `.env` |
| Không kết nối Fanpage | Thêm tài khoản vào Role tester |

---

*Cập nhật lần cuối: 31/05/2026*

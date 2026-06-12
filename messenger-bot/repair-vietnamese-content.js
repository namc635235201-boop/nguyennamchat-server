const fs = require("fs");

const pageScript = `
Bạn là nhân viên tư vấn của "Nguyễn Nam Ads".

THÔNG TIN LIÊN HỆ:
- Hotline/Zalo: 0898 377 771
- Địa chỉ: 23 Nay Thông, EaTam, Buôn Ma Thuột
- Website: nguyennamads.com

DỊCH VỤ CHÍNH:
Nguyễn Nam Ads tư vấn và chạy quảng cáo Facebook cho khách hàng kinh doanh online.

DỊCH VỤ PHỤ:
Có hỗ trợ chỉnh sửa hình ảnh, thiết kế ảnh quảng cáo và dựng video ngắn bán hàng, nhưng chỉ nhắc đến khi khách hỏi đúng về ảnh, video hoặc thiết kế.

BẢNG GIÁ CHẠY QUẢNG CÁO:
- Gói ngày: 300k/ngày, chạy tối thiểu 7 ngày.
- Gói chạy thử cho khách mới: từ 3-5 triệu/tháng.
- Gói chạy ổn định theo tháng: từ 5-20 triệu/tháng.
- Phí dịch vụ với ngân sách từ 5 triệu/tháng trở lên: 5%.
- Phí dịch vụ với ngân sách dưới 5 triệu/tháng: 10%.
- Phí dịch vụ thu sau khi quảng cáo bắt đầu hoạt động, không thu phí dịch vụ trước.

MỤC TIÊU:
Tư vấn thông minh, tự nhiên như người thật. Nói chuyện lịch sự, thân thiện, trả lời ngắn gọn và hỏi han để hiểu nhu cầu của khách hàng trước khi mời khách nhắn Zalo/Hotline 0898 377 771 để trao đổi chuyên sâu.

QUY TẮC BẮT BUỘC:
- Mỗi lần trả lời chỉ dùng 1 đến 3 câu ngắn gọn. Không viết dài dòng.
- Nếu khách chào (Alo, hi, chào...), BẮT BUỘC phải chào lại lịch sự và hỏi khách hàng đang muốn chạy quảng cáo cho sản phẩm/ngành hàng nào.
- Khi khách hỏi ngành này chạy được không, hãy khẳng định là chạy rất tốt, sau đó giới thiệu qua các gói ngân sách và hỏi thêm xem khách đã có Fanpage sẵn hay bắt đầu chạy mới.
- Không dồn dập bắt khách add Zalo ngay từ câu chào đầu tiên. Chỉ gợi ý nhắn Zalo/Hotline khi khách hỏi sâu về giá cụ thể, xin kế hoạch hoặc muốn trao đổi trực tiếp qua điện thoại.
- Luôn bám sát sản phẩm/ngành hàng mà khách nhắc tới.
- Thỉnh thoảng dùng 1 emoji phù hợp như 😊 📌 ✅ 📞, không spam.
- Không tự bịa giá khác ngoài bảng giá trên.
- Nếu khách hỏi ai tạo bot, trả lời do anh Nguyễn Nam Ads tạo ra.
`;

function repairPagesJson() {
  const path = "pages.json";
  const pages = JSON.parse(fs.readFileSync(path, "utf8"));
  const pageId = "888451557694404";
  const page = pages[pageId] || Object.values(pages)[0];

  if (!page) {
    throw new Error("Không tìm thấy Fanpage trong pages.json.");
  }

  page.name = "Thực Chiến Cùng Nguyễn Nam Ads";
  page.script = pageScript;
  fs.writeFileSync(path, JSON.stringify(pages, null, 2) + "\n", "utf8");
}

function repairDashboardHtml() {
  const path = "dashboard.html";
  let html = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");

  const replacements = [
    ["â³", "⏳"],
    ["ðŸ”„", "🔄"],
    ["ðŸ¤–", "🤖"],
    ["ðŸ“¡", "📡"],
    ["ðŸ“‹", "📋"],
    ["âš™ï¸", "⚙️"],
    ["ðŸ‘¥", "👥"],
    ["ðŸ“¦", "📦"],
    ["âœï¸", "✏️"],
    ["ðŸ“·", "📷"],
    ["ðŸ“„", "📄"],
    ["ðŸ—‘", "🗑"],
    ["ðŸ’¡", "💡"],
    ["ðŸª", "🏪"],
    ["ðŸ“œ", "📜"],
    ["ðŸ—£", "🗣"],
    ["ðŸš«", "🚫"],
    ["ðŸ“ž", "📞"],
    ["âœ…", "✅"],
    ["ðŸ’¾", "💾"],
    ["ðŸš¨", "🚨"],
    ["ðŸ“…", "📅"],
    ["ðŸ‘¤", "👤"],
    ["ðŸ†“", "🆓"],
    ["ðŸ¥ˆ", "🥈"],
    ["ðŸ¥‡", "🥇"],
    ["ðŸ’Ž", "💎"],
    ["ðŸ“­", "📭"],
    ["ðŸšª", "🚪"],
    ["ðŸŸ¢", "🟢"],
    ["ðŸ“ˆ", "📈"],
    ["ðŸ’°", "💰"],
    ["ðŸ¤", "🤝"],
    ["ðŸ˜Š", "😊"],
    ["vÃ  <a href=\"#\">Điều khoản</a> cá»§a NguyenNamChat", "và <a href=\"#\">Điều khoản</a> của NguyenNamChat"],
    ["Lưu cÃ i Ä‘áº·t", "Lưu cài đặt"],
    ["VÃ™NG NGUY HIá»‚M: RESET Há»† THá»NG", "VÙNG NGUY HIỂM: RESET HỆ THỐNG"],
    ["Xóa sáº¡ch toÃ n bá»™ Fanpage Ä‘Ã£ káº¿t ná»‘i, lá»‹ch sá»­ Ä‘Æ¡n hÃ ng vÃ  khÃ´i phá»¥c cÃ i Ä‘áº·t máº·c Ä‘á»‹nh.", "Xóa sạch toàn bộ Fanpage đã kết nối, lịch sử đơn hàng và khôi phục cài đặt mặc định."],
    ["Xóa há»™i thoáº¡i", "Xóa hội thoại"],
    ["âš ï¸ ChÆ°a cÃ³ ká»‹ch báº£n. HÃ£y viáº¿t ká»‹ch báº£n á»Ÿ tab <b>📋 Kịch bản</b> bÃªn trÃ¡i rá»“i nháº¥n <b>Ãp dá»¥ng</b>.", "⚠️ Chưa có kịch bản. Hãy viết kịch bản ở tab <b>📋 Kịch bản</b> bên trái rồi nhấn <b>Áp dụng</b>."],
    ["value=\"Fanpage cua ban\"", "value=\"Nguyễn Nam Ads\""],
    ["id=\"ms-shop-name\">Fanpage cua ban", "id=\"ms-shop-name\">Nguyễn Nam Ads"]
  ];

  for (const [bad, good] of replacements) {
    html = html.split(bad).join(good);
  }

  fs.writeFileSync(path, html, "utf8");
}

repairPagesJson();
repairDashboardHtml();
console.log("Đã sửa pages.json và dashboard.html.");

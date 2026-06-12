const axios = require('axios');

const PAGE_ID = "888451557694404";
const senderId = "test-user-" + Date.now();

async function sendMsg(text) {
  console.log(`\n🧑 User: ${text}`);
  try {
    const res = await axios.post("http://localhost:3000/api/test-chat", {
      pageId: PAGE_ID,
      text: text,
      senderId: senderId
    });
    console.log(`🤖 Bot: ${res.data.reply}`);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}

async function runTest() {
  await sendMsg("Mình muốn chạy quảng cáo facebook");
  await sendMsg("Chạy spa, ngân sách 1 triệu/ngày");
  await sendMsg("Mình chưa từng chạy bao giờ");
  await sendMsg("Chạy fanpage nha");
}

runTest();

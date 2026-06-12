const axios = require('axios');

async function test(text) {
  try {
    const resp = await axios.post('http://localhost:3000/api/test-chat', {
      pageId: '888451557694404',
      text: text,
      senderId: 'dashboard-test'
    });
    console.log(`[${text}] →`, resp.data.reply);
  } catch (err) {
    console.error(`[${text}] → ERROR:`, err.response?.data || err.message);
  }
}

async function main() {
  await test('Alo');
  await test('tôi cần chạy quảng cáo spa');
  await test('ngành nội thất chạy được không');
  await test('chi phí bao nhiêu');
  await test('Zalo mình liên hệ đi');
}

main();

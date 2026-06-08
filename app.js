// =============================================
//  CHATBOT DATA & CONFIG
// =============================================

let SHOP_NAME = "Fanpage cua ban";
let BOT_AVATAR = "https://ui-avatars.com/api/?name=Fanpage&background=1877f2&color=fff&size=28";
let SERVER_URL = localStorage.getItem('server_url') || ((window.location.protocol !== 'file:') ? window.location.origin : 'http://localhost:3000');

const CLEAN_DEFAULT_CUSTOMER_SCRIPT = `Ban la nhan vien tu van cua "[TEN THUONG HIEU]".

THONG TIN LIEN HE:
- Hotline/Zalo: [SO HOTLINE/ZALO]
- Dia chi: [DIA CHI]
- Website: [WEBSITE]

DICH VU / SAN PHAM CHINH:
- [DICH VU HOAC SAN PHAM 1]
- [DICH VU HOAC SAN PHAM 2]
- [DICH VU HOAC SAN PHAM 3]

BANG GIA / GOI DICH VU:
- [GOI 1]: [GIA / MO TA]
- [GOI 2]: [GIA / MO TA]
- [GOI 3]: [GIA / MO TA]

MUC TIEU:
Tu van nhu nguoi that, tra loi ngan gon, hoi dung nhu cau va huong khach qua Hotline/Zalo da cau hinh de trao doi nhanh hon.

QUY TAC TRA LOI:
- Moi lan tra loi 1-3 cau ngan.
- Neu khach chao, phai chao lai va hoi khach can ho tro gi.
- Neu khach hoi gia, bao dung bang gia trong kich ban, khong tu bia gia.
- Neu khach hoi dich vu/san pham nao, bam theo dung noi dung khach hoi.
- Neu chua du thong tin de bao gia, hoi them nhu cau va moi khach gui thong tin qua Hotline/Zalo da cau hinh.
- Thinh thoang dung toi da 1 emoji phu hop, khong spam emoji.
- Khong nhac dich vu ngoai kich ban neu khach khong hoi.

CAU CHAO MAU:
"Da em chao anh/chi a 😊 Em la tu van vien cua [TEN THUONG HIEU]. Anh/chi can em ho tro phan nao a?"

KHI KHACH HOI HOTLINE / ZALO:
"Da Hotline/Zalo ben em la [SO HOTLINE/ZALO] a."

KHI KHACH HOI DIA CHI:
"Da dia chi ben em o [DIA CHI] a."

KHI KHACH HOI WEBSITE:
"Da website ben em la [WEBSITE] a."

KHONG DUOC LAM:
- Khong dung thong tin, so dien thoai, dia chi hoac bang gia cua doanh nghiep khac.
- Khong tra loi dai dong khi khach hoi don gian.
- Khong tu tao gia, cam ket hoac chinh sach neu kich ban chua co.`;

const PRODUCTS = [
  {
    id: "ads-budget",
    name: "Tối ưu ngân sách Ads",
    emoji: "📈",
    price: 500000,
    priceStr: "Từ 500.000đ/ngày",
    battery: "Nhận phí sau khi hiệu quả",
    waterproof: "Thanh toán ngân sách theo ngày",
    warranty: "Tối ưu tối đa chuyển đổi",
    desc: "Chạy quảng cáo Facebook tối ưu chi phí, tiếp cận đúng khách hàng mục tiêu, cam kết hỗ trợ tối đa.",
    stars: "⭐⭐⭐⭐⭐ (4.9/5)",
    sold: "150+ dự án"
  },
  {
    id: "content-design",
    name: "Thiết kế bài viết & Fanpage",
    emoji: "🎨",
    price: 300000,
    priceStr: "Từ 300.000đ/bài",
    battery: "Không phí trước",
    waterproof: "Hỗ trợ Marketing chuyên nghiệp",
    warranty: "Chỉnh sửa nội dung miễn phí",
    desc: "Thiết kế hình ảnh chuyên nghiệp, viết bài quảng cáo và tối ưu Fanpage chuẩn chỉnh.",
    stars: "⭐⭐⭐⭐⭐ (4.8/5)",
    sold: "800+ bài viết"
  }
];

// =============================================
//  STATE MACHINE
// =============================================
const STATE = {
  IDLE: "idle",
  SHOW_PRODUCTS: "show_products",
  SHOW_DETAIL: "show_detail",
  CONFIRM_ORDER: "confirm_order",
  COLLECT_NAME: "collect_name",
  COLLECT_PHONE: "collect_phone",
  COLLECT_ADDRESS: "collect_address",
  DONE: "done"
};

let state = STATE.IDLE;
let selectedProduct = null;
let orderData = {};
let orders = [];
let groqApiKey = "";
const groqKeyCooldowns = {};
const GROQ_KEY_COOLDOWN_MS = 60 * 1000;
let isTyping = false;

// Facebook auth data (real)
let fbUserAccessToken = null;
let fbUserId = null;
let fbUserName = null;
let fbPages = []; // [{id, name, access_token, picture}]
let connectedPages = []; // pages that have been connected to our server

// =============================================
//  INTENT DETECTION (keywords)
// =============================================
const INTENTS = {
  greeting: ["chào", "hello", "hi", "alo", "hey", "xin chào"],
  ask_products: ["dịch vụ", "báo giá", "bên mình", "chạy quảng cáo", "ads", "xem gói", "gói chạy"],
  ask_price: ["giá", "bao nhiêu tiền", "giá cả", "bao nhiêu", "phí", "ngân sách"],
  want_order: ["chạy", "muốn chạy", "đăng ký", "hợp tác", "tư vấn", "lấy gói", "muốn tư vấn"],
  ask_warranty: ["cam kết", "hiệu quả", "uy tín"],
  ask_shipping: ["thanh toán", "cọc", "thu phí trước", "ngân sách theo ngày"],
};

function detectIntent(text) {
  const lower = text.toLowerCase();
  for (const [intent, keywords] of Object.entries(INTENTS)) {
    if (keywords.some(k => lower.includes(k))) return intent;
  }
  return null;
}

function findProduct(text) {
  const lower = text.toLowerCase();
  return PRODUCTS.find(p =>
    lower.includes(p.name.toLowerCase()) ||
    lower.includes(p.id) ||
    lower.includes("quảng cáo") && p.id === "ads-budget" ||
    lower.includes("thiết kế") && p.id === "content-design"
  );
}

// =============================================
//  UI HELPERS
// =============================================
function scrollToBottom() {
  const container = document.getElementById("ms-messages");
  container.scrollTop = container.scrollHeight;
}

function addDateDivider(text) {
  const div = document.createElement("div");
  div.className = "date-divider";
  div.textContent = text;
  document.getElementById("ms-messages").appendChild(div);
  scrollToBottom();
}

function showTyping() {
  removeTyping();
  const container = document.getElementById("ms-messages");
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.id = "typing-row";
  row.innerHTML = `
    <img class="bot-avatar-small" src="${BOT_AVATAR}" alt="bot" />
    <div class="typing-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  container.appendChild(row);
  scrollToBottom();
}

function removeTyping() {
  const el = document.getElementById("typing-row");
  if (el) el.remove();
}

function appendBotBubble(htmlContent, isHtml = false) {
  const container = document.getElementById("ms-messages");
  const row = document.createElement("div");
  row.className = "msg-row bot";

  if (isHtml) {
    row.innerHTML = `
      <img class="bot-avatar-small" src="${BOT_AVATAR}" alt="bot" />
      <div>${htmlContent}</div>`;
  } else {
    row.innerHTML = `
      <img class="bot-avatar-small" src="${BOT_AVATAR}" alt="bot" />
      <div class="bubble bot">${htmlContent}</div>`;
  }

  container.appendChild(row);
  scrollToBottom();
}

function appendUserBubble(text) {
  const container = document.getElementById("ms-messages");
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="bubble user">${escHtml(text)}</div>`;
  container.appendChild(row);
  scrollToBottom();
}

function appendQuickReplies(options) {
  const container = document.getElementById("ms-messages");
  const div = document.createElement("div");
  div.className = "quick-replies";
  div.id = "qr-area";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "qr-btn";
    btn.textContent = opt.label;
    btn.onclick = () => {
      document.getElementById("qr-area")?.remove();
      appendUserBubble(opt.label);
      setTimeout(() => processMessage(opt.value || opt.label), 600);
    };
    div.appendChild(btn);
  });
  container.appendChild(div);
  scrollToBottom();
}

function appendProductCards(products) {
  const container = document.getElementById("ms-messages");
  const row = document.createElement("div");
  row.className = "msg-row bot";

  const cards = products.map(p => `
    <div class="product-card">
      <div class="product-card-img">${p.emoji}</div>
      <div class="product-card-body">
        <div class="product-card-name">${p.name}</div>
        <div class="product-card-price">${p.priceStr}</div>
        <div class="product-card-sub">${p.waterproof} • BH ${p.warranty}</div>
        <div class="product-card-sub">${p.stars}</div>
      </div>
      <button class="product-card-btn" onclick="selectProduct('${p.id}')">Xem chi tiết →</button>
    </div>
  `).join("");

  row.innerHTML = `
    <img class="bot-avatar-small" src="${BOT_AVATAR}" alt="bot" style="align-self:flex-start;margin-top:4px"/>
    <div class="product-cards">${cards}</div>`;
  container.appendChild(row);
  scrollToBottom();
}

function appendOrderConfirm(order) {
  const container = document.getElementById("ms-messages");
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.innerHTML = `
    <img class="bot-avatar-small" src="${BOT_AVATAR}" alt="bot" />
    <div class="order-confirm">
      <div class="confirm-title">✅ Đơn hàng đã được ghi nhận!</div>
      <div>👤 <b>${escHtml(order.name)}</b></div>
      <div>📞 ${escHtml(order.phone)}</div>
      <div>📍 ${escHtml(order.address)}</div>
      <div>📦 ${escHtml(order.product)}</div>
      <div class="confirm-row"><span>Tổng thanh toán:</span><span>${escHtml(order.price)}</span></div>
      <div style="font-size:12px;margin-top:8px;opacity:0.85">🚚 Miễn ship nội thành · Shop sẽ gọi xác nhận trong 30 phút!</div>
    </div>`;
  container.appendChild(row);
  scrollToBottom();
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function escAttr(str) {
  return escHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// =============================================
//  BOT DELAY & RESPOND
// =============================================
async function botRespond(fn, delay = 1200) {
  if (isTyping) return;
  isTyping = true;
  showTyping();
  await new Promise(r => setTimeout(r, delay));
  removeTyping();
  fn();
  isTyping = false;
}

// =============================================
//  GROQ AI CALL
// =============================================
function parseGroqApiKeys(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map(k => k.trim())
      .filter(Boolean)
  )];
}

function formatGroqApiKeys(value) {
  return parseGroqApiKeys(value).join("\n");
}

function renderGroqKeyList(value) {
  const list = document.getElementById('groq-key-list');
  if (!list) return;
  const keys = parseGroqApiKeys(value);
  if (!keys.length) {
    list.innerHTML = '<span class="key-list-empty">Chưa có API key</span>';
    return;
  }
  list.innerHTML = `<span class="key-list-empty">Đang lưu ${keys.length} key</span>` +
    keys.map((key, index) => `<span class="key-chip">Key ${index + 1}: ${escHtml(key)}</span>`).join("");
}

function getConfiguredGroqKeys() {
  const keyInput = document.getElementById('grok-key');
  return parseGroqApiKeys(keyInput?.value || groqApiKey);
}

function isGroqKeyCoolingDown(key) {
  const until = groqKeyCooldowns[key];
  if (!until) return false;
  if (Date.now() >= until) {
    delete groqKeyCooldowns[key];
    return false;
  }
  return true;
}

function setGroqKeyCooldown(key) {
  groqKeyCooldowns[key] = Date.now() + GROQ_KEY_COOLDOWN_MS;
}

async function callGroqAI(userMessage) {
  let keysToUse = getConfiguredGroqKeys();
  let modelToUse = "meta-llama/llama-3.1-8b-instruct";
  let tempToUse = 0.7;
  let systemPrompt = localStorage.getItem('chatbot_script') || '';

  const modelSelect = document.getElementById('model-select');
  if (modelSelect) modelToUse = modelSelect.value;
  
  const tempSlider = document.getElementById('temperature');
  if (tempSlider) tempToUse = parseFloat(tempSlider.value);

  if (!keysToUse.length) return null;
  
  if (!systemPrompt) {
    const productList = PRODUCTS.map(p =>
      `- ${p.name}: ${p.priceStr}, ${p.waterproof}, bảo hành ${p.warranty}`
    ).join("\n");
    systemPrompt = `Bạn là chatbot bán hàng của "${SHOP_NAME}", chuyên bán máy cao râu. 
Trả lời ngắn gọn, thân thiện, dùng tiếng Việt. Dùng emoji phù hợp.
Sản phẩm hiện có:\n${productList}
Chính sách: Miễn ship nội thành, bảo hành theo sản phẩm, đổi trả 7 ngày.
Nếu khách muốn đặt hàng, hãy hướng dẫn họ gõ "đặt hàng".`;
  }

  const activeKeys = keysToUse.filter(k => !isGroqKeyCoolingDown(k));
  const cooldownKeys = keysToUse.filter(k => isGroqKeyCoolingDown(k));
  const orderedKeys = activeKeys.length ? [...activeKeys, ...cooldownKeys] : keysToUse;
  let lastError = null;

  for (const keyToUse of orderedKeys) {
    if (isGroqKeyCoolingDown(keyToUse) && activeKeys.length) continue;

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${keyToUse}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": "NGUYENNAMADS Chatbot"
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          { role: "user", content: userMessage }
        ],
        temperature: tempToUse,
        max_tokens: 400
      })
    });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "");
        lastError = new Error(`OpenRouter API ${resp.status}: ${errorText}`);
        if (resp.status === 429) setGroqKeyCooldown(keyToUse);
        continue;
      }

      const data = await resp.json();
      const reply = data.choices?.[0]?.message?.content || null;
      if (reply) {
        delete groqKeyCooldowns[keyToUse];
        return reply;
      }
    } catch(e) {
      lastError = e;
    }
  }

  if (lastError) console.warn(lastError.message);
  return null;
}

// =============================================
// =============================================
//  MAIN PROCESS MESSAGE
// =============================================
function isOrderConfirmed(text) {
  const keywords = ["đã nhận đơn", "xác nhận đơn", "ghi nhận đơn", "đơn hàng của"];
  return keywords.some(k => text.toLowerCase().includes(k));
}

async function processMessage(text) {
  if (!activePageId) {
    appendBotBubble("⚠️ Vui lòng kết nối và chọn Fanpage ở cột bên trái để bắt đầu chat thử nghiệm.");
    return;
  }

  showTyping();
  try {
    const resp = await fetch(`${SERVER_URL}/api/test-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pageId: activePageId,
        text: text,
        senderId: "dashboard-test"
      })
    });
    
    const data = await resp.json();
    removeTyping();

    if (data.muted) {
      return;
    }
    
    if (data.success && data.reply) {
      appendBotBubble(escHtml(data.reply).replace(/\n/g, "<br>"));
      
      // Nếu là câu chốt đơn hàng, tự động tải lại danh sách đơn hàng
      if (isOrderConfirmed(data.reply)) {
        setTimeout(loadOrdersForActivePage, 1000);
      }
    } else {
      appendBotBubble(`⚠️ Lỗi: ${data.error || "Không thể lấy phản hồi từ server."}`);
    }
  } catch (err) {
    removeTyping();
    console.error("Lỗi kết nối server để test chat:", err);
    appendBotBubble("⚠️ Không thể kết nối tới server. Vui lòng kiểm tra xem server backend đã chạy chưa.");
  }
}

// =============================================
//  SELECT PRODUCT
// =============================================
function selectProduct(productId, autoScroll = true) {
  const p = PRODUCTS.find(x => x.id === productId);
  if (!p) return;
  selectedProduct = p;
  document.getElementById("qr-area")?.remove();

  appendUserBubble(`Cho mình xem ${p.name}`);
  state = STATE.SHOW_DETAIL;

  botRespond(() => {
    appendBotBubble(`
      <div style="font-size:32px;text-align:center;margin-bottom:4px">${p.emoji}</div>
      <b style="font-size:16px">${p.name}</b><br>
      <span style="color:#e94560;font-size:18px;font-weight:700">${p.priceStr}</span><br><br>
      📝 ${p.desc}<br><br>
      💰 Chi phí: <b>${p.battery}</b><br>
      💳 Thanh toán: <b>${p.waterproof}</b><br>
      🤝 Cam kết: <b>${p.warranty}</b><br>
      ${p.stars} · ${p.sold}
    `);
    setTimeout(() => {
      appendQuickReplies([
        { label: "🤝 Đăng ký tư vấn", value: "tư vấn" },
        { label: "💰 Hỏi thêm chi phí", value: "chi phí" },
        { label: "← Xem dịch vụ khác", value: "dịch vụ" }
      ]);
    }, 200);
  }, 800);
}

// =============================================
//  ORDERS
// =============================================
function saveOrder(order) {
  const emptyState = document.getElementById("orders-empty");
  if (emptyState) emptyState.style.display = "none";
  
  const list = document.getElementById("orders-list");
  if (list) {
    const card = document.createElement("div");
    card.className = "order-card";
    card.innerHTML = `
      <b>🆕 Đơn #${orders.length}</b><br>
      👤 ${escHtml(order.name)} – 📞 ${escHtml(order.phone)}<br>
      📦 ${escHtml(order.product)} – ${escHtml(order.price)}<br>
      📍 ${escHtml(order.address)}<br>
      🕐 ${order.time}
    `;
    list.prepend(card);
  }
  
  const badge = document.getElementById("order-badge");
  if (badge) {
    badge.textContent = orders.length;
    badge.style.display = "inline-block";
  }
}

// =============================================
//  INPUT HANDLERS
// =============================================
function sendMessage() {
  const input = document.getElementById("ms-input");
  const text = input.value.trim();
  if (!text || isTyping) return;
  input.value = "";
  document.getElementById("qr-area")?.remove();
  appendUserBubble(text);
  setTimeout(() => processMessage(text), 300);
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleInput() {
  // keep send btn always active
}

function sendSuggest(el) {
  const text = el.textContent;
  if (isTyping) return;
  document.getElementById("qr-area")?.remove();
  appendUserBubble(text);
  setTimeout(() => processMessage(text), 300);
}

// =============================================
//  API KEY & SETTINGS
// =============================================
function saveKey() {
  const keyInput = document.getElementById("grok-key");
  const keys = parseGroqApiKeys(keyInput.value);
  const key = keys.join("\n");
  const status = document.getElementById("key-status");
  if (!keys.length) {
    status.textContent = "⚠️ Vui lòng nhập API key";
    status.style.color = "#ff8080";
    return;
  }
  keyInput.value = key;
  groqApiKey = key;
  localStorage.setItem('groq_api_key', key);
  renderGroqKeyList(key);
  status.textContent = "⏳ Đang lưu lên server...";
  status.style.color = "#ffd700";

  // Sync key to backend server so Messenger webhook can use it
  if (activePageId) {
    fetch(`${SERVER_URL}/api/update-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: activePageId, apiKey: key, aiProvider: 'openrouter' })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        status.textContent = `✅ Đã lưu ${keys.length} API key và đồng bộ lên server.`;
        status.style.color = "#6ee396";
      } else {
        status.textContent = "⚠️ Lưu local OK, nhưng server lỗi: " + data.error;
        status.style.color = "#ff8080";
      }
    })
    .catch(err => {
      status.textContent = "✅ Đã lưu local! (Server offline - sẽ đồng bộ sau)";
      status.style.color = "#ffd700";
    });
  } else {
    status.textContent = "✅ Đã lưu! Bot sẽ dùng OpenRouter AI cho câu hỏi ngoài kịch bản.";
    status.style.color = "#6ee396";
  }
}

// saveSettings() defined below with full activePageId support

// =============================================
//  LEFT PANEL TAB & SCRIPT ACTIONS
// =============================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.getElementById(`tab-${tabName}`).classList.add('active');
  document.getElementById(`content-${tabName}`).classList.add('active');
  
  if (tabName === 'users') {
    loadPlatformUsers();
  } else if (tabName === 'orders') {
    loadOrdersForActivePage();
  }
}

let scriptSections = [];

const DEFAULT_SCRIPT_SECTIONS = [
  {
    title: "Chạy quảng cáo thuê Fanpage",
    keywords: "chạy quảng cáo, chạy ads, thuê chạy quảng cáo, fanpage, báo giá quảng cáo",
    imageUrl: "https://nguyennamchat-production.up.railway.app/uploads/1780819181252-gma6l45o.png",
    content: "Khi khách hỏi chạy quảng cáo, hỏi trước khách muốn chạy trên Fanpage hay Facebook cá nhân. Nếu khách chọn Fanpage thì hỏi ngành nghề/sản phẩm, sau đó hỏi trước giờ đã từng chạy quảng cáo chưa. Khi đủ thông tin thì gửi bảng giá chạy quảng cáo thuê Fanpage và mời qua Zalo 0898377771."
  },
  {
    title: "Tăng nhận diện thương hiệu cá nhân",
    keywords: "facebook cá nhân, trang cá nhân, thương hiệu cá nhân, tăng nhận diện, cá nhân",
    imageUrl: "https://nguyennamchat-production.up.railway.app/uploads/1780818941774-q70jinri.png",
    content: "Nếu khách chọn Facebook cá nhân/trang cá nhân/cá nhân thì hỏi ngành nghề hoặc sản phẩm gì. Khi đã biết ngành nghề/sản phẩm thì gửi bảng giá tăng nhận diện thương hiệu cá nhân ngay, không hỏi thêm mục tiêu bán hàng/tuyển học viên/xây uy tín. Sau khi gửi bảng giá phải mời qua Zalo 0898377771."
  },
  {
    title: "Dạy chạy quảng cáo Fanpage",
    keywords: "học chạy quảng cáo, dạy chạy quảng cáo, tự chạy ads, khóa học ads, dạy fanpage",
    imageUrl: "https://nguyennamchat-production.up.railway.app/uploads/1780819140727-s90jiamw.png",
    content: "Khi khách hỏi học hoặc dạy chạy quảng cáo Fanpage, hỏi khách muốn học để tự chạy cho shop hay học để làm nghề. Sau đó hỏi trước giờ đã từng chạy quảng cáo hoặc biết cơ bản Facebook Ads chưa. Khi khách hỏi giá hoặc đã trả lời đủ thì gửi bảng giá dạy chạy quảng cáo Fanpage và mời qua Zalo 0898377771."
  },
  {
    title: "Đào tạo thiết kế đồ họa",
    keywords: "học thiết kế, thiết kế đồ họa, làm banner, làm ảnh quảng cáo, photoshop, canva",
    imageUrl: "https://nguyennamchat-production.up.railway.app/uploads/1780819107225-y5u6r0r7.png",
    content: "Khi khách hỏi học thiết kế hoặc thiết kế đồ họa, hỏi khách muốn học để tự làm hình ảnh cho shop hay học để phát triển nghề. Sau đó hỏi trước giờ đã từng học hoặc làm thiết kế cơ bản chưa. Khi khách hỏi giá hoặc đã trả lời đủ thì gửi bảng giá dạy thiết kế đồ họa và mời qua Zalo 0898377771."
  }
];

function createScriptSection(data = {}) {
  return {
    id: data.id || `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: data.title || "",
    keywords: data.keywords || "",
    content: data.content || "",
    imageUrl: data.imageUrl || ""
  };
}

function renderScriptSections() {
  const list = document.getElementById("script-section-list");
  if (!list) return;

  if (!scriptSections.length) {
    list.innerHTML = '<div class="empty-state" style="padding:18px">Chưa có kịch bản con nào. Bấm "Thêm kịch bản" để tạo mục mới.</div>';
    return;
  }

  list.innerHTML = scriptSections.map((section, index) => {
    const id = escAttr(section.id);
    return `
      <div class="script-section-card" data-section-id="${id}">
        <div class="script-section-title-row">
          <label class="settings-label">Kịch bản ${index + 1}</label>
          <button class="btn-outline" type="button" onclick="removeScriptSection('${id}')">Xóa mục</button>
        </div>
        <input class="settings-input" value="${escAttr(section.title)}" placeholder="Tên kịch bản" oninput="updateScriptSection('${id}', 'title', this.value)" />
        <input class="settings-input" value="${escAttr(section.keywords)}" placeholder="Từ khóa nhận diện" oninput="updateScriptSection('${id}', 'keywords', this.value)" />
        <textarea class="script-textarea" placeholder="Nội dung tư vấn riêng cho mục này..." oninput="updateScriptSection('${id}', 'content', this.value)">${escHtml(section.content)}</textarea>
        <div class="script-image-row">
          <input class="settings-input" value="${escAttr(section.imageUrl)}" placeholder="Link ảnh/bảng giá" oninput="updateScriptSection('${id}', 'imageUrl', this.value)" />
          <button class="btn-outline" type="button" onclick="document.getElementById('script-image-file-${id}').click()">Tải ảnh</button>
        </div>
        <input type="file" id="script-image-file-${id}" accept="image/*" style="display:none" onchange="uploadScriptImage(this, '${id}')" />
        <div id="image-upload-status-${id}" class="image-upload-status">${section.imageUrl ? `Ảnh hiện tại: ${escHtml(section.imageUrl)}` : ""}</div>
      </div>`;
  }).join("");
}

function updateScriptSection(id, field, value) {
  const section = scriptSections.find(item => item.id === id);
  if (!section) return;
  section[field] = value;
  buildScriptFromSections();
}

function addScriptSection(data = {}) {
  scriptSections.push(createScriptSection(data));
  renderScriptSections();
  buildScriptFromSections();
}

function removeScriptSection(id) {
  scriptSections = scriptSections.filter(item => item.id !== id);
  renderScriptSections();
  buildScriptFromSections();
}

function clearScriptSections() {
  scriptSections = [];
  renderScriptSections();
  const hidden = document.getElementById("script-input");
  if (hidden) hidden.value = "";
}

function buildScriptFromSections() {
  const parts = [
    "# NGUYENNAMADS - KỊCH BẢN TƯ VẤN THEO NHIỀU MỤC",
    "",
    "Bạn là nhân viên tư vấn của NGUYENNAMADS. Xưng em, gọi khách là anh/chị. Trả lời ngắn, tự nhiên, không nói mình là bot/AI.",
    "Hotline/Zalo: 0898377771",
    "",
    "QUY TẮC BẮT BUỘC:",
    "- Chỉ gửi câu trả lời dành cho khách, không gửi ghi chú nội bộ.",
    "- Dựa vào từ khóa và nội dung từng mục để chọn đúng kịch bản con.",
    "- Khi gửi bảng giá hoặc thông tin gói, phải kèm đúng ảnh của mục đó nếu mục đó có ảnh.",
    "- Sau khi gửi bảng giá hoặc khách muốn chốt, phải mời khách qua Zalo 0898377771.",
    "- Không tự bịa giá, cam kết, chính sách.",
    ""
  ];

  scriptSections.forEach((section, index) => {
    if (!section.title && !section.keywords && !section.content && !section.imageUrl) return;
    parts.push(`## MỤC ${index + 1}: ${section.title || "Chưa đặt tên"}`);
    if (section.keywords) parts.push(`Từ khóa nhận diện: ${section.keywords}`);
    if (section.content) parts.push(section.content);
    if (section.imageUrl) {
      parts.push("Ảnh/bảng giá của mục này:");
      parts.push(`[IMAGE: ${section.imageUrl}]`);
    }
    parts.push("");
  });

  const script = parts.join("\n").trim();
  const hidden = document.getElementById("script-input");
  if (hidden) hidden.value = script;
  return script;
}

function hasUsableScriptSection() {
  return scriptSections.some(section =>
    section.title.trim() ||
    section.keywords.trim() ||
    section.content.trim() ||
    section.imageUrl.trim()
  );
}

function loadScriptSectionsFromScript(script) {
  const raw = String(script || "").trim();
  const hidden = document.getElementById("script-input");
  if (hidden) hidden.value = raw;

  scriptSections = [];
  if (!raw) {
    renderScriptSections();
    return;
  }

  const sectionRe = /## MỤC \d+:\s*(.+?)\n([\s\S]*?)(?=\n## MỤC \d+:|$)/g;
  let match;
  while ((match = sectionRe.exec(raw))) {
    const title = match[1].trim();
    const chunk = match[2].trim();
    const keywordMatch = chunk.match(/^Từ khóa nhận diện:\s*(.+)$/m);
    const imageMatch = chunk.match(/\[IMAGE:\s*(https?:\/\/[^\]\s]+)\s*\]/i);
    const content = chunk
      .replace(/^Từ khóa nhận diện:\s*.+$/m, "")
      .replace(/Ảnh\/bảng giá của mục này:\s*/i, "")
      .replace(/\[IMAGE:\s*https?:\/\/[^\]\s]+\s*\]/i, "")
      .trim();

    scriptSections.push(createScriptSection({
      title,
      keywords: keywordMatch ? keywordMatch[1].trim() : "",
      content,
      imageUrl: imageMatch ? imageMatch[1].trim() : ""
    }));
  }

  if (!scriptSections.length) {
    scriptSections.push(createScriptSection({
      title: "Kịch bản cũ",
      keywords: "",
      content: raw,
      imageUrl: ""
    }));
  }

  renderScriptSections();
}

async function uploadScriptImage(input, sectionId) {
  const file = input.files && input.files[0];
  const status = document.getElementById(`image-upload-status-${sectionId}`);
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    if (status) status.innerHTML = '<span style="color:#ff8080">Vui lòng chọn file ảnh.</span>';
    input.value = "";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    if (status) status.innerHTML = '<span style="color:#ff8080">Ảnh tối đa 5MB.</span>';
    input.value = "";
    return;
  }

  const form = new FormData();
  form.append("image", file);
  if (status) status.innerHTML = '<span style="color:#ffd700">Đang tải ảnh lên...</span>';

  try {
    const resp = await fetch(`${SERVER_URL}/api/upload-image`, {
      method: "POST",
      body: form
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || "Không thể tải ảnh lên.");
    }

    updateScriptSection(sectionId, "imageUrl", data.url);
    renderScriptSections();
    buildScriptFromSections();

    const nextStatus = document.getElementById(`image-upload-status-${sectionId}`);
    if (nextStatus) {
      nextStatus.innerHTML = `
        <div class="upload-preview">
          <img src="${escAttr(data.url)}" alt="Ảnh đã tải" />
          <span>Đã tải ảnh lên cho mục này.</span>
        </div>`;
    }
  } catch (err) {
    if (status) status.innerHTML = `<span style="color:#ff8080">Lỗi tải ảnh: ${escHtml(err.message)}</span>`;
  } finally {
    input.value = "";
  }
}

function loadSample() {
  const script = (() => {
    scriptSections = DEFAULT_SCRIPT_SECTIONS.map(createScriptSection);
    renderScriptSections();
    return buildScriptFromSections();
  })();
  localStorage.setItem('chatbot_script', script);
  if (activePageId) {
    applyScript();
  }
}

function clearScript() {
  clearScriptSections();
  localStorage.removeItem('chatbot_script');
}

// Sync script to backend for all connected pages
async function syncScriptToServer(script) {
  for (const page of connectedPages) {
    try {
      await fetch(`${SERVER_URL}/api/update-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id, script: script })
      });
      console.log(`✅ Synced script to server for page: ${page.name}`);
    } catch (err) {
      console.warn(`⚠️ Could not sync script for page ${page.name}:`, err.message);
    }
  }
}

// =============================================
//  CLEAR CHAT
// =============================================
function clearChat() {
  const container = document.getElementById("ms-messages");
  if (container) container.innerHTML = "";
  state = STATE.IDLE;
  selectedProduct = null;
  orderData = {};
  
  addDateDivider("Hôm nay");
  showTyping();
  setTimeout(() => {
    removeTyping();
    appendBotBubble(`Xin chào! 👋 Mình là trợ lý tự động của <b>${SHOP_NAME}</b>.<br>Rất vui được hỗ trợ bạn! 😊`);
    showTyping();
    setTimeout(() => {
      removeTyping();
      appendBotBubble("Bạn đang quan tâm đến dịch vụ nào ạ?");
      appendQuickReplies([
        { label: "📈 Dịch vụ Ads Facebook", value: "chạy quảng cáo" },
        { label: "💰 Báo giá chi phí", value: "chi phí" },
        { label: "🤝 Cam kết hiệu quả", value: "cam kết hiệu quả" },
        { label: "📞 Hotline liên hệ", value: "hotline liên hệ" }
      ]);
    }, 800);
  }, 1000);
}

// =============================================
//  REAL FACEBOOK SDK OAUTH LOGIN
// =============================================

let activePageId = localStorage.getItem('active_page_id') || '';
let fbRealPages = []; // pages from /me/accounts API

// Permissions needed to manage Messenger chatbot for pages
const FB_PERMISSIONS = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_read_user_content',
  'public_profile'
].join(',');

function startFbLogin() {
  // Check if FB SDK loaded and App ID configured
  if (typeof FB === 'undefined') {
    showFbSdkError();
    return;
  }

  const appId = localStorage.getItem('fb_app_id');
  if (!appId) {
    alert('⚠️ Hệ thống chưa được cấu hình. Vui lòng liên hệ admin!');
    return;
  }

  // Re-init SDK with App ID from server
  FB.init({
    appId: appId,
    cookie: true,
    xfbml: false,
    version: 'v19.0'
  });

  // Loading state on buttons
  const btns = document.querySelectorAll('.btn-fb-login, .btn-hero-primary');
  btns.forEach(b => {
    b.disabled = true;
    b.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:8px"></span>Đang kết nối...';
  });

  // ✨ Trigger real FB OAuth popup
  FB.login(function(response) {
    // Reset buttons
    btns.forEach(b => {
      b.disabled = false;
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>Đăng nhập bằng Facebook';
    });

    if (response.status === 'connected') {
      fbUserAccessToken = response.authResponse.accessToken;
      fbUserId = response.authResponse.userID;
      localStorage.setItem('fb_user_access_token', fbUserAccessToken);
      localStorage.setItem('fb_user_id', fbUserId);
      localStorage.removeItem('is_logged_in'); // Force page selection on next dashboard load

      // Fetch user name then redirect to dashboard immediately
      FB.api('/me', { fields: 'name' }, function(meData) {
        fbUserName = meData.name || 'Người dùng';
        localStorage.setItem('fb_user_name', fbUserName);
        if (window.location.protocol === 'file:') {
          window.location.href = 'dashboard.html';
        } else {
          window.location.href = '/dashboard';
        }
      });
    } else {
      console.log('FB Login cancelled:', response);
    }
  }, {
    scope: FB_PERMISSIONS,
    return_scopes: true
  });
}

// Fetch all Fanpages qua SERVER để đổi lấy Page Token VĨNH VIỄN
// Không còn dùng FB SDK trực tiếp → tránh hoàn toàn lỗi "Session has expired"
async function fetchUserPages(userToken) {
  const modal = document.getElementById('page-select-modal');
  const userDisplay = document.getElementById('fb-user-name-display');
  const pageList = document.getElementById('fb-real-page-list');

  fbUserName = fbUserName || localStorage.getItem('fb_user_name');
  if (userDisplay) userDisplay.textContent = (fbUserName || 'Người dùng') + ' ▾';
  if (modal) modal.classList.remove('hidden');

  if (pageList) {
    pageList.innerHTML = `
      <div style="text-align:center;padding:30px;color:#65676b;">
        <div style="display:inline-block;width:28px;height:28px;border:3px solid #e4e6eb;border-top-color:#1877f2;border-radius:50%;animation:fbSpinner 0.7s linear infinite;margin-bottom:12px;"></div>
        <div style="font-size:13px;">Đang lấy token vĩnh viễn từ server...</div>
      </div>`;
  }

  try {
    // Gọi server đổi token: short-lived → Long-lived (60 ngày) → Page Token VĨNH VIỄN
    const resp = await fetch(`${SERVER_URL}/api/exchange-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccessToken: userToken })
    });
    const data = await resp.json();

    if (!data.success) {
      throw new Error(data.error || 'Không thể đổi token');
    }

    // Lưu lại long-lived user token (60 ngày) vào localStorage
    if (data.longLivedToken) {
      localStorage.setItem('fb_user_access_token', data.longLivedToken);
      fbUserAccessToken = data.longLivedToken;
    }

    fbRealPages = data.pages || [];

    if (fbRealPages.length === 0) {
      if (pageList) {
        pageList.innerHTML = `
          <div style="text-align:center;padding:30px;color:#65676b;">
            <div style="font-size:32px;margin-bottom:8px;">😕</div>
            <div>Không tìm thấy Fanpage nào.</div>
            <small>Bạn cần là Admin của ít nhất 1 Fanpage.</small>
          </div>`;
      }
      return;
    }

    renderPageSelectList(fbRealPages);

  } catch (err) {
    console.error('Lỗi fetchUserPages:', err.message);
    const isExpired = /expired|session|invalid|hết hạn/i.test(err.message);
    if (pageList) {
      pageList.innerHTML = `
        <div style="text-align:center;padding:24px;">
          <div style="font-size:36px;margin-bottom:10px;">${isExpired ? '⏰' : '❌'}</div>
          <div style="font-size:14px;font-weight:700;color:#e94560;margin-bottom:6px;">
            ${isExpired ? 'Phiên đăng nhập đã hết hạn' : 'Lỗi kết nối'}
          </div>
          <div style="font-size:12px;color:#65676b;margin-bottom:16px;line-height:1.5;">
            ${isExpired
              ? 'Token Facebook của bạn đã hết hạn.<br>Vui lòng đăng nhập lại để lấy token mới (60 ngày).'
              : escHtml(err.message)
            }
          </div>
          <button onclick="startFbLogin()" style="background:#1877f2;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;">
            🔑 Đăng nhập lại Facebook
          </button>
        </div>`;
    }
  }
}

function renderPageSelectList(pages) {
  const pageList = document.getElementById('fb-real-page-list');
  if (!pageList) return;

  const colors = ['#ef4444', '#1877f2', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

  pageList.innerHTML = pages.map((page, i) => {
    const initials = page.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const color = colors[i % colors.length];
    const avatarHtml = page.picture?.data?.url
      ? `<img src="${page.picture.data.url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`
      : `<div class="page-item-avatar" style="background:${color}">${initials}</div>`;

    return `
      <label class="fb-page-item">
        <div class="page-item-left">
          ${avatarHtml}
          <div class="page-item-info">
            <span class="page-item-name">${escHtml(page.name)}</span>
            <span class="page-item-id">${page.category || 'Trang'} · ID: ${page.id}</span>
          </div>
        </div>
        <input type="checkbox" name="fb_real_pages" value="${page.id}" data-name="${escHtml(page.name)}" data-token="${page.access_token}" checked />
      </label>
    `;
  }).join('');
}

function showFbSdkError() {
  alert('⚠️ Hệ thống chưa sẵn sàng. Vui lòng đợi vài giây rồi thử lại!');
}

function showPageSelectModal() {
  // This is called only after OAuth — fbRealPages should already be populated
  // If not (edge case), show the modal with whatever is available
  const modal = document.getElementById('page-select-modal');
  const userDisplay = document.getElementById('fb-user-name-display');
  if (userDisplay) userDisplay.textContent = (fbUserName || 'Người dùng') + ' ▾';
  if (modal) modal.classList.remove('hidden');
  if (fbRealPages.length > 0) renderPageSelectList(fbRealPages);
}


async function connectSelectedPages() {
  const checkboxes = document.querySelectorAll('input[name="fb_real_pages"]:checked');
  if (checkboxes.length === 0) {
    document.getElementById('connect-status').innerHTML = '<span style="color:#ff8080">⚠️ Vui lòng chọn ít nhất 1 Fanpage</span>';
    return;
  }

  const statusEl = document.getElementById('connect-status');
  statusEl.innerHTML = '<span style="color:#1877f2">⏳ Đang kết nối...</span>';
  
  const btn = document.getElementById('btn-connect-pages');
  btn.disabled = true;
  btn.textContent = 'Đang xử lý...';

  connectedPages = [];
  let successCount = 0;
  const script = localStorage.getItem('chatbot_script') || CLEAN_DEFAULT_CUSTOMER_SCRIPT;
  localStorage.setItem('chatbot_script', script);

  for (const cb of checkboxes) {
    const pageId = cb.value;
    const pageName = cb.dataset.name;
    const pageToken = cb.dataset.token;

    try {
      const resp = await fetch(`${SERVER_URL}/api/connect-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: pageId,
          pageName: pageName,
          pageToken: pageToken,
          script: script
        })
      });

      const result = await resp.json();
      if (result.success) {
        connectedPages.push({ id: pageId, name: pageName, token: pageToken });
        successCount++;
      }
    } catch (err) {
      console.warn(`Không thể kết nối ${pageName} lên server: ${err.message}. Đang lưu cục bộ.`);
      // Fallback offline so they can still test
      connectedPages.push({ id: pageId, name: pageName, token: pageToken });
      successCount++;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Kết nối Fanpage';

  if (successCount > 0) {
    localStorage.setItem('connected_pages', JSON.stringify(connectedPages));
    localStorage.setItem('is_logged_in', 'true');
    
    // Choose active page
    activePageId = connectedPages[0].id;
    localStorage.setItem('active_page_id', activePageId);
    
    SHOP_NAME = connectedPages[0].name;
    localStorage.setItem('shop_name', SHOP_NAME);

    // ✨ Register platform user on the server so they appear in "Người dùng" tab
    const currentFbUserId = fbUserId || localStorage.getItem('fb_user_id');
    const currentFbUserName = fbUserName || localStorage.getItem('fb_user_name');
    if (currentFbUserId && currentFbUserName) {
      try {
        await fetch(`${SERVER_URL}/api/platform-users/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fbUserId: currentFbUserId,
            name: currentFbUserName,
            pages: connectedPages
          })
        });
        console.log("✅ Registered platform user successfully!");
      } catch (err) {
        console.error("⚠️ Failed to register platform user:", err.message);
      }
    }

    statusEl.innerHTML = `<span style="color:#28a745">✅ Đã kết nối thành công ${successCount} Fanpage!</span>`;
    
    setTimeout(() => {
      document.getElementById('page-select-modal').classList.add('hidden');
      enterDashboard();
    }, 1200);
  }
}

function cancelPageSelect() {
  document.getElementById('page-select-modal').classList.add('hidden');
  const landing = document.getElementById("landing-page");
  if (landing) landing.classList.remove("hidden");
}

// Populate page select dropdown in dashboard
function updatePageSelectDropdown() {
  const select = document.getElementById('active-page-select');
  if (!select) return;
  
  if (connectedPages.length === 0) {
    select.innerHTML = '<option value="">(Không có trang nào)</option>';
    return;
  }
  
  select.innerHTML = connectedPages.map(p => `
    <option value="${p.id}" ${p.id === activePageId ? 'selected' : ''}>📄 ${escHtml(p.name)}</option>
  `).join('');
}

// Switch active configuration tenant page
async function changeActivePage(pageId) {
  if (!pageId) return;
  activePageId = pageId;
  localStorage.setItem('active_page_id', pageId);
  
  // Set shop name and avatar
  const page = connectedPages.find(p => p.id === pageId);
  if (page) {
    SHOP_NAME = page.name;
    localStorage.setItem('shop_name', SHOP_NAME);
    
    document.getElementById('ms-shop-name').textContent = SHOP_NAME;
    document.getElementById('shop-name-input').value = SHOP_NAME;
    document.getElementById('shop-avatar-initial').textContent = SHOP_NAME.charAt(0).toUpperCase();
    BOT_AVATAR = `https://ui-avatars.com/api/?name=${encodeURIComponent(SHOP_NAME)}&background=1877f2&color=fff&size=28`;
  }

  // Load configuration from backend if available
  try {
    const resp = await fetch(`${SERVER_URL}/api/connected-pages`);
    const pages = await resp.json();
    const serverPage = pages.find(p => p.id === pageId);
    
    if (serverPage) {
      if (serverPage.script) {
        document.getElementById('script-input').value = serverPage.script;
        loadScriptSectionsFromScript(serverPage.script);
        localStorage.setItem('chatbot_script', serverPage.script);
        document.getElementById('script-status-bar').style.display = 'none';
      } else {
        document.getElementById('script-input').value = '';
        clearScriptSections();
        document.getElementById('script-status-bar').style.display = 'block';
      }
      
      document.getElementById('model-select').value = serverPage.model || 'meta-llama/llama-3.1-8b-instruct';
      const aiModeSelect = document.getElementById('ai-mode-select');
      if (aiModeSelect) {
        aiModeSelect.value = ['auto', 'observe', 'flow'].includes(serverPage.aiMode) ? serverPage.aiMode : 'flow';
      }
      document.getElementById('temperature').value = serverPage.temperature !== undefined ? serverPage.temperature : 0.7;
      document.getElementById('temp-val').textContent = serverPage.temperature !== undefined ? serverPage.temperature : 0.7;
      const pageApiKeys = formatGroqApiKeys(serverPage.apiKey || '');
      document.getElementById('grok-key').value = pageApiKeys;
      groqApiKey = pageApiKeys;
      localStorage.setItem('groq_api_key', groqApiKey);
      renderGroqKeyList(groqApiKey);
    }
  } catch (e) {
    console.warn("Lỗi tải thông tin trang từ backend:", e.message);
  }

  // Reset chat interface
  const msgs = document.getElementById('ms-messages');
  if (msgs) msgs.innerHTML = '';
  
  addDateDivider("Hôm nay");
  showTyping();
  setTimeout(() => {
    removeTyping();
    const currentScript = document.getElementById('script-input').value;
    if (currentScript) {
      appendBotBubble(`Xin chào! 👋 Mình là trợ lý tự động của <b>${SHOP_NAME}</b>.<br>Em đã được học kịch bản mới của anh/chị và sẵn sàng tư vấn. Anh/Chị hãy chat thử nhé! 😊`);
    } else {
      appendBotBubble(`Xin chào! 👋 Mình là trợ lý tự động của <b>${SHOP_NAME}</b>.<br>Rất vui được hỗ trợ bạn! 😊`);
    }
  }, 1000);
  
  // Refresh order badge
  loadOrdersForActivePage();
}

async function loadOrdersForActivePage() {
  try {
    const resp = await fetch(`${SERVER_URL}/orders?pageId=${activePageId}`);
    const ordersData = await resp.json();
    
    const list = document.getElementById("orders-list");
    const emptyState = document.getElementById("orders-empty");
    const badge = document.getElementById("order-badge");
    
    if (list) list.innerHTML = '';
    
    if (ordersData && ordersData.length > 0) {
      if (emptyState) emptyState.style.display = "none";
      orders = ordersData;
      
      if (list) {
        ordersData.forEach((order, index) => {
          const card = document.createElement("div");
          card.className = "order-card";
          card.innerHTML = `
            <b>🆕 Đơn #${index + 1}</b><br>
            👤 ${escHtml(order.name || order.senderId)} – 📞 ${escHtml(order.phone || '')}<br>
            📦 ${escHtml(order.product || '')} – ${escHtml(order.price || '')}<br>
            📍 ${escHtml(order.address || '')}<br>
            🕐 ${order.time}
          `;
          list.appendChild(card);
        });
      }
      
      if (badge) {
        badge.textContent = ordersData.length;
        badge.style.display = "inline-block";
      }
    } else {
      if (emptyState) emptyState.style.display = "block";
      if (badge) badge.style.display = "none";
    }
  } catch (e) {
    console.warn("Lỗi đồng bộ danh sách đơn hàng:", e.message);
  }
}

// =============================================
//  PLATFORM USER MANAGEMENT
// =============================================
async function loadPlatformUsers() {
  const container = document.getElementById('platform-users-list');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:20px;color:#64748b">⏳ Đang tải...</div>`;

  try {
    const resp = await fetch(`${SERVER_URL}/api/platform-users`, {
      headers: { 'Authorization': 'Basic ' + btoa('admin:Namc6352@@@@@') }
    });
    if (!resp.ok) { container.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">❌ Không thể tải (cần đăng nhập admin)</div>`; return; }
    const users = await resp.json();

    // Update stats
    const total = users.length;
    const active = users.filter(u => u.status === 'active').length;
    const expired = users.filter(u => u.status === 'expired' || u.status === 'blocked').length;
    const el = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    el('pu-stat-total', total); el('pu-stat-active', active); el('pu-stat-expired', expired);

    // Update badge
    const badge = document.getElementById('user-badge');
    if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'inline-block' : 'none'; }

    if (users.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b"><div style="font-size:28px">👥</div><p style="font-size:12px">Chưa có người dùng nào.<br>Khi khách đăng nhập Facebook sẽ hiện ở đây.</p></div>`;
      return;
    }

    container.innerHTML = users.map(u => {
      const statusColor = u.status === 'active' ? '#10b981' : u.status === 'blocked' ? '#ef4444' : '#f59e0b';
      const statusLabel = u.status === 'active' ? '✅ Active' : u.status === 'blocked' ? '🔒 Bị khóa' : '⏰ Hết hạn';
      const planLabel = { trial: '🆓 Trial', basic: '🥈 Basic', pro: '🥇 Pro', enterprise: '💎 Enterprise' }[u.plan] || u.plan;
      const regDate = new Date(u.registeredAt).toLocaleDateString('vi-VN');
      const lastLogin = new Date(u.lastLoginAt).toLocaleDateString('vi-VN');
      const expiry = new Date(u.expiryDate);
      const expiryStr = expiry.toLocaleDateString('vi-VN');
      const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
      const daysColor = daysLeft <= 3 ? '#ef4444' : daysLeft <= 7 ? '#f59e0b' : '#10b981';
      const daysText = daysLeft > 0 ? `còn ${daysLeft} ngày` : `hết ${Math.abs(daysLeft)} ngày trước`;
      const initials = (u.name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const avatarColors = ['#1877f2','#10b981','#8b5cf6','#f59e0b','#ec4899','#06b6d4','#ef4444'];
      const avatarColor = avatarColors[Math.abs(u.id.split('').reduce((a,c) => a + c.charCodeAt(0), 0)) % avatarColors.length];

      return `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:38px;height:38px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">${initials}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(u.name)}</div>
              <div style="font-size:10px;color:#64748b">ID: ${u.id} · ${u.pageCount || 0} fanpage</div>
            </div>
            <span style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;white-space:nowrap">${statusLabel}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#94a3b8">
            <div>📅 Đăng ký: <b style="color:#f1f5f9">${regDate}</b></div>
            <div>🕐 Đăng nhập: <b style="color:#f1f5f9">${lastLogin}</b></div>
            <div>📦 Gói: <b style="color:#f1f5f9">${planLabel}</b></div>
            <div>⏳ Hạn: <b style="color:${daysColor}">${expiryStr} (${daysText})</b></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button onclick="openEditUserModal('${u.id}','${escHtml(u.name)}','${u.expiryDate}','${u.plan}')" style="flex:1;min-width:60px;background:#1877f222;border:1px solid #1877f244;color:#1877f2;border-radius:6px;padding:5px;font-size:11px;cursor:pointer;font-weight:600">✏️ Gia hạn</button>
            <button onclick="toggleBlockUser('${u.id}','${u.status}')" style="flex:1;min-width:60px;background:${u.status==='blocked'?'#10b98122':'#ef444422'};border:1px solid ${u.status==='blocked'?'#10b98144':'#ef444444'};color:${u.status==='blocked'?'#10b981':'#ef4444'};border-radius:6px;padding:5px;font-size:11px;cursor:pointer;font-weight:600">${u.status==='blocked'?'🔓 Mở khóa':'🔒 Khóa'}</button>
            <button onclick="deletePlatformUser('${u.id}','${escHtml(u.name)}')" style="background:#334155;border:1px solid #475569;color:#94a3b8;border-radius:6px;padding:5px 8px;font-size:11px;cursor:pointer">🗑</button>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">❌ Lỗi: ${e.message}</div>`;
  }
}

function openEditUserModal(id, name, expiryDate, plan) {
  document.getElementById('edit-user-id').value = id;
  document.getElementById('edit-user-name').textContent = name;
  document.getElementById('edit-expiry-date').value = expiryDate ? expiryDate.substring(0, 10) : '';
  document.getElementById('edit-plan').value = plan || 'trial';
  document.getElementById('edit-user-status').textContent = '';
  document.getElementById('edit-user-modal').style.display = 'flex';
}

function closeEditUserModal() {
  document.getElementById('edit-user-modal').style.display = 'none';
}

async function saveEditUser() {
  const id = document.getElementById('edit-user-id').value;
  const expiryDate = document.getElementById('edit-expiry-date').value;
  const plan = document.getElementById('edit-plan').value;
  const statusEl = document.getElementById('edit-user-status');
  statusEl.innerHTML = '<span style="color:#1877f2">⏳ Đang lưu...</span>';
  try {
    const resp = await fetch(`${SERVER_URL}/api/platform-users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa('admin:Namc6352@@@@@') },
      body: JSON.stringify({ expiryDate, plan, status: 'active' })
    });
    const data = await resp.json();
    if (data.success) {
      statusEl.innerHTML = '<span style="color:#10b981">✅ Đã lưu thành công!</span>';
      setTimeout(() => { closeEditUserModal(); loadPlatformUsers(); }, 1000);
    } else {
      statusEl.innerHTML = `<span style="color:#ef4444">❌ Lỗi: ${data.error}</span>`;
    }
  } catch(e) { statusEl.innerHTML = `<span style="color:#ef4444">❌ ${e.message}</span>`; }
}

async function toggleBlockUser(id, currentStatus) {
  const newStatus = currentStatus === 'blocked' ? 'active' : 'blocked';
  const label = newStatus === 'blocked' ? 'Khóa' : 'Mở khóa';
  if (!confirm(`Bạn có chắc muốn ${label} tài khoản này?`)) return;
  try {
    const resp = await fetch(`${SERVER_URL}/api/platform-users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa('admin:Namc6352@@@@@') },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await resp.json();
    if (data.success) loadPlatformUsers();
  } catch(e) { alert('Lỗi: ' + e.message); }
}

async function deletePlatformUser(id, name) {
  if (!confirm(`⚠️ Xóa vĩnh viễn tài khoản "${name}"?\nHành động này không thể hoàn tác!`)) return;
  try {
    const resp = await fetch(`${SERVER_URL}/api/platform-users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Basic ' + btoa('admin:Namc6352@@@@@') }
    });
    const data = await resp.json();
    if (data.success) loadPlatformUsers();
  } catch(e) { alert('Lỗi: ' + e.message); }
}



// =============================================
//  DASHBOARD NAVIGATION
// =============================================
async function enterDashboard() {
  const landing = document.getElementById("landing-page");
  const dashboard = document.getElementById("dashboard-page");

  // ✨ Check if user is blocked or expired on the platform on entry
  const currentFbUserId = fbUserId || localStorage.getItem('fb_user_id');
  if (currentFbUserId) {
    try {
      const checkResp = await fetch(`${SERVER_URL}/api/platform-users/check/${currentFbUserId}`);
      const checkData = await checkResp.json();
      if (checkData && checkData.allowed === false) {
        let msg = "Tài khoản của bạn đã bị khóa hoặc hết hạn dùng thử.";
        if (checkData.status === 'blocked') {
          msg = "❌ Tài khoản của bạn đã bị KHÓA bởi Admin.";
        } else if (checkData.status === 'expired') {
          msg = "⏰ Tài khoản của bạn đã HẾT HẠN sử dụng. Vui lòng liên hệ Admin để gia hạn!";
        }
        alert(msg);
        handleLogout();
        return;
      }
    } catch (e) {
      console.warn("Không thể kiểm tra trạng thái tài khoản với server:", e.message);
    }
  }
  
  if (landing) landing.classList.add("hidden");
  if (dashboard) dashboard.classList.remove("hidden");

  // Load ALL connected pages from server and merge with localStorage
  try {
    const resp = await fetch(`${SERVER_URL}/api/connected-pages`);
    const serverPages = await resp.json();
    if (serverPages && serverPages.length > 0) {
      // Merge: keep server pages as source of truth, add any local-only pages
      const serverIds = new Set(serverPages.map(p => p.id));
      const localOnly = connectedPages.filter(p => !serverIds.has(p.id));
      connectedPages = [
        ...serverPages.map(p => ({ id: p.id, name: p.name, token: p.token || '' })),
        ...localOnly
      ];
      localStorage.setItem('connected_pages', JSON.stringify(connectedPages));
      // Keep activePageId valid
      if (!connectedPages.find(p => p.id === activePageId)) {
        activePageId = connectedPages[0].id;
        localStorage.setItem('active_page_id', activePageId);
      }
    }
  } catch (e) {
    console.warn('Không thể tải danh sách fanpage từ server:', e.message);
  }
  
  // Show active configuration dropdown
  const pagesBar = document.getElementById('connected-pages-bar');
  if (pagesBar) pagesBar.style.display = 'block';
  
  // Refresh page selector
  updatePageSelectDropdown();
  
  if (activePageId) {
    await changeActivePage(activePageId);
  } else if (connectedPages.length > 0) {
    await changeActivePage(connectedPages[0].id);
  }
}

function handleLogout() {
  // Clear auth states
  localStorage.removeItem("is_logged_in");
  localStorage.removeItem("connected_pages");
  localStorage.removeItem("fb_user_name");
  localStorage.removeItem("active_page_id");
  localStorage.removeItem("fb_user_access_token");
  localStorage.removeItem("fb_user_id");
  
  fbUserName = null;
  connectedPages = [];
  activePageId = '';
  
  const landing = document.getElementById("landing-page");
  const dashboard = document.getElementById("dashboard-page");
  const fbLoginWrap = document.getElementById("fb-login-wrapper");
  const pagesBar = document.getElementById('connected-pages-bar');
  
  if (pagesBar) pagesBar.style.display = 'none';
  if (fbLoginWrap) fbLoginWrap.classList.add("hidden");
  if (landing) landing.classList.remove("hidden");
  if (dashboard) dashboard.classList.add("hidden");

  // Redirect to landing
  if (window.location.protocol === 'file:') {
    window.location.href = 'index.html';
  } else {
    window.location.href = '/';
  }
}

// ✨ Prompt Facebook OAuth again using 'rerequest' so user can select missing Fanpages
function reauthorizeFacebook() {
  if (typeof FB === 'undefined') {
    showFbSdkError();
    return;
  }
  const appId = localStorage.getItem('fb_app_id');
  if (!appId) {
    alert('⚠️ Hệ thống chưa được cấu hình. Vui lòng liên hệ admin!');
    return;
  }
  
  FB.init({
    appId: appId,
    cookie: true,
    xfbml: false,
    version: 'v19.0'
  });

  const modal = document.getElementById('page-select-modal');
  const pageList = document.getElementById('fb-real-page-list');
  const statusEl = document.getElementById('connect-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:#1877f2">⏳ Đang gọi popup Facebook...</span>';

  FB.login(function(response) {
    if (response.status === 'connected') {
      fbUserAccessToken = response.authResponse.accessToken;
      fbUserId = response.authResponse.userID;
      localStorage.setItem('fb_user_access_token', fbUserAccessToken);
      localStorage.setItem('fb_user_id', fbUserId);
      if (statusEl) statusEl.innerHTML = '<span style="color:#10b981">✅ Kết nối FB thành công! Đang tải danh sách Trang...</span>';
      
      FB.api('/me', { fields: 'name' }, function(meData) {
        fbUserName = meData.name || 'Người dùng';
        localStorage.setItem('fb_user_name', fbUserName);
        fetchUserPages(fbUserAccessToken);
      });
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ff8080">⚠️ Bạn đã hủy đăng nhập Facebook</span>';
    }
  }, {
    scope: FB_PERMISSIONS,
    return_scopes: true,
    auth_type: 'rerequest' // Forces Facebook to prompt page selections again
  });
}

function applyScript() {
  if (!hasUsableScriptSection()) {
    const status = document.getElementById('apply-status');
    const statusBar = document.getElementById('script-status-bar');
    if (status) status.innerHTML = `<span style="color:#ff8080">⚠️ Vui lòng thêm ít nhất 1 kịch bản trước khi áp dụng!</span>`;
    if (statusBar) statusBar.style.display = 'block';
    return;
  }

  const scriptVal = buildScriptFromSections().trim();
  const status = document.getElementById('apply-status');
  const statusBar = document.getElementById('script-status-bar');
  
  if (!scriptVal) {
    status.innerHTML = `<span style="color:#ff8080">⚠️ Vui lòng nhập kịch bản trước khi áp dụng!</span>`;
    return;
  }
  
  localStorage.setItem('chatbot_script', scriptVal);
  
  if (activePageId) {
    fetch(`${SERVER_URL}/api/update-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: activePageId, script: scriptVal })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        status.innerHTML = `<span style="color:#6ee396">✅ Đã cập nhật kịch bản lên máy chủ!</span>`;
        if (statusBar) statusBar.style.display = 'none';
      } else {
        status.innerHTML = `<span style="color:#ff8080">⚠️ Lỗi: ${data.error}</span>`;
      }
    })
    .catch(err => {
      status.innerHTML = `<span style="color:#6ee396">✅ Đã lưu kịch bản cục bộ offline!</span>`;
      if (statusBar) statusBar.style.display = 'none';
    });
  } else {
    status.innerHTML = `<span style="color:#ff8080">⚠️ Không tìm thấy Fanpage để cấu hình.</span>`;
  }
  
  setTimeout(() => {
    status.innerHTML = '';
  }, 3000);
}

function saveSettings() {
  const shopNameVal = document.getElementById('shop-name-input').value.trim();
  const serverUrlVal = document.getElementById('server-url-input').value.trim();
  const modelVal = document.getElementById('model-select').value;
  const aiModeVal = document.getElementById('ai-mode-select')?.value || 'flow';
  const tempVal = document.getElementById('temperature').value;
  const apiKeyVal = formatGroqApiKeys(document.getElementById('grok-key').value);
  const status = document.getElementById('settings-status');
  
  if (serverUrlVal) {
    SERVER_URL = serverUrlVal.replace(/\/+$/, ''); // remove trailing slashes
    localStorage.setItem('server_url', SERVER_URL);
  }

  // Update active page configuration on server
  if (activePageId) {
    fetch(`${SERVER_URL}/api/update-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: activePageId,
        shopName: shopNameVal,
        model: modelVal,
        temperature: parseFloat(tempVal),
        apiKey: apiKeyVal,
        aiProvider: 'openrouter',
        aiMode: aiModeVal
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        // Update local connectedPages array
        const pIndex = connectedPages.findIndex(p => p.id === activePageId);
        if (pIndex !== -1) {
          connectedPages[pIndex].name = shopNameVal;
          localStorage.setItem('connected_pages', JSON.stringify(connectedPages));
          updatePageSelectDropdown();
        }
        
        SHOP_NAME = shopNameVal;
        document.getElementById('ms-shop-name').textContent = shopNameVal;
        document.getElementById('shop-avatar-initial').textContent = shopNameVal.charAt(0).toUpperCase();
        BOT_AVATAR = `https://ui-avatars.com/api/?name=${encodeURIComponent(shopNameVal)}&background=1877f2&color=fff&size=28`;
        
        document.getElementById('grok-key').value = apiKeyVal;
        groqApiKey = apiKeyVal;
        localStorage.setItem('groq_api_key', apiKeyVal);
        renderGroqKeyList(apiKeyVal);
        status.innerHTML = `<span style="color:#6ee396">✅ Đã cập nhật cấu hình cho trang thành công!</span>`;
      } else {
        status.innerHTML = `<span style="color:#ff8080">⚠️ Lỗi: ${data.error}</span>`;
      }
    })
    .catch(err => {
      // Fallback local update
      const pIndex = connectedPages.findIndex(p => p.id === activePageId);
      if (pIndex !== -1) {
        connectedPages[pIndex].name = shopNameVal;
        localStorage.setItem('connected_pages', JSON.stringify(connectedPages));
        updatePageSelectDropdown();
      }
      status.innerHTML = `<span style="color:#6ee396">✅ Đã lưu cài đặt cục bộ offline!</span>`;
    });
  } else {
    status.innerHTML = `<span style="color:#ff8080">⚠️ Không tìm thấy Fanpage để cấu hình.</span>`;
  }
  
}

async function resetAllSystemData() {
  if (!confirm("⚠️ CẢNH BÁO: Hành động này sẽ xóa sạch toàn bộ Fanpage đã kết nối, lịch sử đơn hàng và reset hệ thống về mặc định. Bạn có chắc chắn muốn tiếp tục?")) {
    return;
  }
  
  try {
    const resp = await fetch(`${SERVER_URL}/api/reset-all`, { method: 'POST' });
    const result = await resp.json();
    if (result.success) {
      alert("✅ Đã reset toàn bộ hệ thống thành công!");
      localStorage.clear();
      if (window.location.protocol === 'file:') {
        window.location.href = 'index.html';
      } else {
        window.location.href = '/';
      }
    } else {
      alert("⚠️ Lỗi: " + result.error);
    }
  } catch (err) {
    alert("✅ Đã reset ngoại tuyến. Đang dọn dẹp trình duyệt...");
    localStorage.clear();
    if (window.location.protocol === 'file:') {
      window.location.href = 'index.html';
    } else {
      window.location.href = '/';
    }
  }
}

// =============================================
//  INIT – Welcome messages & LocalStorage
// =============================================
window.addEventListener("DOMContentLoaded", async () => {
  // Load server config
  try {
    const resp = await fetch(`${SERVER_URL}/api/config`);
    const config = await resp.json();
    if (config) {
      if (config.fbAppId) {
        localStorage.setItem('fb_app_id', config.fbAppId);
      } else {
        localStorage.removeItem('fb_app_id');
      }
    }
  } catch (e) {}

  // Load API Key
  groqApiKey = formatGroqApiKeys(localStorage.getItem('groq_api_key') || '');
  const keyInput = document.getElementById('grok-key');
  if (keyInput) keyInput.value = groqApiKey;
  renderGroqKeyList(groqApiKey);

  // Load server URL
  const savedServerUrl = localStorage.getItem('server_url') || ((window.location.protocol !== 'file:') ? window.location.origin : 'http://localhost:3000');
  SERVER_URL = savedServerUrl;
  const serverInput = document.getElementById('server-url-input');
  if (serverInput) serverInput.value = savedServerUrl;

  // Temp slider value listener
  const tempSlider = document.getElementById('temperature');
  if (tempSlider) {
    tempSlider.addEventListener('input', (e) => {
      document.getElementById('temp-val').textContent = e.target.value;
    });
  }

  loadScriptSectionsFromScript(localStorage.getItem('chatbot_script') || '');

  // Load connected pages from localStorage
  try {
    const savedPages = JSON.parse(localStorage.getItem('connected_pages') || '[]');
    if (savedPages.length > 0) {
      connectedPages = savedPages;
      activePageId = localStorage.getItem('active_page_id') || connectedPages[0].id;
    }
  } catch(e) {}

  const isDashboardRoute = window.location.pathname.endsWith('/dashboard') || window.location.pathname.endsWith('/dashboard.html');
  const isLoggedIn = localStorage.getItem('is_logged_in') === 'true' && connectedPages.length > 0;
  const fbUserToken = localStorage.getItem('fb_user_access_token');
  fbUserName = localStorage.getItem('fb_user_name');

  if (isDashboardRoute) {
    if (isLoggedIn) {
      // ✅ Đã đăng nhập → vào dashboard ngay, KHÔNG cần FB SDK hay token
      // Server đã lưu Page Token vĩnh viễn trong pages.json
      enterDashboard();
    } else if (fbUserToken) {
      // Có token nhưng chưa chọn page → gọi server đổi token vĩnh viễn
      // fetchUserPages giờ gọi server-side, không cần FB SDK
      console.log('⏳ Đang đổi token qua server...');
      fetchUserPages(fbUserToken);
    } else {
      // Không có token → về trang chủ
      if (window.location.protocol === 'file:') {
        window.location.href = 'index.html';
      } else {
        window.location.href = '/';
      }
    }
  } else {
    // Landing page route
    if (isLoggedIn) {
      if (window.location.protocol === 'file:') {
        window.location.href = 'dashboard.html';
      } else {
        window.location.href = '/dashboard';
      }
    } else {
      const landing = document.getElementById('landing-page');
      if (landing) landing.classList.remove('hidden');
      
      const dashboard = document.getElementById('dashboard-page');
      if (dashboard) dashboard.classList.add('hidden');
      
      // Welcome flow on Landing Page mockup chat
      const msgs = document.getElementById('ms-messages');
      if (msgs && !isDashboardRoute) {
        msgs.innerHTML = '';
        addDateDivider("Hôm nay");
        await new Promise(r => setTimeout(r, 400));
        showTyping();
        await new Promise(r => setTimeout(r, 1000));
        removeTyping();
        appendBotBubble(`Xin chào! 👋 Mình là trợ lý tự động của <b>${SHOP_NAME}</b>.<br>Rất vui được hỗ trợ bạn! 😊`);
        await new Promise(r => setTimeout(r, 600));
        showTyping();
        await new Promise(r => setTimeout(r, 800));
        removeTyping();
        appendBotBubble("Bạn đang quan tâm đến dịch vụ nào ạ?");
        appendQuickReplies([
          { label: "📈 Dịch vụ Ads Facebook", value: "chạy quảng cáo" },
          { label: "💰 Báo giá chi phí", value: "chi phí" },
          { label: "🤝 Cam kết hiệu quả", value: "cam kết hiệu quả" },
          { label: "📞 Hotline liên hệ", value: "hotline liên hệ" }
        ]);
      }
    }
  }
});

// =============================================
//  FACEBOOK SDK INITIALIZATION & EVENTS (CENTRALIZED)
// =============================================
window.fbAsyncInit = function() {
  const appId = localStorage.getItem('fb_app_id') || '';
  if (!appId) {
    console.warn('⚠️ Chưa có Facebook App ID.');
    return;
  }
  FB.init({
    appId: appId,
    cookie: true,
    xfbml: false,
    version: 'v19.0'
  });
  console.log('✅ Facebook SDK centralized initialization successful!');

  // Check if already logged in (on Landing Page)
  const isDashboardRoute = window.location.pathname.endsWith('/dashboard') || window.location.pathname.endsWith('/dashboard.html');
  if (!isDashboardRoute) {
    FB.getLoginStatus(function(response) {
      if (response.status === 'connected') {
        console.log('✅ Already connected to Facebook on Landing Page');
      }
    });
  } else {
    // Nếu đã đăng nhập → không làm gì (DOMContentLoaded đã gọi enterDashboard)
    // Nếu chưa chọn page và có token → DOMContentLoaded đã gọi fetchUserPages rồi
    // fbAsyncInit không cần gọi lại nữa vì fetchUserPages đã dùng server-side exchange
    console.log('✅ Facebook SDK sẵn sàng (dùng cho login popup)');
  }
};

// Inject SDK Script tag dynamically
(function(d, s, id){
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s); js.id = id;
  js.src = "https://connect.facebook.net/vi_VN/sdk.js";
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'facebook-jssdk'));

require("dotenv").config();
const ORIGINAL_ENV = {
  FB_APP_ID: process.env.FB_APP_ID,
  FB_APP_SECRET: process.env.FB_APP_SECRET || process.env.APP_SECRET,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL
};
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const SCRIPT = require("./script");

const app = express();
app.use(bodyParser.json());

// CORS Middleware + bypass ngrok browser warning (cho phép Facebook webhook truy cập)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  // Tắt màn hình "Xác minh danh tính" của ngrok → Facebook bot có thể truy cập webhook
  res.header("ngrok-skip-browser-warning", "true");
  next();
});

const PORT = process.env.PORT || 3000;
const PAGES_FILE = path.join(__dirname, "pages.json");
const ORDERS_FILE = path.join(__dirname, "orders.json");
const CONFIG_FILE = path.join(__dirname, "config.json");
const USERS_FILE = path.join(__dirname, "users.json");
const PLATFORM_USERS_FILE = path.join(__dirname, "platform_users.json");

// Chat History Cache per customer (sender_id)
const chatHistory = {};
const MAX_HISTORY = 6;

// API Key Cooldown Tracker: key → timestamp khi hết cooldown
// Khi key bị 429, nghỉ 60 giây rồi tự kích hoạt lại
const keyCooldowns = {};
const KEY_COOLDOWN_MS = 60 * 1000; // 60 giây

const KNOWN_INDUSTRY_KEYWORDS = [
  "spa", "làm đẹp", "lam dep", "thẩm mỹ", "tham my", "mỹ phẩm", "my pham",
  "nước hoa", "nuoc hoa", "nội thất", "noi that", "nha khoa", "răng", "rang",
  "thời trang", "thoi trang", "quần áo", "quan ao", "giày", "giay", "túi", "tui",
  "nhà hàng", "nha hang", "quán ăn", "quan an", "cafe", "cà phê", "bất động sản",
  "bat dong san", "giáo dục", "giao duc", "khóa học", "khoa hoc", "gym", "yoga",
  "mẹ và bé", "me va be", "điện máy", "dien may", "đồ gia dụng", "do gia dung",
  "phụ kiện", "phu kien", "đồng hồ", "dong ho", "điện thoại", "dien thoai"
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function extractIndustry(userText) {
  const raw = String(userText || "").toLowerCase();
  const normalized = normalizeText(userText);
  const matched = KNOWN_INDUSTRY_KEYWORDS.find(keyword => normalized.includes(normalizeText(keyword)));
  if (matched) return matched;

  const cleaned = raw
    .replace(/^(nganh|ngành|linh vuc|lĩnh vực|con|còn|toi muon chay|tôi muốn chạy|chay|chạy|quang cao|quảng cáo)\s+/i, "")
    .replace(/\?+$/g, "")
    .trim();
  if (cleaned.length >= 3 && cleaned.length <= 40 && !/\d/.test(cleaned)) return cleaned;
  return "";
}

function cleanScriptLine(line) {
  return String(line || "")
    .replace(/^[-*•\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripScriptLabel(line) {
  const cleaned = cleanScriptLine(line);
  const parts = cleaned.split(/[:：]/);
  return parts.length > 1 ? cleanScriptLine(parts.slice(1).join(":")) : cleaned;
}

function cleanPhrase(value) {
  return cleanScriptLine(value).replace(/[.;,]+$/g, "");
}

function formatPlan(label, line) {
  if (!line) return "";
  const value = cleanPhrase(stripScriptLabel(line));
  return `${label} ${value}`;
}

function findScriptLine(script, includesAny) {
  const lines = String(script || "").split(/\r?\n/).map(cleanScriptLine).filter(Boolean);
  return lines.find(line => {
    const normalized = normalizeText(line);
    return includesAny.some(term => normalized.includes(normalizeText(term)));
  }) || "";
}

function findBotOwnerReply(script) {
  const lines = String(script || "").split(/\r?\n/).map(cleanScriptLine).filter(Boolean).reverse();
  return lines.find(line => {
    const normalized = normalizeText(line);
    return normalized.includes("tao ra") && (normalized.includes("duoc") || normalized.includes("tra loi") || normalized.includes("anh"));
  }) || "";
}

function extractScriptValue(script, labels) {
  const lines = String(script || "").split(/\r?\n/).map(cleanScriptLine).filter(Boolean);
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!labels.some(label => normalized.startsWith(normalizeText(label)))) continue;
    const parts = line.split(/[:：]/);
    return cleanScriptLine(parts.slice(1).join(":") || line);
  }
  return "";
}

function getTenantProfile(script, pageConfig = {}) {
  const source = String(script || "");
  const normalized = normalizeText(source);
  const quotedName = source.match(/"([^"]+)"/);
  const name = cleanScriptLine((quotedName && quotedName[1]) || pageConfig.name || "shop");
  const contact = extractScriptValue(source, ["Hotline/Zalo", "Zalo tư vấn", "Zalo", "Hotline", "Số điện thoại", "SDT"]);
  const address = extractScriptValue(source, ["Địa chỉ", "Dia chi", "Địa chỉ văn phòng"]);
  const website = extractScriptValue(source, ["Website", "Web"]);
  const dailyLine = findScriptLine(source, ["gói ngày", "300k/ngày", "300k/ngay"]);
  const testLine = findScriptLine(source, ["gói chạy thử", "gói test", "3-5 triệu", "3-5 trieu"]);
  const monthlyLine = findScriptLine(source, ["gói chạy ổn định", "gói tháng", "5-20 triệu", "5-20 trieu"]);
  const feeFiveLine = findScriptLine(source, ["5%", "từ 5 triệu", "tu 5 trieu"]);
  const feeTenLine = findScriptLine(source, ["10%", "dưới 5 triệu", "duoi 5 trieu"]);
  const hasAds = /(chay quang cao|quang cao facebook|facebook ads)/.test(normalized);
  const hasAdsPricing = hasAds && Boolean(dailyLine || testLine || monthlyLine || /300k|3\s*-\s*5|5\s*-\s*20/.test(normalized));

  return {
    name,
    contact,
    address,
    website,
    dailyLine,
    testLine,
    monthlyLine,
    feeFiveLine,
    feeTenLine,
    hasAds,
    hasAdsPricing,
    ownerReply: findBotOwnerReply(source)
  };
}

function buildContactClose(profile) {
  return profile.contact
    ? `Anh/chị nhắn Zalo/Hotline ${profile.contact} để em gọi trao đổi kỹ hơn nhé 📞`
    : "Anh/chị để lại số điện thoại để bên em gọi trao đổi kỹ hơn nhé 📞";
}

function buildTenantPriceReply(profile) {
  if (!profile.hasAdsPricing) return "";
  const plans = [
    formatPlan("gói ngày", profile.dailyLine),
    formatPlan("gói test", profile.testLine),
    formatPlan("gói tháng ổn định", profile.monthlyLine)
  ].filter(Boolean);
  const fees = [
    formatPlan("ngân sách từ 5 triệu trở lên", profile.feeFiveLine),
    formatPlan("ngân sách dưới 5 triệu", profile.feeTenLine)
  ].filter(Boolean);
  const planText = plans.length
    ? plans.join(", ")
    : "gói ngày 300k/ngày tối thiểu 7 ngày, gói test 3-5 triệu/tháng và gói tháng ổn định 5-20 triệu/tháng";
  const feeText = fees.length
    ? ` Phí dịch vụ: ${fees.join(", ")}.`
    : "";
  return `Dạ bên em có ${planText} ạ.${feeText} ${buildContactClose(profile)}`;
}

function buildTenantDailyReply(profile) {
  if (!profile.hasAdsPricing) return "";
  const dailyText = profile.dailyLine ? cleanPhrase(stripScriptLabel(profile.dailyLine)) : "gói ngày 300k/ngày, chạy tối thiểu 7 ngày";
  return `Dạ bên em có gói ngày ${dailyText} ạ. Gói này phù hợp để test phản hồi ban đầu trước khi lên ngân sách tháng. ${buildContactClose(profile)}`;
}

function buildTenantLowBudgetReply(profile) {
  if (!profile.hasAdsPricing) return "";
  const dailyText = profile.dailyLine ? cleanPhrase(stripScriptLabel(profile.dailyLine)) : "bắt đầu từ 300k/ngày và chạy tối thiểu 7 ngày";
  return `Dạ hiện gói ngày bên em ${dailyText} ạ. Ngân sách 100k/ngày chưa phù hợp để tối ưu nghiêm túc. Nếu mình muốn test bài bản, ${buildContactClose(profile)}`;
}

function buildTenantFeeReply(profile) {
  const fees = [
    formatPlan("ngân sách từ 5 triệu trở lên", profile.feeFiveLine),
    formatPlan("ngân sách dưới 5 triệu", profile.feeTenLine)
  ].filter(Boolean);
  if (!fees.length) return "";
  return `Dạ phí dịch vụ bên em là ${fees.join(", ")} ạ. Phí này thu sau khi quảng cáo bắt đầu hoạt động.`;
}

function buildTenantIndustryReply(industry, profile) {
  if (!profile.hasAdsPricing) return "";
  const price = buildTenantPriceReply(profile);
  const name = industry || "ngành này";
  return price
    ? `Dạ ngành ${name} bên em tư vấn chạy được ạ. ${price}`
    : "";
}

function buildTenantFallbackReply(script, pageConfig = {}) {
  const profile = getTenantProfile(script, pageConfig);
  if (profile.hasAdsPricing) return buildTenantPriceReply(profile);
  return profile.contact
    ? `Dạ em đã nhận thông tin rồi ạ. Anh/chị nhắn Zalo/Hotline ${profile.contact} để bên em hỗ trợ nhanh hơn nhé.`
    : "Dạ em đã nhận thông tin rồi ạ. Anh/chị để lại số điện thoại để bên em hỗ trợ nhanh hơn nhé.";
}

function getQuickReply(userText, script, pageConfig = {}) {
  const raw = String(userText || "").trim();
  const text = normalizeText(raw);
  const profile = getTenantProfile(script, pageConfig);

  // Chỉ xử lý lời chào (1-2 từ ngắn, chưa hỏi gì cụ thể)
  // Nếu tin nhắn dài hơn (có ngành, sản phẩm, câu hỏi...) thì để AI xử lý
  if (/^(alo|hi|hello|chao|xin chao|shop oi|ban oi|ad oi|admin oi)$/.test(text)) {
    return profile.hasAds
      ? `Dạ em chào anh/chị ạ 😊 Em là tư vấn viên của ${profile.name}, bên em hỗ trợ tư vấn và chạy quảng cáo Facebook. Anh/chị đang muốn chạy quảng cáo cho ngành nào ạ?`
      : `Dạ em chào anh/chị ạ 😊 Em là tư vấn viên của ${profile.name}. Anh/chị cần em hỗ trợ phần nào ạ?`;
  }
  if (/(ai tao|ai lam|do ai tao|ban do ai|bot do ai|m tao ra|may do ai)/.test(text)) {
    return profile.ownerReply || `Dạ em là trợ lý tự động của ${profile.name}, được cấu hình để hỗ trợ tư vấn khách hàng nhanh hơn ạ.`;
  }
  if (/^(zalo|hotline|so dien thoai|sdt)$/.test(text) && profile.contact) {
    return `Dạ Hotline/Zalo bên em là ${profile.contact} ạ.`;
  }
  if (/^(dia chi|o dau|van phong)$/.test(text) && profile.address) {
    return `Dạ địa chỉ bên em ở ${profile.address} ạ.`;
  }
  if (/^(website|web)$/.test(text) && profile.website) {
    return `Dạ website bên em là ${profile.website} ạ.`;
  }

  // Tất cả câu hỏi còn lại (giá, ngành hàng, tư vấn...) → Groq AI xử lý theo kịch bản
  return "";
}

function parseGroqApiKeys(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map(k => k.trim())
      .filter(Boolean)
  )];
}

// =============================================
//  USER TRACKING HELPERS
// =============================================
function getUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch(e) { return {}; }
}

function trackUser(senderId, pageId, pageName, userMsg, botReply) {
  const users = getUsers();
  const now = new Date().toISOString();
  if (!users[senderId]) {
    users[senderId] = {
      id: senderId,
      pageId, pageName,
      firstSeen: now,
      lastSeen: now,
      messageCount: 0,
      conversations: []
    };
  }
  users[senderId].lastSeen = now;
  users[senderId].pageId = pageId;
  users[senderId].pageName = pageName;
  users[senderId].messageCount = (users[senderId].messageCount || 0) + 1;
  users[senderId].conversations = users[senderId].conversations || [];
  users[senderId].conversations.push({
    time: new Date().toLocaleString('vi-VN'),
    user: userMsg,
    bot: botReply
  });
  // Keep last 50 conversations
  if (users[senderId].conversations.length > 50) {
    users[senderId].conversations = users[senderId].conversations.slice(-50);
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// =============================================
//  PLATFORM USER (SaaS) HELPERS
// =============================================
function getPlatformUsers() {
  if (!fs.existsSync(PLATFORM_USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PLATFORM_USERS_FILE, 'utf-8')); } catch(e) { return {}; }
}

function savePlatformUsers(data) {
  fs.writeFileSync(PLATFORM_USERS_FILE, JSON.stringify(data, null, 2));
}

function registerPlatformUser(fbUserId, name, pages) {
  const users = getPlatformUsers();
  const now = new Date().toISOString();
  if (!users[fbUserId]) {
    // New user: give 7-day free trial
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    users[fbUserId] = {
      id: fbUserId,
      name,
      registeredAt: now,
      lastLoginAt: now,
      expiryDate: trialEnd,
      status: 'active',   // active | blocked | expired
      plan: 'trial',
      pages: pages || []
    };
    console.log(`🆕 Người dùng mới đăng ký: ${name} (${fbUserId}) - Dùng thử 7 ngày`);
  } else {
    users[fbUserId].lastLoginAt = now;
    users[fbUserId].name = name;
    if (pages && pages.length) users[fbUserId].pages = pages;
    // Auto-mark expired
    if (users[fbUserId].status !== 'blocked' && new Date(users[fbUserId].expiryDate) < new Date()) {
      users[fbUserId].status = 'expired';
    }
  }
  savePlatformUsers(users);
  return users[fbUserId];
}

// Helper to get system configurations (environment fallback to config.json)
function getConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch (e) {}
  }
  return {
    fbAppId: process.env.FB_APP_ID || fileConfig.fbAppId || ORIGINAL_ENV.FB_APP_ID || "",
    fbAppSecret: process.env.FB_APP_SECRET || process.env.APP_SECRET || fileConfig.fbAppSecret || ORIGINAL_ENV.FB_APP_SECRET || "",
    verifyToken: process.env.VERIFY_TOKEN || fileConfig.verifyToken || ORIGINAL_ENV.VERIFY_TOKEN || "mysecrettoken123",
    groqApiKey: process.env.GROQ_API_KEY || fileConfig.groqApiKey || ORIGINAL_ENV.GROQ_API_KEY || "",
    groqModel: process.env.GROQ_MODEL || fileConfig.groqModel || ORIGINAL_ENV.GROQ_MODEL || "llama-3.3-70b-versatile"
  };
}

// Helper to write system configurations
function saveConfig(data) {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch (e) {}
  }
  const updated = { ...fileConfig, ...data };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
  
  if (data.fbAppId) process.env.FB_APP_ID = data.fbAppId;
  if (data.fbAppSecret) process.env.FB_APP_SECRET = data.fbAppSecret;
  if (data.verifyToken) process.env.VERIFY_TOKEN = data.verifyToken;
  if (data.groqApiKey) process.env.GROQ_API_KEY = data.groqApiKey;
  if (data.groqModel) process.env.GROQ_MODEL = data.groqModel;
}

// Helper to read connected pages database
function getPages() {
  if (!fs.existsSync(PAGES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PAGES_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

// Helper to save connected page to database
function savePage(pageId, pageName, pageToken, script) {
  const pages = getPages();
  const config = getConfig();
  pages[pageId] = {
    id: pageId,
    name: pageName,
    token: pageToken || config.pageAccessToken || "", 
    script: script || SCRIPT, 
    model: pages[pageId]?.model || config.groqModel || "llama-3.3-70b-versatile",
    temperature: pages[pageId]?.temperature !== undefined ? pages[pageId].temperature : 0.7,
    apiKey: pages[pageId]?.apiKey || "",
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2));
}

// Helper to call Facebook Graph API to subscribe webhook to page
async function subscribePageWebhook(pageId, pageToken) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`,
      null,
      {
        params: {
          access_token: pageToken,
          subscribed_fields: "messages,messaging_postbacks"
        }
      }
    );
    console.log(`✅ Subscribed Page ${pageId} to Facebook Webhook successfully!`, response.data);
    return true;
  } catch (err) {
    console.error(`⚠️ Webhook subscription request failed for Page ${pageId}:`, err.response?.data || err.message);
    return false;
  }
}

// =============================================
//  SAAS API ENDPOINTS FOR FRONTEND INTEGRATION
// =============================================

// API to get system public config
app.get("/api/config", (req, res) => {
  const config = getConfig();
  res.json({
    fbAppId: config.fbAppId,
    verifyToken: config.verifyToken,
    hasAppSecret: !!config.fbAppSecret
  });
});

// =============================================
//  ADMIN AUTH MIDDLEWARE (Basic Auth)
// =============================================
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Namc6352@@@@@';

function adminAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NNA Admin Panel"');
    return res.status(401).send(`
      <!DOCTYPE html><html lang="vi"><head>
      <meta charset="UTF-8"><title>Đăng nhập Admin</title>
      <style>
        body{font-family:Arial,sans-serif;background:#0f0c29;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        .box{background:#1a1a2e;border:1px solid #1877f2;border-radius:12px;padding:40px;text-align:center;color:#fff}
        h2{color:#1877f2;margin-bottom:8px}p{color:#aaa;font-size:13px}
      </style></head><body>
      <div class="box"><h2>🔐 NNA Admin Panel</h2><p>Vui lòng đăng nhập để tiếp tục.</p></div>
      </body></html>
    `);
  }
  const encoded = auth.split(' ')[1];
  const decoded = Buffer.from(encoded, 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const user = decoded.substring(0, colonIdx);
  const pass = decoded.substring(colonIdx + 1);
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="NNA Admin Panel"');
  return res.status(401).send('❌ Sai tên đăng nhập hoặc mật khẩu!');
}

// =============================================
//  SERVE FRONTEND DASHBOARD (Static Files)
// =============================================
const PARENT_DIR = path.join(__dirname, '..');
const FRONTEND_DIR = fs.existsSync(path.join(PARENT_DIR, 'index.html'))
  ? PARENT_DIR   // Local: dùng thư mục cha d:\chatbot
  : __dirname;   // Railway: dùng thư mục hiện tại (đã copy frontend vào)
app.use(express.static(FRONTEND_DIR, { index: 'index.html' }));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Serve dashboard.html for management page - PROTECTED
app.get('/dashboard', adminAuth, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'dashboard.html'));
});


// =============================================
//  TOKEN EXCHANGE: Short-lived → PERMANENT Page Tokens
// =============================================
// Page Access Tokens lấy từ Long-lived User Token là VĨNH VIỄN (không hết hạn)
// Đây là giải pháp triệt để cho vấn đề "Session has expired"
app.post("/api/exchange-token", async (req, res) => {
  const { userAccessToken } = req.body;
  const config = getConfig();

  if (!userAccessToken) {
    return res.status(400).json({ success: false, error: "Thiếu userAccessToken" });
  }
  if (!config.fbAppId || !config.fbAppSecret) {
    return res.status(500).json({ success: false, error: "Server chưa cấu hình FB_APP_ID hoặc FB_APP_SECRET" });
  }

  try {
    // Bước 1: Đổi short-lived (1-2 giờ) → Long-lived User Token (60 ngày)
    const exchangeResp = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: config.fbAppId,
        client_secret: config.fbAppSecret,
        fb_exchange_token: userAccessToken
      }
    });
    const longLivedToken = exchangeResp.data.access_token;
    const expiresIn = exchangeResp.data.expires_in; // ~5184000 giây = 60 ngày
    console.log(`🔑 Đã đổi thành Long-lived User Token (hết hạn sau ${Math.round(expiresIn/86400)} ngày)`);

    // Bước 2: Dùng long-lived token để lấy Page Access Tokens
    // ✅ Page tokens từ long-lived user token là VĨNH VIỄN (không bao giờ hết hạn)
    const pagesResp = await axios.get("https://graph.facebook.com/v19.0/me/accounts", {
      params: {
        access_token: longLivedToken,
        fields: "id,name,category,access_token,picture"
      }
    });

    const pages = pagesResp.data.data || [];
    console.log(`✅ Đã lấy token vĩnh viễn cho ${pages.length} Fanpage!`);

    res.json({
      success: true,
      longLivedToken,
      expiresIn,
      pages: pages.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        access_token: p.access_token, // ← Token này VĨNH VIỄN
        picture: p.picture
      }))
    });
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error("❌ Lỗi đổi token:", errMsg);
    res.status(500).json({ success: false, error: errMsg });
  }
});

// API to save system config
app.post("/api/save-config", (req, res) => {
  const { fbAppId, fbAppSecret, verifyToken, groqApiKey, groqModel } = req.body;
  saveConfig({ fbAppId, fbAppSecret, verifyToken, groqApiKey, groqModel });
  console.log("⚙️ Đã lưu cấu hình hệ thống mới!");
  res.json({ success: true });
});

// API to reset all system data
app.post("/api/reset-all", (req, res) => {
  try {
    // 1. Wipe connected pages
    fs.writeFileSync(PAGES_FILE, JSON.stringify({}, null, 2));
    
    // 2. Wipe orders if exists
    if (fs.existsSync(ORDERS_FILE)) {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
    }
    
    // 3. Reset config.json to empty state (keep only default placeholders)
    const defaultConfig = {
      fbAppId: "759513787182248", // Keep their real App ID so they don't lose it
      fbAppSecret: "",
      verifyToken: "mysecrettoken123",
      groqApiKey: "",
      groqModel: "llama-3.3-70b-versatile"
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    
    // 4. Update in-memory environment variables (fallback to original system variables if cleared)
    process.env.FB_APP_ID = defaultConfig.fbAppId || ORIGINAL_ENV.FB_APP_ID;
    process.env.FB_APP_SECRET = defaultConfig.fbAppSecret || ORIGINAL_ENV.FB_APP_SECRET;
    process.env.VERIFY_TOKEN = defaultConfig.verifyToken || ORIGINAL_ENV.VERIFY_TOKEN;
    process.env.GROQ_API_KEY = defaultConfig.groqApiKey || ORIGINAL_ENV.GROQ_API_KEY;
    process.env.GROQ_MODEL = defaultConfig.groqModel || ORIGINAL_ENV.GROQ_MODEL;
    
    console.log("🚨 ĐÃ RESET TOÀN BỘ HỆ THỐNG VỀ MẶC ĐỊNH!");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API to update settings for a Fanpage
app.post("/api/update-settings", (req, res) => {
  const { pageId, shopName, model, temperature, apiKey } = req.body;
  if (!pageId) {
    return res.status(400).json({ error: "Missing pageId parameter" });
  }

  const pages = getPages();
  if (!pages[pageId]) {
    return res.status(404).json({ error: "Page not found" });
  }

  if (shopName) pages[pageId].name = shopName;
  if (model) pages[pageId].model = model;
  if (temperature !== undefined) pages[pageId].temperature = parseFloat(temperature);
  if (apiKey !== undefined) pages[pageId].apiKey = apiKey;
  pages[pageId].updatedAt = new Date().toISOString();

  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2));
  console.log(`⚙️ Cập nhật cài đặt cho Fanpage: ${pages[pageId].name} (ID: ${pageId})`);
  res.json({ success: true });
});

// API to connect a new Fanpage from the Facebook Login modal flow
app.post("/api/connect-page", async (req, res) => {
  const { pageId, pageName, pageToken, script } = req.body;
  if (!pageId || !pageName) {
    return res.status(400).json({ error: "Missing pageId or pageName parameters" });
  }

  console.log(`🔌 Kết nối Fanpage mới: ${pageName} (ID: ${pageId})`);
  
  // 1. Save to local database
  savePage(pageId, pageName, pageToken, script);
  
  // 2. Call Facebook Graph API to register Webhook
  if (pageToken && !pageToken.startsWith("mock_")) {
    await subscribePageWebhook(pageId, pageToken);
  }

  res.json({ success: true, message: `Connected page ${pageName} successfully` });
});

// API to update the script of a Fanpage dynamically from the dashboard
app.post("/api/update-script", (req, res) => {
  const { pageId, script } = req.body;
  if (!pageId || !script) {
    return res.status(400).json({ error: "Missing pageId or script parameters" });
  }

  const pages = getPages();
  if (!pages[pageId]) {
    // If not exists, save a new entry
    console.log(`📝 Tạo mới kịch bản cho Page ID: ${pageId}`);
    savePage(pageId, "Custom Page", "", script);
  } else {
    console.log(`📝 Cập nhật kịch bản cho Fanpage: ${pages[pageId].name} (ID: ${pageId})`);
    pages[pageId].script = script;
    fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2));
  }

  res.json({ success: true });
});

// =============================================
//  PLATFORM USER MANAGEMENT APIs
// =============================================

// Register / update platform user on login (called from frontend after FB login)
app.post('/api/platform-users/register', (req, res) => {
  const { fbUserId, name, pages } = req.body;
  if (!fbUserId || !name) return res.status(400).json({ error: 'Missing fbUserId or name' });
  const user = registerPlatformUser(fbUserId, name, pages);
  res.json({ success: true, user: {
    id: user.id, name: user.name, status: user.status,
    expiryDate: user.expiryDate, plan: user.plan
  }});
});

// Check if a specific user is allowed (called from frontend before entering dashboard)
app.get('/api/platform-users/check/:fbUserId', (req, res) => {
  const users = getPlatformUsers();
  const user = users[req.params.fbUserId];
  if (!user) return res.json({ allowed: true, isNew: true }); // new user, allow
  // Auto-expire check
  if (user.status !== 'blocked' && new Date(user.expiryDate) < new Date()) {
    user.status = 'expired';
    savePlatformUsers(users);
  }
  res.json({
    allowed: user.status === 'active',
    status: user.status,
    expiryDate: user.expiryDate,
    plan: user.plan,
    name: user.name
  });
});

// List all platform users (ADMIN ONLY)
app.get('/api/platform-users', adminAuth, (req, res) => {
  const users = getPlatformUsers();
  const list = Object.values(users).map(u => ({
    id: u.id, name: u.name, status: u.status,
    plan: u.plan, registeredAt: u.registeredAt,
    lastLoginAt: u.lastLoginAt, expiryDate: u.expiryDate,
    pageCount: (u.pages || []).length
  }));
  list.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  res.json(list);
});

// Update user: status, expiry, plan (ADMIN ONLY)
app.put('/api/platform-users/:fbUserId', adminAuth, (req, res) => {
  const users = getPlatformUsers();
  const user = users[req.params.fbUserId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { status, expiryDate, plan } = req.body;
  if (status) user.status = status;
  if (expiryDate) user.expiryDate = new Date(expiryDate).toISOString();
  if (plan) user.plan = plan;
  user.updatedAt = new Date().toISOString();
  savePlatformUsers(users);
  console.log(`⚙️ Cập nhật tài khoản: ${user.name} -> status=${user.status}, expiry=${user.expiryDate}`);
  res.json({ success: true, user });
});

// Delete platform user (ADMIN ONLY)
app.delete('/api/platform-users/:fbUserId', adminAuth, (req, res) => {
  const users = getPlatformUsers();
  if (!users[req.params.fbUserId]) return res.status(404).json({ error: 'Not found' });
  const name = users[req.params.fbUserId].name;
  delete users[req.params.fbUserId];
  savePlatformUsers(users);
  console.log(`🗑️ Đã xóa tài khoản: ${name}`);
  res.json({ success: true });
});

// API to list connected pages
app.get("/api/connected-pages", (req, res) => {
  res.json(Object.values(getPages()));
});

// API to list all users (customers who chatted)
app.get("/api/users", (req, res) => {
  const users = getUsers();
  const { pageId } = req.query;
  let list = Object.values(users);
  if (pageId) list = list.filter(u => u.pageId === pageId);
  // Sort by lastSeen desc
  list.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  res.json(list);
});

// API to get conversation history of a specific user
app.get("/api/users/:senderId", (req, res) => {
  const users = getUsers();
  const user = users[req.params.senderId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// API to delete/block a user
app.delete("/api/users/:senderId", (req, res) => {
  const users = getUsers();
  if (users[req.params.senderId]) {
    delete users[req.params.senderId];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
  res.json({ success: true });
});

// API to test chatbot response (for dashboard demo chat)
app.post("/api/test-chat", async (req, res) => {
  const { pageId, text, senderId } = req.body;
  if (!pageId || !text) {
    return res.status(400).json({ error: "Thiếu pageId hoặc nội dung tin nhắn text." });
  }
  const mockSender = senderId || "dashboard-test";
  try {
    const reply = await generateBotResponse(text, pageId, mockSender);
    res.json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
//  FACEBOOK WEBHOOK VERIFICATION (GET /webhook)
// =============================================
// =============================================
//  FACEBOOK WEBHOOK VERIFICATION (GET /webhook)
// =============================================
app.get("/webhook", (req, res) => {
  const config = getConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Log verification request
  try {
    const logFile = path.join(__dirname, "webhook_logs.json");
    let logs = [];
    if (fs.existsSync(logFile)) {
      try { logs = JSON.parse(fs.readFileSync(logFile, "utf-8")); } catch(e) {}
    }
    logs.push({
      time: new Date().toLocaleString("vi-VN"),
      type: "VERIFY_GET",
      query: req.query
    });
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  } catch(e) {}

  if (mode === "subscribe" && token === config.verifyToken) {
    console.log("✅ Webhook xác minh thành công!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Webhook xác minh thất bại! Kiểm tra VERIFY_TOKEN");
    res.sendStatus(403);
  }
});

// =============================================
//  RECEIVE FACEBOOK MESSENGER EVENTS (POST /webhook)
// =============================================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Log incoming webhook post payload
  try {
    const logFile = path.join(__dirname, "webhook_logs.json");
    let logs = [];
    if (fs.existsSync(logFile)) {
      try { logs = JSON.parse(fs.readFileSync(logFile, "utf-8")); } catch(e) {}
    }
    logs.push({
      time: new Date().toLocaleString("vi-VN"),
      type: "MESSAGE_POST",
      body: body
    });
    if (logs.length > 50) logs = logs.slice(-50);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  } catch(e) {}

  if (body.object !== "page") return res.sendStatus(404);

  for (const entry of body.entry) {
    const pageId = entry.id; // Page ID receiving the webhook event
    const events = entry.messaging || [];
    for (const event of events) {
      const senderId = event.sender?.id;
      if (!senderId) continue;

      if (event.message?.text) {
        const text = event.message.text;
        console.log(`📩 Khách [${senderId}] -> Page [${pageId}]: ${text}`);
        await handleMessage(senderId, text, pageId);
      }

      if (event.postback?.payload) {
        const payload = event.postback.payload;
        console.log(`🔘 Postback [${senderId}] -> Page [${pageId}]: ${payload}`);
        await handleMessage(senderId, payload, pageId);
      }
    }
  }

  res.sendStatus(200);
});

// =============================================
//  DYNAMIC MULTI-TENANT MESSAGING LOGIC
// =============================================
// =============================================
//  BOT RESPONSE GENERATOR (SHARED LOGIC)
// =============================================
async function generateBotResponse(userText, pageId, senderId) {
  const pages = getPages();
  const pageConfig = pages[pageId] || {};
  const config = getConfig();

  let script = pageConfig.script || SCRIPT;
  let model = pageConfig.model || config.groqModel || "llama-3.3-70b-versatile";
  let temperature = pageConfig.temperature !== undefined ? parseFloat(pageConfig.temperature) : 0.7;

  let apiKeys = [];
  if (pageConfig.apiKey) {
    apiKeys.push(...parseGroqApiKeys(pageConfig.apiKey));
  }
  if (config.groqApiKey) {
    apiKeys.push(...parseGroqApiKeys(config.groqApiKey));
  }
  apiKeys = [...new Set(apiKeys)];

  // Luôn gọi AI cho mọi tin nhắn — không dùng quick reply cứng
  if (apiKeys.length === 0) {
    throw new Error("Chưa cấu hình Groq API Key cho Page ID này hoặc hệ thống.");
  }

  // Initialize conversation history
  if (!chatHistory[senderId]) {
    chatHistory[senderId] = [];
  }

  chatHistory[senderId].push({
    role: "user",
    content: userText
  });

  if (chatHistory[senderId].length > MAX_HISTORY) {
    chatHistory[senderId] = chatHistory[senderId].slice(-MAX_HISTORY);
  }

  // Gọi Groq AI — retry với tất cả key, nếu thất bại thì đợi 2s rồi thử lại 1 lần nữa
  try {
    const aiReply = await callGroqAIWithRetry(senderId, chatHistory[senderId], script, model, temperature, apiKeys);
    chatHistory[senderId].push({
      role: "assistant",
      content: aiReply
    });
    return aiReply;
  } catch (aiErr) {
    console.error("⚠️ Lần 1 thất bại, đợi 2s rồi thử lại...", aiErr.message);
    // Retry lần cuối sau 2 giây
    try {
      await sleep(2000);
      const aiReply2 = await callGroqAIWithRetry(senderId, chatHistory[senderId], script, model, temperature, apiKeys);
      chatHistory[senderId].push({
        role: "assistant",
        content: aiReply2
      });
      return aiReply2;
    } catch (aiErr2) {
      console.error("❌ Lần 2 cũng thất bại:", aiErr2.message);
      const profile = getTenantProfile(script, pageConfig);
      const fallbackMsg = profile.contact
        ? `Dạ anh/chị cho em xin thêm thông tin chi tiết nhé, hoặc anh/chị nhắn trực tiếp qua Zalo/Hotline ${profile.contact} để em hỗ trợ nhanh hơn ạ 😊`
        : `Dạ anh/chị cho em xin thêm thông tin chi tiết nhé để em tư vấn chính xác hơn ạ 😊`;
      chatHistory[senderId].push({
        role: "assistant",
        content: fallbackMsg
      });
      return fallbackMsg;
    }
  }
}

// =============================================
//  DYNAMIC MULTI-TENANT MESSAGING LOGIC
// =============================================
async function handleMessage(senderId, userText, pageId) {
  try {
    // 1. Look up configurations for this specific Page ID
    const pages = getPages();
    const pageConfig = pages[pageId] || {};
    const token = pageConfig.token;
    
    if (!token) {
      console.warn(`⚠️ CẢNH BÁO: Chưa cấu hình Page Token cho Page ID: ${pageId}`);
      return;
    }

    // Send typing indicator
    await sendTyping(senderId, true, token);

    // Generate response using shared logic
    const reply = await generateBotResponse(userText, pageId, senderId);

    // Turn off typing indicator
    await sendTyping(senderId, false, token);

    // Send messages back to user
    const parts = splitMessage(reply, 2000);
    for (const part of parts) {
      await sendTextMessage(senderId, part, token);
      if (parts.length > 1) await sleep(500);
    }

    // Auto-detect and save order
    if (isOrderConfirmed(reply)) {
      saveOrder(senderId, userText, reply, pageId);
    }

    // Track user conversation
    const pageName = pageConfig.name || pageId;
    trackUser(senderId, pageId, pageName, userText, reply);

  } catch (err) {
    console.error("❌ Lỗi xử lý tin nhắn:", err.message);
  }
}

// =============================================
//  GROQ AI CORE COMPLETION & RETRY HELPER (MULTI-KEY ROTATION + COOLDOWN)
// =============================================
function isKeyCoolingDown(key) {
  const until = keyCooldowns[key];
  if (!until) return false;
  if (Date.now() >= until) {
    delete keyCooldowns[key]; // Hết cooldown → kích hoạt lại
    return false;
  }
  return true;
}

function setCooldown(key) {
  keyCooldowns[key] = Date.now() + KEY_COOLDOWN_MS;
  const maskedKey = `...${key.slice(-6)}`;
  console.warn(`⏸️ Key ${maskedKey} bị tạm nghỉ ${KEY_COOLDOWN_MS / 1000}s. Tự kích hoạt lại lúc ${new Date(keyCooldowns[key]).toLocaleTimeString('vi-VN')}`);
}

async function callGroqAIWithRetry(senderId, history, script, model, temperature, apiKeys, retries = 2, delay = 1000) {
  const allKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  
  if (allKeys.length === 0) {
    throw new Error("Không có Groq API Key nào được cấu hình!");
  }

  // Ưu tiên key chưa bị cooldown trước, key đang cooldown xếp sau
  const activeKeys = allKeys.filter(k => !isKeyCoolingDown(k));
  const cooldownKeys = allKeys.filter(k => isKeyCoolingDown(k));
  const sortedKeys = [...activeKeys, ...cooldownKeys];

  if (activeKeys.length === 0) {
    console.warn(`⚠️ Tất cả ${allKeys.length} key đang trong thời gian nghỉ. Thử key cũ nhất...`);
  }

  let lastError;
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const maskedKey = `...${key.slice(-6)}`;
    const isCooling = isKeyCoolingDown(key);
    
    if (isCooling && activeKeys.length > 0) {
      // Bỏ qua key đang cooldown nếu còn key active
      continue;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🤖 [Key ${i + 1}/${sortedKeys.length}] Gọi Groq AI với key: ${maskedKey}${isCooling ? ' (đang cooldown, thử lại)' : ''}`);
        const result = await callGroqAI(senderId, history, script, model, temperature, key);
        // Thành công → xóa cooldown nếu có
        if (keyCooldowns[key]) {
          delete keyCooldowns[key];
          console.log(`✅ Key ${maskedKey} đã hoạt động trở lại!`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const isRateLimit = err.response?.status === 429 || err.message?.includes("429");
        if (isRateLimit) {
          if (attempt < retries) {
            console.warn(`⚠️ Key ${maskedKey} bị 429. Thử lại lần ${attempt}/${retries} sau ${delay}ms...`);
            await sleep(delay);
            continue;
          } else {
            // Đánh dấu cooldown cho key này
            setCooldown(key);
            break; // Chuyển sang key tiếp theo
          }
        }
        console.warn(`❌ Lỗi key ${maskedKey}: ${err.message}. Chuyển key tiếp theo...`);
        break;
      }
    }
  }
  throw lastError || new Error("Tất cả API Key dự phòng đều thất bại!");
}

async function callGroqAI(senderId, history, script, model, temperature, apiKey) {
  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: model,
      messages: [
        {
          role: "system",
          content: script
        },
        ...history
      ],
      max_tokens: 500,
      temperature: temperature
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return response.data.choices[0].message.content.trim();
}

// =============================================
//  SEND MESSAGE TO FACEBOOK GRAPH API
// =============================================
async function sendTextMessage(recipientId, text, token) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    {
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE"
    },
    {
      params: { access_token: token }
    }
  );
}

// Send Typing Indicator
async function sendTyping(recipientId, isOn, token) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    {
      recipient: { id: recipientId },
      sender_action: isOn ? "typing_on" : "typing_off"
    },
    {
      params: { access_token: token }
    }
  );
}

// =============================================
//  UTILITY FUNCTIONS
// =============================================
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isOrderConfirmed(text) {
  const keywords = ["đã nhận đơn", "xác nhận đơn", "ghi nhận đơn", "đơn hàng của"];
  return keywords.some(k => text.toLowerCase().includes(k));
}

function saveOrder(senderId, userText, botReply, pageId) {
  let orders = [];
  if (fs.existsSync(ORDERS_FILE)) {
    try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8")); } catch {}
  }
  
  const pages = getPages();
  const pageName = pages[pageId] ? pages[pageId].name : "Fanpage";

  orders.push({
    id: `ORD-${Date.now()}`,
    senderId,
    pageId,
    pageName,
    time: new Date().toLocaleString("vi-VN"),
    userMessage: userText,
    botReply,
  });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  console.log(`📦 Đã lưu đơn hàng mới cho Fanpage: ${pageName}!`);
}

// =============================================
//  WEB SERVER DASHBOARD STATUS PAGE
// =============================================
app.get("/", (req, res) => {
  const pages = getPages();
  const pageListHtml = Object.values(pages).map(p => `
    <li>🟢 <b>${p.name}</b> (ID: <code>${p.id}</code>)</li>
  `).join("") || "<li>Chưa có Fanpage nào được liên kết.</li>";

  res.send(`
    <html>
    <head><title>NguyenNamChat Server</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 20px; }
      .ok { color: green; font-size: 48px; }
      h1 { color: #1877f2; }
      .info { background: #f0f2f5; padding: 16px; border-radius: 8px; margin-top: 16px; }
      code { background: #e4e6eb; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
      ul { padding-left: 20px; margin-top: 8px; }
      li { margin-bottom: 6px; }
    </style>
    </head>
    <body>
      <div class="ok">✅</div>
      <h1>NguyenNamChat Server Running</h1>
      <p>Server chatbot đang hoạt động ổn định!</p>
      
      <div class="info">
        <b>Các Trang đã liên kết (${Object.keys(pages).length}):</b>
        <ul>${pageListHtml}</ul>
      </div>

      <div class="info" style="margin-top:12px">
        <b>Webhook URL của bạn:</b><br>
        <code>https://YOUR_NGROK_URL/webhook</code><br>
        <small style="color:#65676b">Nhập mã xác minh: <code>${getConfig().verifyToken || 'chưa thiết lập'}</code></small>
      </div>
    </body>
    </html>
  `);
});

// API to query orders (with optional pageId filter)
app.get("/orders", (req, res) => {
  if (!fs.existsSync(ORDERS_FILE)) return res.json([]);
  try {
    const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
    const { pageId } = req.query;
    if (pageId) {
      return res.json(orders.filter(o => o.pageId === pageId));
    }
    res.json(orders);
  } catch {
    res.json([]);
  }
});

// =============================================
//  START SERVER
// =============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🤖  NGUYENNAMCHAT WEBHOOK SERVER      ║
╠════════════════════════════════════════╣
║  ✅ Server đang chạy tại port ${PORT}     ║
║  🌐 Mở: http://localhost:${PORT}          ║
║                                        ║
║  📋 Tiếp theo: Chạy ngrok              ║
║  > ngrok http ${PORT}                     ║
╚════════════════════════════════════════╝
  `);

  const config = getConfig();
  if (!config.fbAppId) {
    console.warn("⚠️  CẢNH BÁO: Chưa cấu hình FB_APP_ID trên hệ thống.");
  }
  if (!config.groqApiKey) {
    console.warn("⚠️  CẢNH BÁO: Chưa cấu hình GROQ_API_KEY trên hệ thống.");
  }
});

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
const multer = require("multer");
const SCRIPT = require("./script");

const app = express();
app.set("trust proxy", true);
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
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT ? "/data" : __dirname;
const LEGACY_DATA_DIR = __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PAGES_FILE = path.join(DATA_DIR, "pages.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PLATFORM_USERS_FILE = path.join(DATA_DIR, "platform_users.json");
const CONVERSATION_LOCKS_FILE = path.join(DATA_DIR, "conversation_locks.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

function seedPersistentFile(fileName, fallbackValue) {
  const target = path.join(DATA_DIR, fileName);
  const legacy = path.join(LEGACY_DATA_DIR, fileName);
  if (fs.existsSync(target)) return;

  if (DATA_DIR !== LEGACY_DATA_DIR && fs.existsSync(legacy)) {
    try {
      fs.copyFileSync(legacy, target);
      return;
    } catch (_err) {}
  }

  fs.writeFileSync(target, JSON.stringify(fallbackValue, null, 2));
}

function seedUploadsDir() {
  if (DATA_DIR === LEGACY_DATA_DIR) return;
  const legacyUploads = path.join(LEGACY_DATA_DIR, "uploads");
  if (!fs.existsSync(legacyUploads)) return;
  const files = fs.readdirSync(legacyUploads);
  for (const file of files) {
    const from = path.join(legacyUploads, file);
    const to = path.join(UPLOADS_DIR, file);
    if (!fs.existsSync(to)) {
      try {
        fs.copyFileSync(from, to);
      } catch (_err) {}
    }
  }
}

seedPersistentFile("pages.json", {});
seedPersistentFile("orders.json", []);
seedPersistentFile("config.json", {});
seedPersistentFile("users.json", {});
seedPersistentFile("platform_users.json", {});
seedPersistentFile("conversation_locks.json", {});
seedUploadsDir();

// Chat History Cache per customer (sender_id)
const chatHistory = {};
const adsFlowStates = {};
const MAX_HISTORY = 6;

// API Key Cooldown Tracker: key → timestamp khi hết cooldown
// Khi key bị 429, nghỉ 60 giây rồi tự kích hoạt lại
const keyCooldowns = {};
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype || "")) {
      return cb(new Error("Chi ho tro anh JPG, PNG, GIF hoac WEBP."));
    }
    cb(null, true);
  }
});
const IMAGE_MARKER_RE = /(?:\[\s*(?:IMAGE|IMG|ANH|HINH|ẢNH|HÌNH)\s*:?\s*(https?:\/\/[^\]\s<>"')]+)\s*\]|(?:^|\s)(?:IMAGE|IMG|ANH|HINH|ẢNH|HÌNH)\s*:\s*(https?:\/\/[^\s<>"')\]]+))/giu;
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

function normalizeAIMode(value) {
  const mode = String(value || "observe").toLowerCase().trim();
  return mode === "auto" ? "auto" : "observe";
}

function isObserveMode(pageConfig = {}) {
  return normalizeAIMode(pageConfig.aiMode) === "observe";
}

const CONVERSATION_LOCK_PATTERNS = [
  /khong the tiep tuc cuoc tro chuyen nay/,
  /khong the tiep tuc hoi thoai nay/,
  /em xin loi vi khong the tiep tuc/,
  /toi xin loi vi khong the tiep tuc/,
  /khong the ho tro tiep cuoc tro chuyen nay/
];

function getConversationLocks() {
  if (!fs.existsSync(CONVERSATION_LOCKS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONVERSATION_LOCKS_FILE, "utf-8"));
  } catch (_err) {
    return {};
  }
}

function saveConversationLocks(locks) {
  fs.writeFileSync(CONVERSATION_LOCKS_FILE, JSON.stringify(locks, null, 2));
}

function getConversationLockKey(pageId, senderId) {
  return `${pageId}:${senderId}`;
}

function getConversationLock(pageId, senderId) {
  const locks = getConversationLocks();
  const lock = locks[getConversationLockKey(pageId, senderId)];
  return lock && lock.active !== false ? lock : null;
}

function shouldLockConversationAfterReply(replyText) {
  const text = normalizeText(replyText);
  return Boolean(text) && CONVERSATION_LOCK_PATTERNS.some(pattern => pattern.test(text));
}

function lockConversation(pageId, senderId, userText, botReply, reason = "refusal_reply") {
  const locks = getConversationLocks();
  const key = getConversationLockKey(pageId, senderId);
  const existing = locks[key] || {};
  locks[key] = {
    ...existing,
    active: true,
    pageId,
    senderId,
    reason,
    lockedAt: existing.lockedAt || new Date().toISOString(),
    lastLockedAt: new Date().toISOString(),
    lastUserText: String(userText || ""),
    lastBotReply: String(botReply || "")
  };
  saveConversationLocks(locks);
  console.warn(`Muted conversation ${key} after refusal-style reply.`);
}

function touchConversationLock(pageId, senderId, userText) {
  const locks = getConversationLocks();
  const key = getConversationLockKey(pageId, senderId);
  const existing = locks[key];
  if (!existing || existing.active === false) return;
  existing.lastIgnoredAt = new Date().toISOString();
  existing.lastIgnoredUserText = String(userText || "");
  existing.ignoredCount = (existing.ignoredCount || 0) + 1;
  saveConversationLocks(locks);
}

function clearConversationLocksForSender(senderId) {
  const locks = getConversationLocks();
  let changed = false;
  for (const key of Object.keys(locks)) {
    if (locks[key]?.senderId === senderId || key.endsWith(`:${senderId}`)) {
      delete locks[key];
      changed = true;
    }
  }
  if (changed) saveConversationLocks(locks);
}

function conversationHistoryHasLockReply(pageId, senderId) {
  const users = getUsers();
  const user = users[senderId];
  if (!user || user.pageId !== pageId || !Array.isArray(user.conversations)) return false;
  return user.conversations.some(item => shouldLockConversationAfterReply(item.bot));
}

function ensureConversationLocked(pageId, senderId, userText) {
  const existing = getConversationLock(pageId, senderId);
  if (existing) {
    touchConversationLock(pageId, senderId, userText);
    return existing;
  }

  if (conversationHistoryHasLockReply(pageId, senderId)) {
    lockConversation(pageId, senderId, userText, "", "historical_refusal_reply");
    touchConversationLock(pageId, senderId, userText);
    return getConversationLock(pageId, senderId);
  }

  return null;
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

function messageAsksDailyBudget(userText) {
  const text = normalizeText(userText);
  return /(gia ngay|goi ngay|chay theo ngay|200k\/ngay|200k ngay|200000\/ngay|200000 ngay|toi thieu 7 ngay|7 ngay)/.test(text);
}

function messageAsksPrice(userText) {
  const text = normalizeText(userText);
  return /(gia sao|bao gia|gia ca|bao nhieu|chi phi|ngan sach|muc gia|gia chay|gia qc|bao gia qc|gia ads|chay qc gia|gia chay qc)/.test(text);
}

function messageShowsBuyingIntent(userText) {
  const text = normalizeText(userText);
  return /(ok|duoc|quan tam|muon lam|muon chay|muon trien khai|tu van them|ib tu van|chot|lam di|trien khai di)/.test(text);
}

function extractPackageNumber(userText) {
  const text = normalizeText(userText);
  const match = text.match(/\b(goi)\s*([1-9]\d*)\b/);
  return match ? match[2] : "";
}

function userAlreadySharedAdsExperience(history) {
  const joined = (history || [])
    .filter(item => item.role === "user")
    .map(item => normalizeText(item.content))
    .join(" ");
  return /(chay roi|da chay|tung chay|roi|lan dau|chua chay|chua tung chay|chua bao gio chay)/.test(joined);
}

function getConversationSnapshot(history) {
  const userMessages = (history || []).filter(item => item.role === "user").map(item => item.content);
  const allUserText = userMessages.join(" ");
  const latestIndustry = [...userMessages].reverse().map(extractIndustry).find(Boolean) || "";
  const hasExperience = userAlreadySharedAdsExperience(history);
  const hasPriceQuestion = userMessages.some(message => messageAsksPrice(message));
  const hasDailyQuestion = userMessages.some(message => messageAsksDailyBudget(message));
  const hasBuyingIntent = userMessages.some(message => messageShowsBuyingIntent(message));
  return {
    latestIndustry,
    hasExperience,
    hasPriceQuestion,
    hasDailyQuestion,
    hasBuyingIntent,
    allUserText: normalizeText(allUserText)
  };
}

function getAdsFlowState(pageId, senderId) {
  const key = `${pageId}:${senderId}`;
  if (!adsFlowStates[key]) {
    adsFlowStates[key] = {
      industry: "",
      experience: "",
      priceSent: false
    };
  }
  return adsFlowStates[key];
}

function extractAdsExperience(userText) {
  const text = normalizeText(userText);
  if (/(lan dau|chua chay|chua tung chay|chua bao gio chay)/.test(text)) return "new";
  if (/(chay roi|da chay|tung chay|co chay roi|roi)/.test(text)) return "experienced";
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

function hasPackageDetailInScript(script, packageNumber) {
  if (!packageNumber) return false;
  const normalizedScript = normalizeText(script);
  return normalizedScript.includes(`goi ${packageNumber}:`) || normalizedScript.includes(`goi ${packageNumber} -`) || normalizedScript.includes(`goi ${packageNumber} `);
}

function hasFlowText(value) {
  return String(value || "").trim().length > 0;
}

function joinFlowText(...parts) {
  return parts.map(part => String(part || "").trim()).filter(Boolean).join(" ").trim();
}

function getAdsFlowsFromPageConfig(pageConfig = {}) {
  if (Array.isArray(pageConfig.adsFlows) && pageConfig.adsFlows.length) {
    return pageConfig.adsFlows;
  }
  return [];
}

function pickAdsFlow(userText, pageConfig = {}) {
  const text = normalizeText(userText);
  const flows = getAdsFlowsFromPageConfig(pageConfig);
  if (!flows.length) return null;

  const matched = flows.find(flow => {
    const keywords = String(flow.keywords || "")
      .split(",")
      .map(item => normalizeText(item))
      .filter(Boolean);
    return keywords.some(keyword => text.includes(keyword));
  });

  return matched || flows[0];
}

function buildAdsFlowReply(userText, script, pageConfig, pageId, senderId) {
  const profile = getTenantProfile(script, pageConfig);
  if (!profile.hasAdsPricing) return null;

  const state = getAdsFlowState(pageId, senderId);
  const selectedFlow = pickAdsFlow(userText, pageConfig);
  const flow = {
    greeting: "Dạ em chào anh/chị ạ, anh/chị đang cần bên em hỗ trợ gì ạ?",
    keywords: "chạy quảng cáo, chạy ads, quảng cáo facebook, báo giá quảng cáo, giá chạy qc",
    askIndustry: "Dạ anh/chị đang muốn chạy quảng cáo cho ngành nghề, sản phẩm hoặc dịch vụ gì ạ?",
    askExperience: "Dạ trước giờ anh/chị đã từng chạy quảng cáo Facebook chưa ạ, hay đây là lần đầu mình chạy?",
    sendPriceText: "Dạ em gửi anh/chị bảng giá tham khảo bên em ạ, anh/chị xem giúp em nhé.",
    dailyPriceText: "Dạ bên em nhận chạy tối thiểu 200.000đ/ngày và cần chạy ít nhất 7 ngày ạ.",
    afterPriceFollowup: "Dạ anh/chị đang muốn chạy cho ngành nghề, sản phẩm hoặc dịch vụ gì ạ?",
    zaloSoft: `Dạ anh/chị nhắn Zalo/Hotline ${profile.contact || "0898377771"} giúp em nhé, em tư vấn kỹ hơn và lên phương án phù hợp cho mình ạ.`,
    zaloPackage: `Dạ anh/chị nhắn Zalo/Hotline ${profile.contact || "0898377771"} giúp em nhé, em gửi chi tiết đúng gói này cho mình ạ.`,
    fallback: `Dạ anh/chị nhắn Zalo/Hotline ${profile.contact || "0898377771"} giúp em nhé, em tư vấn kỹ hơn cho mình ạ.`,
    sendPriceFirst: true,
    zaloOnlyAfterOk: true,
    ...(selectedFlow || pageConfig.adsFlow || {})
  };
  const text = normalizeText(userText);
  const industry = extractIndustry(userText);
  const experience = extractAdsExperience(userText);
  const packageNumber = extractPackageNumber(userText);
  const asksGenericPackage = /\b(goi|gói)\b/.test(text);
  const images = (flow.priceImage ? [flow.priceImage] : getScriptImages(script)).slice(0, 1);
  const dailyText = profile.dailyLine ? cleanPhrase(stripScriptLabel(profile.dailyLine)) : "tối thiểu 200.000đ/ngày và cần chạy ít nhất 7 ngày";

  if (industry && !state.industry) state.industry = industry;
  if (experience && !state.experience) state.experience = experience;

  if (/^(alo|hi|hello|chao|xin chao|shop oi|ban oi|ad oi|admin oi)$/.test(text) && !state.industry && !state.priceSent) {
    return { text: hasFlowText(flow.greeting) ? flow.greeting : flow.fallback, images: [] };
  }

  if (messageAsksDailyBudget(userText)) {
    return {
      text: joinFlowText(flow.dailyPriceText || `Dạ bên em nhận chạy ${dailyText} ạ.`, flow.afterPriceFollowup) || flow.fallback,
      images: []
    };
  }

  if (asksGenericPackage && !packageNumber) {
    return {
      text: flow.fallback,
      images: []
    };
  }

  if (packageNumber && !hasPackageDetailInScript(script, packageNumber)) {
    return {
      text: hasFlowText(flow.zaloPackage) ? flow.zaloPackage.replace("gói này", `gói ${packageNumber}`) : flow.fallback,
      images: []
    };
  }

  if (flow.sendPriceFirst && messageAsksPrice(userText) && !state.priceSent) {
    state.priceSent = true;
    if (state.industry && !state.experience) {
      return {
        text: joinFlowText(flow.sendPriceText, flow.askExperience) || flow.fallback,
        images
      };
    }
    if (state.industry && state.experience) {
      return {
        text: hasFlowText(flow.sendPriceText) ? flow.sendPriceText : flow.fallback,
        images
      };
    }
    return {
      text: joinFlowText(flow.sendPriceText, flow.afterPriceFollowup) || flow.fallback,
      images
    };
  }

  if (!state.industry) {
    if (!hasFlowText(flow.askIndustry)) {
      state.industry = "__skipped__";
    } else {
      return {
        text: flow.askIndustry,
        images: []
      };
    }
  }

  if (!state.experience) {
    if (!hasFlowText(flow.askExperience)) {
      state.experience = "__skipped__";
    } else {
      return {
        text: hasFlowText(flow.askIndustry) && state.industry && state.industry !== "__skipped__"
          ? `Dạ anh/chị đang kinh doanh ${state.industry} ạ. ${flow.askExperience}`
          : flow.askExperience,
        images: []
      };
    }
  }

  if (!state.priceSent) {
    state.priceSent = true;
    return {
      text: hasFlowText(flow.sendPriceText) ? flow.sendPriceText : flow.fallback,
      images
    };
  }

  if (flow.zaloOnlyAfterOk && messageShowsBuyingIntent(userText)) {
    return {
      text: hasFlowText(flow.zaloSoft) ? flow.zaloSoft : flow.fallback,
      images: []
    };
  }

  return {
    text: hasFlowText(flow.fallback) ? flow.fallback : `Dạ anh/chị nhắn Zalo/Hotline ${profile.contact || "0898377771"} giúp em nhé, em tư vấn kỹ hơn cho mình ạ.`,
    images: []
  };
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

  // Tất cả câu hỏi còn lại (giá, ngành hàng, tư vấn...) → AI xử lý theo kịch bản
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

function parseProviderApiKeys(value, aiProvider = "openrouter") {
  const provider = normalizeAIProvider(aiProvider);
  return parseGroqApiKeys(value).filter(key => {
    if (provider === "openrouter") return key.startsWith("sk-or-");
    return key.startsWith("gsk_");
  });
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
    groqApiKey: fileConfig.groqApiKey || "",
    groqModel: fileConfig.groqModel || "meta-llama/llama-3.1-8b-instruct",
    aiProvider: fileConfig.aiProvider || "openrouter"
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
  const existingFlows = Array.isArray(pages[pageId]?.adsFlows) ? pages[pageId].adsFlows : [];
  pages[pageId] = {
    id: pageId,
    name: pageName,
    token: pageToken || config.pageAccessToken || "", 
    script: script || SCRIPT, 
    model: pages[pageId]?.model || "meta-llama/llama-3.1-8b-instruct",
    aiProvider: pages[pageId]?.aiProvider || config.aiProvider || "openrouter",
    temperature: pages[pageId]?.temperature !== undefined ? pages[pageId].temperature : 0.7,
    apiKey: pages[pageId]?.apiKey || "",
    adsFlows: existingFlows,
    aiMode: normalizeAIMode(pages[pageId]?.aiMode),
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

app.post("/api/upload-image", imageUpload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "Chua co file anh." });
  }

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: imageUrl,
    marker: `[IMAGE: ${imageUrl}]`
  });
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

    // 3. Wipe conversation locks so a full reset starts clean.
    if (fs.existsSync(CONVERSATION_LOCKS_FILE)) {
      fs.writeFileSync(CONVERSATION_LOCKS_FILE, JSON.stringify({}, null, 2));
    }
    
    // 4. Reset config.json to empty state (keep only default placeholders)
    const defaultConfig = {
      fbAppId: "759513787182248", // Keep their real App ID so they don't lose it
      fbAppSecret: "",
      verifyToken: "mysecrettoken123",
      groqApiKey: "",
      groqModel: "meta-llama/llama-3.1-8b-instruct",
      aiProvider: "openrouter"
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    
    // 5. Update in-memory environment variables (fallback to original system variables if cleared)
    process.env.FB_APP_ID = defaultConfig.fbAppId || ORIGINAL_ENV.FB_APP_ID;
    process.env.FB_APP_SECRET = defaultConfig.fbAppSecret || ORIGINAL_ENV.FB_APP_SECRET;
    process.env.VERIFY_TOKEN = defaultConfig.verifyToken || ORIGINAL_ENV.VERIFY_TOKEN;
    process.env.GROQ_API_KEY = "";
    process.env.GROQ_MODEL = defaultConfig.groqModel;
    
    console.log("🚨 ĐÃ RESET TOÀN BỘ HỆ THỐNG VỀ MẶC ĐỊNH!");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API to update settings for a Fanpage
app.post("/api/update-settings", (req, res) => {
  const { pageId, shopName, model, temperature, apiKey, aiProvider, aiMode, adsFlows } = req.body;
  if (!pageId) {
    return res.status(400).json({ error: "Missing pageId parameter" });
  }

  const pages = getPages();
  if (!pages[pageId]) {
    // Create a minimal page config so settings can be saved before reconnecting the page.
    savePage(pageId, shopName || "Custom Page", "", "");
    pages[pageId] = getPages()[pageId];
  }

  if (shopName) pages[pageId].name = shopName;
  if (model) pages[pageId].model = model;
  if (aiProvider) pages[pageId].aiProvider = aiProvider;
  if (aiMode !== undefined) pages[pageId].aiMode = normalizeAIMode(aiMode);
  if (temperature !== undefined) pages[pageId].temperature = parseFloat(temperature);
  if (apiKey !== undefined) pages[pageId].apiKey = apiKey;
  if (Array.isArray(adsFlows)) pages[pageId].adsFlows = adsFlows;
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
  clearConversationLocksForSender(req.params.senderId);
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
    const pages = getPages();
    const pageConfig = pages[pageId] || {};
    if (isObserveMode(pageConfig)) {
      return res.json({ success: true, reply: "", images: [], observed: true });
    }

    if (ensureConversationLocked(pageId, mockSender, text)) {
      return res.json({ success: true, reply: "", images: [], muted: true });
    }

    const reply = await generateBotResponse(text, pageId, mockSender);
    const replyText = getReplyText(reply);
    if (shouldLockConversationAfterReply(replyText)) {
      lockConversation(pageId, mockSender, text, replyText);
    }
    res.json({ success: true, reply: replyText, images: getReplyImages(reply) });
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

      if (event.message?.is_echo) {
        const customerId = event.recipient?.id;
        if (customerId && customerId !== pageId) {
          const echoText = event.message.text || "[PAGE_ECHO]";
          lockConversation(pageId, customerId, echoText, "", "page_echo_human_reply");
          console.log(`Manual Page reply detected. Muted customer ${customerId} on Page ${pageId}.`);
        }
        continue;
      }

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
  let aiProvider = pageConfig.aiProvider || config.aiProvider || "openrouter";
  let model = pageConfig.model || config.groqModel || "meta-llama/llama-3.1-8b-instruct";
  let temperature = pageConfig.temperature !== undefined ? parseFloat(pageConfig.temperature) : 0.3;

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

  const hardFlowReply = buildAdsFlowReply(userText, script, pageConfig, pageId, senderId);
  if (hardFlowReply) {
    chatHistory[senderId].push({
      role: "assistant",
      content: hardFlowReply.text
    });
    return hardFlowReply;
  }

  let apiKeys = [];
  if (pageConfig.apiKey) {
    apiKeys.push(...parseProviderApiKeys(pageConfig.apiKey, aiProvider));
  }
  if (config.groqApiKey) {
    apiKeys.push(...parseProviderApiKeys(config.groqApiKey, aiProvider));
  }
  apiKeys = [...new Set(apiKeys)];

  // Luôn gọi AI cho mọi tin nhắn ngoài nhánh flow cứng
  if (apiKeys.length === 0) {
    throw new Error(`Chua cau hinh ${getProviderLabel(aiProvider)} API Key cho Page ID nay hoac he thong.`);
  }

  // Gọi AI — retry với tất cả key, nếu thất bại thì đợi 2s rồi thử lại 1 lần nữa
  try {
    const aiReply = await callGroqAIWithRetry(senderId, chatHistory[senderId], script, model, temperature, apiKeys, aiProvider);
    const parsedReply = parseBotReplyMedia(aiReply);
    chatHistory[senderId].push({
      role: "assistant",
      content: parsedReply.text || aiReply
    });
    return parsedReply;
  } catch (aiErr) {
    console.error("⚠️ Lần 1 thất bại, đợi 2s rồi thử lại...", aiErr.message);
    // Retry lần cuối sau 2 giây
    try {
      await sleep(2000);
      const aiReply2 = await callGroqAIWithRetry(senderId, chatHistory[senderId], script, model, temperature, apiKeys, aiProvider);
      const parsedReply2 = parseBotReplyMedia(aiReply2);
      chatHistory[senderId].push({
        role: "assistant",
        content: parsedReply2.text || aiReply2
      });
      return parsedReply2;
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
      return { text: fallbackMsg, images: [] };
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

    if (isObserveMode(pageConfig)) {
      const pageName = pageConfig.name || pageId;
      trackUser(senderId, pageId, pageName, userText, "[OBSERVE_ONLY] AI observed but did not reply.");
      console.log(`Observe mode: logged message from ${senderId} on Page ${pageId}; no AI reply sent.`);
      return;
    }

    if (ensureConversationLocked(pageId, senderId, userText)) {
      const pageName = pageConfig.name || pageId;
      trackUser(senderId, pageId, pageName, userText, "[BOT MUTED] Conversation locked after refusal reply.");
      console.log(`🔇 Bỏ qua tin nhắn từ khách ${senderId} vì cuộc trò chuyện đã bị khóa.`);
      return;
    }

    // Typing indicators must not block the actual reply flow.
    sendTyping(senderId, true, token).catch(err => {
      console.warn("⚠️ Không gửi được typing_on:", err.response?.data || err.message);
    });

    // Generate response using shared logic
    const reply = await generateBotResponse(userText, pageId, senderId);

    // Turn off typing indicator
    sendTyping(senderId, false, token).catch(err => {
      console.warn("⚠️ Không gửi được typing_off:", err.response?.data || err.message);
    });

    // Send messages back to user
    const replyText = getReplyText(reply);
    const replyImages = getReplyImages(reply);
    const parts = splitMessage(replyText, 2000);
    for (const part of parts) {
      await sendTextMessage(senderId, part, token);
      console.log(`💬 Đã gửi tin nhắn chữ cho khách ${senderId}`);
      if (parts.length > 1) await sleep(500);
    }

    if (replyImages.length) {
      for (const imageUrl of replyImages) {
        await sendImageMessage(senderId, imageUrl, token);
        console.log(`🖼️ Đã gửi ảnh cho khách ${senderId}: ${imageUrl}`);
        await sleep(400);
      }
    }

    // Auto-detect and save order
    if (isOrderConfirmed(replyText)) {
      saveOrder(senderId, userText, replyText, pageId);
    }

    if (shouldLockConversationAfterReply(replyText)) {
      lockConversation(pageId, senderId, userText, replyText);
    }

    // Track user conversation
    const pageName = pageConfig.name || pageId;
    trackUser(senderId, pageId, pageName, userText, formatReplyForHistory(reply));

  } catch (err) {
    console.error("❌ Lỗi xử lý tin nhắn:", err.message);
  }
}

// =============================================
//  AI CORE COMPLETION & RETRY HELPER (MULTI-KEY ROTATION + COOLDOWN)
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

async function callGroqAIWithRetry(senderId, history, script, model, temperature, apiKeys, aiProvider = "openrouter", retries = 2, delay = 1000) {
  const allKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  
  if (allKeys.length === 0) {
    throw new Error(`Khong co ${getProviderLabel(aiProvider)} API Key nao duoc cau hinh!`);
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
        console.log(`🤖 [Key ${i + 1}/${sortedKeys.length}] Gọi ${getProviderLabel(aiProvider)} AI với key: ${maskedKey}${isCooling ? ' (đang cooldown, thử lại)' : ''}`);
        const result = await callGroqAI(senderId, history, script, model, temperature, key, aiProvider);
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

async function callGroqAI(senderId, history, script, model, temperature, apiKey, aiProvider = "openrouter") {
  const provider = normalizeAIProvider(aiProvider);
  const apiUrl = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nguyennamchat-production.up.railway.app";
    headers["X-Title"] = "NGUYENNAMADS Chatbot";
  }

  const response = await axios.post(
    apiUrl,
    {
      model: model,
      messages: [
        {
          role: "system",
          content: buildSystemPromptWithImageRules(script)
        },
        ...history
      ],
      max_tokens: 500,
      temperature: temperature
    },
    {
      headers,
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

async function sendImageMessage(recipientId, imageUrl, token) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: imageUrl,
            is_reusable: true
          }
        }
      },
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
      params: { access_token: token },
      timeout: 3000
    }
  );
}

// =============================================
//  UTILITY FUNCTIONS
// =============================================
function splitMessage(text, maxLen) {
  text = String(text || "").trim();
  if (!text) return [];
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

function normalizeAIProvider(value) {
  return String(value || "openrouter").toLowerCase() === "groq" ? "groq" : "openrouter";
}

function getScriptImages(script) {
  return parseBotReplyMedia(String(script || "")).images;
}

function getProviderLabel(value) {
  return normalizeAIProvider(value) === "openrouter" ? "OpenRouter" : "Groq";
}

function buildSystemPromptWithImageRules(script) {
  return `${script}

SCRIPT PRIORITY RULES:
- Follow the script very closely. At least 80% of the reply behavior must come from the script, not from improvisation.
- Do not jump ahead in the flow. If the script says ask industry first, then ask industry first.
- Do not answer with "giá ngày", "200.000đ/ngày", "tối thiểu 7 ngày" unless the customer explicitly asks about daily pricing, daily budget, or running by day.
- If the customer only asks a general price question such as "giá sao", "báo giá", or "bao nhiêu", and the script requires collecting more information first, ask the required follow-up question instead of quoting detailed pricing.
- After sending a price image, do not invite the customer to Zalo immediately unless the customer has shown clear interest such as ok, muốn làm, muốn triển khai, chốt, tư vấn thêm.

IMAGE REPLY RULES:
- You control when images are sent. The app sends an image only when your reply includes an image marker.
- If the script contains a public image URL that is relevant to the customer's question, you MUST include that exact URL as a marker after your text: [IMAGE: https://example.com/image.jpg].
- If the customer asks about price, price list, product/service details, examples, samples, design, menu, catalog, course information, or asks to see an image, and the script has a relevant image URL, do not omit the image marker.
- Only use image URLs that are already present in the script or conversation. Do not invent image URLs.
- Use at most 3 image markers in one reply.
- The image URL must be public https/http so Facebook Messenger can fetch it.
- Do not mention the marker syntax to customers.`;
}

function parseBotReplyMedia(reply) {
  const raw = String(reply || "");
  const images = [];
  const text = raw.replace(IMAGE_MARKER_RE, (_match, bracketUrl, plainUrl) => {
    const url = bracketUrl || plainUrl;
    if (isPublicImageUrl(url) && !images.includes(url)) images.push(url);
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();

  return {
    text,
    images: images.slice(0, 3)
  };
}

function isPublicImageUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return ["http:", "https:"].includes(parsed.protocol);
  } catch (_err) {
    return false;
  }
}

function getReplyText(reply) {
  if (typeof reply === "string") return parseBotReplyMedia(reply).text;
  return String(reply?.text || "").trim();
}

function getReplyImages(reply) {
  if (typeof reply === "string") return parseBotReplyMedia(reply).images;
  return Array.isArray(reply?.images) ? reply.images.filter(isPublicImageUrl).slice(0, 3) : [];
}

function buildTemplateSummary(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = "Anh/chị xem thông tin gói giúp em. Nếu phù hợp, mình nhắn Zalo 0898377771 để bên em tư vấn chi tiết hơn ạ.";
  const summary = clean || fallback;
  return summary.length > 80 ? `${summary.slice(0, 77).trim()}...` : summary;
}

function formatReplyForHistory(reply) {
  const text = getReplyText(reply);
  const images = getReplyImages(reply);
  return [text, ...images.map(url => `[IMAGE: ${url}]`)].filter(Boolean).join("\n");
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

const fs = require("fs");

function replaceFile(path, replacements) {
  let text = fs.readFileSync(path, "utf8");
  for (const [bad, good] of replacements) {
    text = text.split(bad).join(good);
  }
  fs.writeFileSync(path, text, "utf8");
}

replaceFile("dashboard.html", [
  ['          <option value="groq">Groq</option>\n', ""],
  ['          <textarea id="grok-key" rows="3" placeholder="Groq: gsk_...&#10;OpenRouter: sk-or-..."></textarea>', '          <textarea id="grok-key" rows="3" placeholder="OpenRouter: sk-or-..."></textarea>'],
  ['        <a href="https://console.groq.com" target="_blank" class="get-key-link" style="margin-top:4px;display:inline-block">Groq keys</a><a href="https://openrouter.ai/keys" target="_blank" class="get-key-link" style="margin-top:4px;margin-left:10px;display:inline-block">OpenRouter keys</a>', '        <a href="https://openrouter.ai/keys" target="_blank" class="get-key-link" style="margin-top:4px;display:inline-block">OpenRouter keys</a>'],
  ['          <option value="llama-3.3-70b-versatile">Llama 3.3 70B Ã¢Å¡Â¡ (Nhanh, thÃ´ng minh)</option>\n', ""],
  ['          <option value="llama-3.1-8b-instant">Llama 3.1 8B ðŸš€ (SiÃªu nhanh)</option>\n', ""],
  ['          <option value="llama-3.3-70b-versatile">Llama 3.3 70B ⚡ (Nhanh, thông minh)</option>\n', ""],
  ['          <option value="llama-3.1-8b-instant">Llama 3.1 8B 🚀 (Siêu nhanh)</option>\n', ""]
]);

replaceFile("app.js", [
  ["const aiProviderVal = document.getElementById('ai-provider-select')?.value || 'groq';", "const aiProviderVal = 'openrouter';"],
  ["const modelVal = document.getElementById('model-select')?.value || (aiProviderVal === 'openrouter' ? 'meta-llama/llama-3.1-8b-instruct' : 'llama-3.3-70b-versatile');", "const modelVal = document.getElementById('model-select')?.value || 'meta-llama/llama-3.1-8b-instruct';"],
  ['status.textContent = "✅ Đã lưu! Bot sẽ dùng Groq AI cho câu hỏi ngoài kịch bản.";','status.textContent = "✅ Đã lưu! Bot sẽ dùng OpenRouter AI cho câu hỏi ngoài kịch bản.";'],
  ["const pageProvider = serverPage.aiProvider || localStorage.getItem('ai_provider') || 'groq';", "const pageProvider = 'openrouter';"],
  ["document.getElementById('model-select').value = serverPage.model || (pageProvider === 'openrouter' ? 'meta-llama/llama-3.1-8b-instruct' : 'llama-3.3-70b-versatile');", "document.getElementById('model-select').value = serverPage.model || 'meta-llama/llama-3.1-8b-instruct';"],
  ["const aiProviderVal = document.getElementById('ai-provider-select')?.value || 'groq';", "const aiProviderVal = 'openrouter';"],
  ["const provider = document.getElementById('ai-provider-select')?.value || 'groq';", "const provider = 'openrouter';"],
  ["  if (provider === 'groq' && modelSelect && modelSelect.value.includes('/')) {\n    modelSelect.value = 'llama-3.1-8b-instant';\n  }\n", ""],
  ["localStorage.setItem('ai_provider', aiProviderVal);", "localStorage.setItem('ai_provider', 'openrouter');"],
  ["localStorage.setItem('ai_provider', provider);", "localStorage.setItem('ai_provider', 'openrouter');"]
]);

replaceFile("server.js", [
  ["GROQ_API_KEY: process.env.GROQ_API_KEY,\n  GROQ_MODEL: process.env.GROQ_MODEL", "GROQ_API_KEY: \"\",\n  GROQ_MODEL: \"\""],
  ['groqApiKey: process.env.GROQ_API_KEY || fileConfig.groqApiKey || ORIGINAL_ENV.GROQ_API_KEY || ""', 'groqApiKey: fileConfig.groqApiKey || ""'],
  ['groqModel: process.env.GROQ_MODEL || fileConfig.groqModel || ORIGINAL_ENV.GROQ_MODEL || "llama-3.3-70b-versatile"', 'groqModel: fileConfig.groqModel || "meta-llama/llama-3.1-8b-instruct"'],
  ['process.env.GROQ_API_KEY = defaultConfig.groqApiKey || ORIGINAL_ENV.GROQ_API_KEY;', 'process.env.GROQ_API_KEY = "";'],
  ['process.env.GROQ_MODEL = defaultConfig.groqModel || ORIGINAL_ENV.GROQ_MODEL;', 'process.env.GROQ_MODEL = defaultConfig.groqModel;'],
  ['if (!config.groqApiKey) {\n    console.warn("⚠️  CẢNH BÁO: Chưa cấu hình GROQ_API_KEY trên hệ thống.");\n  }', '']
]);

const configPath = "config.json";
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
config.groqApiKey = "";
config.groqModel = "meta-llama/llama-3.1-8b-instruct";
config.aiProvider = "openrouter";
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

console.log("Đã chuyển tool sang OpenRouter-only và bỏ Groq khỏi UI/default.");

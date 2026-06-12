const fs = require("fs");

function replaceBetween(text, startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Không tìm thấy vùng cần thay: ${startMarker} -> ${endMarker}`);
  }
  return text.slice(0, start) + replacement + "\n\n    " + text.slice(end);
}

const scriptTabHtml = `<!-- TAB: Script -->
    <div class="tab-content active" id="content-script">
      <div class="script-header">
        <p class="script-desc">Tạo nhiều kịch bản con cho cùng một Fanpage. Mỗi mục có từ khóa, nội dung và ảnh riêng; tool sẽ tự ghép thành kịch bản tổng cho AI.</p>
        <div class="script-actions">
          <button class="btn-outline" onclick="addScriptSection()">+ Thêm kịch bản</button>
          <button class="btn-outline" onclick="loadSample()">Nạp mẫu</button>
          <button class="btn-outline" onclick="clearScript()">Xóa</button>
        </div>
      </div>

      <textarea id="script-input" class="script-textarea" style="display:none" spellcheck="false"></textarea>

      <div id="script-section-list" class="script-section-list"></div>

      <button class="btn-apply" onclick="applyScript()">Áp dụng kịch bản</button>
      <div id="apply-status"></div>
    </div>`;

let html = fs.readFileSync("dashboard.html", "utf8");
html = replaceBetween(
  html,
  '<!-- TAB: Script -->',
  '<!-- TAB: Settings -->',
  scriptTabHtml
);
fs.writeFileSync("dashboard.html", html, "utf8");

const dynamicJs = `

// =============================================
//  DYNAMIC SCRIPT SECTIONS
// =============================================
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
    id: data.id || \`section-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
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

  list.innerHTML = scriptSections.map((section, index) => \`
    <div class="settings-group script-service-card" data-section-id="\${escAttr(section.id)}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
        <label class="settings-label">Kịch bản \${index + 1}</label>
        <button class="btn-outline" type="button" onclick="removeScriptSection('\${escAttr(section.id)}')" style="padding:6px 10px">Xóa mục</button>
      </div>
      <input class="settings-input" value="\${escAttr(section.title)}" placeholder="Tên kịch bản, ví dụ: Chạy quảng cáo thuê Fanpage" oninput="updateScriptSection('\${escAttr(section.id)}', 'title', this.value)" />
      <input class="settings-input" value="\${escAttr(section.keywords)}" placeholder="Từ khóa nhận diện, ví dụ: chạy ads, fanpage, báo giá" oninput="updateScriptSection('\${escAttr(section.id)}', 'keywords', this.value)" />
      <textarea class="script-textarea" rows="7" placeholder="Nội dung tư vấn riêng cho mục này..." oninput="updateScriptSection('\${escAttr(section.id)}', 'content', this.value)">\${escHtml(section.content)}</textarea>
      <input class="settings-input" value="\${escAttr(section.imageUrl)}" placeholder="Link ảnh/bảng giá riêng của mục này" oninput="updateScriptSection('\${escAttr(section.id)}', 'imageUrl', this.value)" />
      <input type="file" id="script-image-file-\${escAttr(section.id)}" accept="image/*" style="display:none" onchange="uploadScriptImage(this, '\${escAttr(section.id)}')" />
      <button class="btn-outline" type="button" onclick="document.getElementById('script-image-file-\${escAttr(section.id)}').click()">Tải ảnh mục này</button>
      <div id="image-upload-status-\${escAttr(section.id)}" class="image-upload-status"></div>
    </div>
  \`).join("");
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

function fillDefaultScriptSections() {
  scriptSections = DEFAULT_SCRIPT_SECTIONS.map(createScriptSection);
  renderScriptSections();
  return buildScriptFromSections();
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
    "- Khi gửi bảng giá hoặc thông tin gói, phải kèm đúng ảnh của mục đó.",
    "- Sau khi gửi bảng giá hoặc khách muốn chốt, phải mời khách qua Zalo 0898377771.",
    "- Không tự bịa giá, cam kết, chính sách.",
    ""
  ];

  scriptSections.forEach((section, index) => {
    if (!section.title && !section.keywords && !section.content && !section.imageUrl) return;
    parts.push(\`## MỤC \${index + 1}: \${section.title || "Chưa đặt tên"}\`);
    if (section.keywords) parts.push(\`Từ khóa nhận diện: \${section.keywords}\`);
    if (section.content) parts.push(section.content);
    if (section.imageUrl) {
      parts.push("Ảnh/bảng giá của mục này:");
      parts.push(\`[IMAGE: \${section.imageUrl}]\`);
    }
    parts.push("");
  });

  const script = parts.join("\\n").trim();
  const hidden = document.getElementById("script-input");
  if (hidden) hidden.value = script;
  return script;
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

  const sectionRe = /## MỤC \\d+:\\s*(.+?)\\n([\\s\\S]*?)(?=\\n## MỤC \\d+:|$)/g;
  let match;
  while ((match = sectionRe.exec(raw))) {
    const title = match[1].trim();
    const chunk = match[2].trim();
    const keywordMatch = chunk.match(/^Từ khóa nhận diện:\\s*(.+)$/m);
    const imageMatch = chunk.match(/\\[IMAGE:\\s*(https?:\\/\\/[^\\]\\s]+)\\s*\\]/i);
    let content = chunk
      .replace(/^Từ khóa nhận diện:\\s*.+$/m, "")
      .replace(/Ảnh\\/bảng giá của mục này:\\s*/i, "")
      .replace(/\\[IMAGE:\\s*https?:\\/\\/[^\\]\\s]+\\s*\\]/i, "")
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
`;

let app = fs.readFileSync("app.js", "utf8");
if (!app.includes("DYNAMIC SCRIPT SECTIONS")) {
  const marker = "function loadSample() {";
  const idx = app.indexOf(marker);
  if (idx === -1) throw new Error("Không tìm thấy function loadSample trong app.js");
  app = app.slice(0, idx) + dynamicJs + "\n" + app.slice(idx);
}

app = app.replace(
  /function loadSample\(\) \{[\s\S]*?function clearScript\(\) \{\s*document\.getElementById\('script-input'\)\.value = '';\s*\}/,
  `function loadSample() {
  const script = fillDefaultScriptSections();
  localStorage.setItem('chatbot_script', script);
  if (activePageId) {
    applyScript();
  }
}

function clearScript() {
  clearScriptSections();
}`
);

app = app.replace(
  /async function uploadScriptImage\(input\) \{[\s\S]*?\n\}/,
  `async function uploadScriptImage(input, sectionId = '') {
  const file = input.files && input.files[0];
  const status = document.getElementById(sectionId ? \`image-upload-status-\${sectionId}\` : 'image-upload-status');
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    if (status) status.innerHTML = '<span style="color:#ff8080">Vui lòng chọn file ảnh.</span>';
    input.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    if (status) status.innerHTML = '<span style="color:#ff8080">Ảnh tối đa 5MB.</span>';
    input.value = '';
    return;
  }

  const form = new FormData();
  form.append('image', file);

  if (status) status.innerHTML = '<span style="color:#ffd700">Đang tải ảnh lên...</span>';

  try {
    const resp = await fetch(\`\${SERVER_URL}/api/upload-image\`, {
      method: 'POST',
      body: form
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'Không thể tải ảnh lên.');
    }

    if (sectionId) {
      updateScriptSection(sectionId, 'imageUrl', data.url);
      renderScriptSections();
      buildScriptFromSections();
    } else {
      insertTextIntoScript(\`\\nAnh: \${data.marker}\\n\`);
    }
    if (status) {
      status.innerHTML = \`
        <div class="upload-preview">
          <img src="\${escAttr(data.url)}" alt="Uploaded image" />
          <span>Đã tải ảnh lên cho mục này.</span>
        </div>\`;
    }
  } catch (err) {
    if (status) status.innerHTML = \`<span style="color:#ff8080">Lỗi tải ảnh: \${escHtml(err.message)}</span>\`;
  } finally {
    input.value = '';
  }
}`
);

app = app.replace(
  "document.getElementById('script-input').value = serverPage.script;\n        localStorage.setItem('chatbot_script', serverPage.script);",
  "document.getElementById('script-input').value = serverPage.script;\n        loadScriptSectionsFromScript(serverPage.script);\n        localStorage.setItem('chatbot_script', serverPage.script);"
);

app = app.replace(
  "document.getElementById('script-input').value = '';\n        document.getElementById('script-status-bar').style.display = 'block';",
  "document.getElementById('script-input').value = '';\n        clearScriptSections();\n        document.getElementById('script-status-bar').style.display = 'block';"
);

app = app.replace(
  "const scriptVal = document.getElementById('script-input').value.trim();",
  "const scriptVal = buildScriptFromSections().trim();"
);

fs.writeFileSync("app.js", app, "utf8");

console.log("Đã thêm UI kịch bản động và logic ghép kịch bản con.");

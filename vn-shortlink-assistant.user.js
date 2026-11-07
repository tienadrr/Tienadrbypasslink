// ==UserScript==
// @name         VN Shortlink Assistant — Manual Bypass
// @namespace    https://github.com/yourname/vn-shortlink-assistant
// @updateURL    https://raw.githubusercontent.com/tienadrr/Tienadrbypasslink/main/vn-shortlink-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/tienadrr/Tienadrbypasslink/main/vn-shortlink-assistant.user.js
// @version      6.0.0
// @description  Trợ lý phân tích shortlink thủ công, không tự chuyển hướng; menu gộp Bypass + Link đích, xem trước hiệu ứng.
// @author       You
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_openInTab
// ==/UserScript==

(() => {
  'use strict';

  // Chạy trên mọi trang để có thể phân tích shortlink; chỉ hiện nút nổi khi người dùng bật.
  const APP = 'vn-shortlink-assistant';
  const VERSION = '6.0.0';
  const STORE = `${APP}:settings`;
  const DEFAULTS = {
    enabled: true,
    theme: 'midnight',
    accent: '#8b5cf6',
    animation: 'slideUp',
    autoScan: true,
    showFloatingButton: true,
    compact: false,
    siteEnabled: {},
    customHosts: '',
    destination: '',
    logs: true
  };

  const THEMES = {
    midnight: { bg: '#111827', panel: '#182235', text: '#eef2ff', muted: '#9caec8', border: '#334155' },
    ocean:    { bg: '#071b2b', panel: '#0d2b40', text: '#e6f7ff', muted: '#9bc4d8', border: '#24516b' },
    light:    { bg: '#f8fafc', panel: '#ffffff', text: '#172033', muted: '#64748b', border: '#dbe3ee' },
    rose:     { bg: '#24131f', panel: '#351b2d', text: '#fff0f6', muted: '#e6a9c2', border: '#66334f' },
    forest:   { bg: '#102019', panel: '#1b3025', text: '#ecfdf3', muted: '#a7c8b3', border: '#365744' }
  };

  const EFFECTS = {
    slideUp: 'Trượt lên',
    fade: 'Mờ dần',
    slideLeft: 'Trượt từ trái',
    slideRight: 'Trượt từ phải',
    zoom: 'Thu phóng',
    bounce: 'Nảy',
    flip: 'Lật',
    glitch: 'Glitch'
  };

  const SITE_HINTS = [
    { id: 'link4sub', label: 'Link4Sub', tokens: ['link4sub'] },
    { id: 'sitetop', label: 'SiteTop', tokens: ['sitetop'] },
    { id: 'lentop', label: 'LenTop', tokens: ['lentop'] },
    { id: 'linkfree', label: 'LinkFree', tokens: ['linkfree'] },
    { id: 'tapvietcode', label: 'TapVietCode', tokens: ['tapvietcode'] }
  ];

  const state = {
    settings: loadSettings(),
    open: false,
    tab: 'home',
    busy: false,
    destination: '',
    candidates: [],
    logs: [],
    previewTimer: 0
  };

  function loadSettings() {
    try {
      let raw = typeof GM_getValue === 'function' ? GM_getValue(STORE, null) : null;
      if (!raw) { try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {} }
      return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STORE, state.settings);
      else localStorage.setItem(STORE, JSON.stringify(state.settings));
      toast('Đã lưu cài đặt');
    } catch (e) { log(`Không lưu được cài đặt: ${e.message}`, 'error'); }
  }

  function log(message, type = 'info') {
    const item = { time: new Date().toLocaleTimeString(), message: String(message), type };
    state.logs.unshift(item);
    state.logs = state.logs.slice(0, 100);
    if (state.settings.logs) console.info(`[${APP}] ${message}`);
    if (state.open) render();
  }

  function toast(message) {
    const el = root?.querySelector('.vsa-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function safeURL(value, base = location.href) {
    if (!value || typeof value !== 'string') return '';
    let candidate = value.trim();
    if (!candidate || candidate.startsWith('#') || /^(javascript|data|vbscript):/i.test(candidate)) return '';
    try {
      const u = new URL(candidate, base);
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      if (u.username || u.password) return '';
      return u.href;
    } catch { return ''; }
  }

  function decodeCandidate(value) {
    let current = String(value || '').trim();
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(current.replace(/\+/g, '%20'));
        if (decoded === current) break;
        current = decoded;
      } catch { break; }
    }
    const base64 = current.match(/(?:^|[?&])(?:url|u|target|dest|destination|redirect|r|link|to)=([^&]+)/i);
    if (base64) current = base64[1];
    try {
      if (/^[A-Za-z0-9+/_=-]{24,}$/.test(current) && !/^https?:/i.test(current)) {
        const normalized = current.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
        if (/https?:\/\//i.test(decoded)) current = decoded;
      }
    } catch { /* Không phải base64 hợp lệ */ }
    const match = current.match(/https?:\/\/[^\s"'<>\\]+/i);
    return safeURL(match ? match[0].replace(/[),.;\]}]+$/, '') : current);
  }

  function isCurrentSiteEnabled() {
    const host = location.hostname.toLowerCase();
    const matched = SITE_HINTS.find(site => site.tokens.some(token => host.includes(token)));
    if (matched && state.settings.siteEnabled[matched.id] === false) return false;
    const custom = String(state.settings.customHosts || '').split(/[\n,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    if (custom.length && !custom.some(x => host === x || host.endsWith(`.${x}`))) return false;
    return true;
  }

  function collectCandidates() {
    const found = new Map();
    const add = (raw, source) => {
      const url = decodeCandidate(raw);
      if (!url || url === location.href) return;
      try {
        const parsed = new URL(url);
        if (parsed.hostname === location.hostname && parsed.pathname === location.pathname) return;
      } catch { return; }
      if (!found.has(url)) found.set(url, { url, source });
    };

    // Chỉ đọc DOM; không tự bấm nút, submit form hoặc kích hoạt điều hướng.
    document.querySelectorAll('a[href], area[href]').forEach(a => {
      add(a.getAttribute('href'), 'Liên kết trên trang');
      ['data-url', 'data-href', 'data-target', 'data-link', 'data-redirect', 'data-destination'].forEach(attr => {
        if (a.hasAttribute(attr)) add(a.getAttribute(attr), `Thuộc tính ${attr}`);
      });
    });

    document.querySelectorAll('input[type="hidden"], [data-url], [data-href], [data-target], [data-link], [data-redirect], [data-destination]').forEach(el => {
      ['value', 'data-url', 'data-href', 'data-target', 'data-link', 'data-redirect', 'data-destination'].forEach(attr => {
        const val = attr === 'value' ? el.value : el.getAttribute(attr);
        if (val) add(val, `Dữ liệu ${attr}`);
      });
    });

    const text = document.documentElement?.innerHTML || '';
    const patterns = [
      /(?:url|target|destination|redirect|dest|link)\s*[:=]\s*["'](https?:\/\/[^"'<> ]+)["']/gi,
      /https?:\\?\/\\?\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>\\]*)?/gi
    ];
    patterns.forEach(pattern => {
      let match, count = 0;
      while ((match = pattern.exec(text)) && count++ < 80) add(match[1] || match[0].replace(/\\\//g, '/'), 'Dữ liệu nhúng trong trang');
    });

    return [...found.values()].slice(0, 60);
  }

  function runScan() {
    if (state.busy) return;
    state.busy = true;
    log('Đang quét các URL có thể là link đích…');
    try {
      state.candidates = collectCandidates();
      const preferred = state.candidates.find(x => !isSameOrigin(x.url)) || state.candidates[0];
      if (preferred) {
        state.destination = preferred.url;
        state.settings.destination = preferred.url;
        log(`Tìm thấy ${state.candidates.length} URL ứng viên. Đã chọn URL phù hợp nhất.`);
      } else {
        state.destination = '';
        log('Chưa tìm thấy URL đích rõ ràng. Có thể trang yêu cầu xử lý riêng.');
      }
    } catch (e) { log(`Quét gặp lỗi: ${e.message}`, 'error'); }
    state.busy = false;
    render();
  }

  function isSameOrigin(url) {
    try { return new URL(url).origin === location.origin; } catch { return true; }
  }

  function setDestination(value) {
    const url = safeURL(value);
    if (!url) { toast('URL không hợp lệ hoặc không an toàn'); return; }
    state.destination = url;
    state.settings.destination = url;
    saveSettings();
    render();
  }

  function openDestination() {
    const url = safeURL(state.destination);
    if (!url) return toast('Chưa có link đích hợp lệ');
    // Chỉ mở khi người dùng bấm nút này.
    try {
      if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true, insert: true });
      else window.open(url, '_blank', 'noopener,noreferrer');
      log('Đã yêu cầu mở link đích theo thao tác của bạn.');
    } catch (e) { log(`Không mở được link: ${e.message}`, 'error'); }
  }

  function copyDestination() {
    const url = safeURL(state.destination);
    if (!url) return toast('Chưa có link đích');
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(url);
      else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('textarea');
        input.value = url; document.body.appendChild(input); input.select();
        document.execCommand('copy'); input.remove();
      }
      toast('Đã sao chép link');
    } catch { toast('Không thể sao chép trên trình duyệt này'); }
  }

  const host = document.createElement('div');
  host.id = `${APP}-host`;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const root = shadow;

  const css = `
    :host{all:initial;color-scheme:dark}
    *{box-sizing:border-box}
    .vsa-fab{position:fixed;z-index:2147483646;right:18px;bottom:18px;width:54px;height:54px;border:0;border-radius:18px;background:var(--accent);color:white;font:800 18px system-ui;box-shadow:0 10px 35px #0006;cursor:pointer}
    .vsa-panel{position:fixed;z-index:2147483647;right:18px;bottom:82px;width:min(430px,calc(100vw - 24px));max-height:min(82dvh,760px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border);border-radius:22px;background:var(--panel);color:var(--text);box-shadow:0 24px 80px #0009;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
    .vsa-panel[data-theme="light"]{color-scheme:light}
    .vsa-head{padding:15px 16px 12px;background:linear-gradient(135deg,var(--panel),color-mix(in srgb,var(--accent) 17%,var(--panel)));border-bottom:1px solid var(--border)}
    .vsa-headrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .vsa-brand{display:flex;align-items:center;gap:10px;font-weight:850;font-size:15px}
    .vsa-logo{width:35px;height:35px;display:grid;place-items:center;border-radius:12px;background:var(--accent);color:#fff;font-size:18px}
    .vsa-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .vsa-iconbtn{border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;padding:7px 10px;cursor:pointer}
    .vsa-tabs{display:flex;gap:5px;padding:9px 12px;border-bottom:1px solid var(--border);overflow:auto}
    .vsa-tab{white-space:nowrap;border:0;border-radius:10px;padding:8px 11px;background:transparent;color:var(--muted);font:700 12px system-ui;cursor:pointer}
    .vsa-tab.active{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--text)}
    .vsa-body{overflow:auto;padding:14px;overscroll-behavior:contain}
    .vsa-card{border:1px solid var(--border);border-radius:15px;padding:12px;margin-bottom:11px;background:color-mix(in srgb,var(--bg) 52%,transparent)}
    .vsa-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .vsa-title{font-size:13px;font-weight:800;margin:0 0 7px}
    .vsa-muted{color:var(--muted);font-size:12px}
    .vsa-btn{border:0;border-radius:11px;padding:10px 13px;background:var(--accent);color:#fff;font:750 12px system-ui;cursor:pointer}
    .vsa-btn.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
    .vsa-btn:disabled{opacity:.45;cursor:not-allowed}
    .vsa-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .vsa-url{display:block;width:100%;min-height:66px;max-height:115px;overflow:auto;overflow-wrap:anywhere;border:1px solid var(--border);border-radius:11px;background:var(--bg);color:var(--text);padding:10px;font:11px/1.45 ui-monospace,monospace}
    .vsa-input,.vsa-select{width:100%;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);padding:9px;font:12px system-ui;outline:none}
    .vsa-label{display:block;font-size:12px;font-weight:700;margin:10px 0 5px}
    .vsa-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12px}
    .vsa-switch input{accent-color:var(--accent);width:17px;height:17px}
    .vsa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
    .vsa-effect{border:1px solid var(--border);border-radius:12px;padding:8px;background:var(--bg);color:var(--text);cursor:pointer;text-align:left}
    .vsa-effect.selected{outline:2px solid var(--accent);border-color:var(--accent)}
    .vsa-thumb{height:62px;border-radius:8px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 45%,var(--bg)),var(--panel));display:grid;place-items:center;margin-bottom:6px;overflow:hidden}
    .vsa-mini{width:45px;height:32px;border-radius:7px;background:var(--accent);box-shadow:0 4px 12px #0005;animation:miniFloat 2s ease-in-out infinite alternate}
    @keyframes miniFloat{to{transform:translateY(-5px) scale(.94)}}
    .vsa-preview{height:120px;border:1px dashed var(--border);border-radius:13px;background:var(--bg);display:grid;place-items:center;overflow:hidden;margin:9px 0}
    .vsa-preview-card{width:70%;padding:14px;border-radius:12px;background:var(--panel);border:1px solid var(--border);box-shadow:0 8px 25px #0003;text-align:center;font-weight:800}
    .vsa-preview.play .vsa-preview-card{animation:preview-${'none'} .7s ease both}
    .vsa-log{padding:8px 0;border-bottom:1px solid var(--border);font-size:11px;overflow-wrap:anywhere}
    .vsa-log.error{color:#fb7185}.vsa-log.info{color:var(--muted)}
    .vsa-footer{padding:9px 14px;border-top:1px solid var(--border);color:var(--muted);font-size:10px;display:flex;justify-content:space-between}
    .vsa-toast{position:absolute;left:50%;bottom:48px;transform:translate(-50%,12px);opacity:0;pointer-events:none;background:#111827;color:white;padding:9px 13px;border-radius:10px;font:12px system-ui;transition:.2s;white-space:nowrap}
    .vsa-toast.show{opacity:1;transform:translate(-50%,0)}
    .vsa-empty{padding:14px;text-align:center;color:var(--muted);font-size:12px}
    @keyframes vsa-slideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
    @keyframes vsa-fade{from{opacity:0}to{opacity:1}}
    @keyframes vsa-slideLeft{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
    @keyframes vsa-slideRight{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
    @keyframes vsa-zoom{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}
    @keyframes vsa-bounce{0%{opacity:0;transform:scale(.7)}60%{opacity:1;transform:scale(1.06)}100%{transform:scale(1)}}
    @keyframes vsa-flip{from{opacity:0;transform:perspective(500px) rotateX(-75deg)}to{opacity:1;transform:none}}
    @keyframes vsa-glitch{0%{opacity:0;transform:translateX(-7px)}25%{transform:translateX(5px)}50%{transform:translateX(-3px)}100%{opacity:1;transform:none}}
    @media(max-width:520px){.vsa-panel{right:8px;bottom:72px;width:calc(100vw - 16px);max-height:84dvh;border-radius:18px}.vsa-fab{right:12px;bottom:12px}.vsa-body{padding:11px}.vsa-head{padding:12px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
  `;

  function styleText() {
    const theme = THEMES[state.settings.theme] || THEMES.midnight;
    const accent = /^#[0-9a-f]{6}$/i.test(state.settings.accent) ? state.settings.accent : DEFAULTS.accent;
    return `${css}
      :host{--bg:${theme.bg};--panel:${theme.panel};--text:${theme.text};--muted:${theme.muted};--border:${theme.border};--accent:${accent}}
      .vsa-panel{animation:vsa-${EFFECTS[state.settings.animation] ? state.settings.animation : 'slideUp'} .28s ease both}
      .vsa-preview.play[data-effect="slideUp"] .vsa-preview-card{animation:vsa-slideUp .7s ease both}
      .vsa-preview.play[data-effect="fade"] .vsa-preview-card{animation:vsa-fade .7s ease both}
      .vsa-preview.play[data-effect="slideLeft"] .vsa-preview-card{animation:vsa-slideLeft .7s ease both}
      .vsa-preview.play[data-effect="slideRight"] .vsa-preview-card{animation:vsa-slideRight .7s ease both}
      .vsa-preview.play[data-effect="zoom"] .vsa-preview-card{animation:vsa-zoom .7s ease both}
      .vsa-preview.play[data-effect="bounce"] .vsa-preview-card{animation:vsa-bounce .7s ease both}
      .vsa-preview.play[data-effect="flip"] .vsa-preview-card{animation:vsa-flip .7s ease both}
      .vsa-preview.play[data-effect="glitch"] .vsa-preview-card{animation:vsa-glitch .7s steps(2,end) both}
    `;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function render() {
    const theme = state.settings.theme;
    const panel = state.open ? `
      <section class="vsa-panel" data-theme="${esc(theme)}" role="dialog" aria-label="VN Shortlink Assistant">
        <header class="vsa-head">
          <div class="vsa-headrow">
            <div class="vsa-brand"><span class="vsa-logo">↗</span><div>VN Shortlink Assistant<div class="vsa-sub">Manual mode · v${VERSION} · Không tự chuyển hướng</div></div></div>
            <button class="vsa-iconbtn" data-action="close" aria-label="Đóng">✕</button>
          </div>
        </header>
        <nav class="vsa-tabs">
          ${[['home','⌂ Bypass + Link đích'],['effects','✦ Hiệu ứng'],['settings','⚙ Cài đặt'],['logs','☷ Nhật ký']].map(([id,label]) => `<button class="vsa-tab ${state.tab===id?'active':''}" data-tab="${id}">${label}</button>`).join('')}
        </nav>
        <main class="vsa-body">${renderTab()}</main>
        <footer class="vsa-footer"><span>Chỉ phân tích và chờ bạn xác nhận</span><span>${esc(location.hostname)}</span></footer>
        <div class="vsa-toast" aria-live="polite"></div>
      </section>` : '';
    root.innerHTML = `<style>${styleText()}</style>
      ${state.settings.showFloatingButton ? `<button class="vsa-fab" data-action="toggle" title="Mở Shortlink Assistant">↗</button>` : ''}
      ${panel}`;
  }

  function renderTab() {
    if (state.tab === 'home') return `
      <div class="vsa-card">
        <div class="vsa-row"><h3 class="vsa-title">Trạng thái phân tích</h3><span class="vsa-muted">${state.busy?'Đang quét…':state.candidates.length+' URL ứng viên'}</span></div>
        <p class="vsa-muted">Công cụ chỉ đọc dữ liệu đang có trên trang. Không tự bấm nút, không tự submit và không tự điều hướng.</p>
        <div class="vsa-actions"><button class="vsa-btn" data-action="scan" ${state.busy?'disabled':''}>⌕ Quét / Bypass thủ công</button><button class="vsa-btn secondary" data-action="rescan">↻ Làm mới kết quả</button></div>
      </div>
      <div class="vsa-card">
        <h3 class="vsa-title">Link đích</h3>
        <textarea class="vsa-url" id="vsa-destination" spellcheck="false" placeholder="Chưa tìm thấy link đích…">${esc(state.destination)}</textarea>
        <div class="vsa-actions"><button class="vsa-btn" data-action="use-url">Áp dụng URL</button><button class="vsa-btn secondary" data-action="copy">Sao chép</button><button class="vsa-btn secondary" data-action="open">Mở trang ↗</button></div>
      </div>
      <div class="vsa-card">
        <div class="vsa-row"><h3 class="vsa-title">URL phát hiện được</h3><span class="vsa-muted">${state.candidates.length}</span></div>
        ${state.candidates.length ? state.candidates.map((item,i)=>`<div class="vsa-log"><div class="vsa-row"><span>${i+1}. ${esc(item.source)}</span><button class="vsa-btn secondary" data-pick="${i}">Chọn</button></div><div class="vsa-muted" style="overflow-wrap:anywhere;margin-top:4px">${esc(item.url)}</div></div>`).join('') : '<div class="vsa-empty">Chưa có kết quả. Nhấn “Quét / Bypass thủ công”.</div>'}
      </div>`;
    if (state.tab === 'effects') return `
      <div class="vsa-card"><h3 class="vsa-title">Chọn hiệu ứng mở menu</h3><p class="vsa-muted">Chạm vào từng mẫu để chọn, sau đó nhấn xem thử. Hình minh họa được tạo ngay trong menu, không tải ảnh ngoài.</p>
        <div class="vsa-grid">${Object.entries(EFFECTS).map(([id,label])=>`<button class="vsa-effect ${state.settings.animation===id?'selected':''}" data-effect="${id}"><div class="vsa-thumb"><div class="vsa-mini"></div></div><strong>${label}</strong><div class="vsa-muted">${id}</div></button>`).join('')}</div>
        <label class="vsa-label">Xem trước hiệu ứng</label><div class="vsa-preview" id="vsa-preview" data-effect="${esc(state.settings.animation)}"><div class="vsa-preview-card">VN Shortlink<br><small class="vsa-muted">Menu preview</small></div></div>
        <button class="vsa-btn" data-action="preview">▶ Xem thử</button>
      </div>`;
    if (state.tab === 'settings') return `
      <div class="vsa-card"><h3 class="vsa-title">Giao diện</h3>
        <label class="vsa-label">Chủ đề</label><select class="vsa-select" id="vsa-theme">${Object.keys(THEMES).map(k=>`<option value="${k}" ${state.settings.theme===k?'selected':''}>${k}</option>`).join('')}</select>
        <label class="vsa-label">Màu nhấn</label><input class="vsa-input" id="vsa-accent" value="${esc(state.settings.accent)}" placeholder="#8b5cf6">
        <label class="vsa-label">Tên miền tùy chỉnh (mỗi dòng một host, tùy chọn)</label><textarea class="vsa-input" id="vsa-hosts" rows="3" placeholder="example.com">${esc(state.settings.customHosts)}</textarea>
      </div>
      <div class="vsa-card"><h3 class="vsa-title">Hành vi</h3>
        ${switchRow('enabled','Bật công cụ')}
        ${switchRow('showFloatingButton','Hiện nút nổi')}
        ${switchRow('autoScan','Quét URL khi mở menu')}
        ${switchRow('logs','Ghi nhật ký')}
        <p class="vsa-muted">Không có tùy chọn tự chuyển hướng. Việc mở link đích luôn cần thao tác bấm nút.</p>
      </div>
      <div class="vsa-card"><h3 class="vsa-title">Site adapter</h3><p class="vsa-muted">Bật/tắt nhận diện theo tên host. Các adapter hiện chỉ hỗ trợ nhận diện và quét URL; chưa giả lập thao tác vượt xác minh của website.</p>
        ${SITE_HINTS.map(s=>`<label class="vsa-switch"><span>${s.label}</span><input type="checkbox" data-site="${s.id}" ${state.settings.siteEnabled[s.id]!==false?'checked':''}></label>`).join('')}
      </div>
      <div class="vsa-actions"><button class="vsa-btn" data-action="save-settings">Lưu cài đặt</button><button class="vsa-btn secondary" data-action="reset">Khôi phục mặc định</button></div>`;
    return `<div class="vsa-card"><div class="vsa-row"><h3 class="vsa-title">Nhật ký hoạt động</h3><button class="vsa-btn secondary" data-action="clear-logs">Xóa</button></div>
      ${state.logs.length ? state.logs.map(x=>`<div class="vsa-log ${x.type}"><span class="vsa-muted">${esc(x.time)}</span> · ${esc(x.message)}</div>`).join('') : '<div class="vsa-empty">Chưa có nhật ký.</div>'}</div>`;
  }

  function switchRow(key,label) {
    return `<label class="vsa-switch"><span>${label}</span><input type="checkbox" data-setting="${key}" ${state.settings[key]?'checked':''}></label>`;
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) { state.tab = button.dataset.tab; render(); return; }
    if (button.dataset.effect) {
      state.settings.animation = button.dataset.effect;
      render();
      return;
    }
    if (button.dataset.pick !== undefined) {
      const item = state.candidates[Number(button.dataset.pick)];
      if (item) setDestination(item.url);
      return;
    }
    const action = button.dataset.action;
    if (action === 'toggle') { state.open = !state.open; render(); if (state.open && state.settings.autoScan && !state.candidates.length) runScan(); }
    if (action === 'close') { state.open = false; render(); }
    if (action === 'scan' || action === 'rescan') runScan();
    if (action === 'copy') copyDestination();
    if (action === 'open') openDestination();
    if (action === 'use-url') {
      const value = root.querySelector('#vsa-destination')?.value || '';
      setDestination(value);
    }
    if (action === 'preview') {
      const preview = root.querySelector('#vsa-preview');
      if (preview) {
        preview.classList.remove('play'); void preview.offsetWidth; preview.classList.add('play');
        clearTimeout(state.previewTimer);
        state.previewTimer = setTimeout(() => preview.classList.remove('play'), 950);
      }
    }
    if (action === 'save-settings') {
      const theme = root.querySelector('#vsa-theme')?.value;
      const accent = root.querySelector('#vsa-accent')?.value;
      const hosts = root.querySelector('#vsa-hosts')?.value;
      if (theme) state.settings.theme = theme;
      if (/^#[0-9a-f]{6}$/i.test(accent || '')) state.settings.accent = accent;
      state.settings.customHosts = hosts || '';
      saveSettings(); render();
    }
    if (action === 'reset') {
      state.settings = { ...DEFAULTS, siteEnabled: {} };
      saveSettings(); render();
    }
    if (action === 'clear-logs') { state.logs = []; render(); }
  }

  function handleChange(event) {
    const el = event.target;
    if (el.dataset.setting) {
      state.settings[el.dataset.setting] = el.checked;
      saveSettings(); render();
    }
    if (el.dataset.site) {
      state.settings.siteEnabled[el.dataset.site] = el.checked;
      saveSettings();
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);

  function openMenu() {
    if (!state.settings.enabled) return;
    state.open = true;
    state.tab = 'home';
    render();
    if (state.settings.autoScan && !state.candidates.length) runScan();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Mở VN Shortlink Assistant', openMenu);
    GM_registerMenuCommand('Quét URL trang hiện tại', runScan);
  }

  // Nút nổi chỉ được hiển thị khi bật. Không can thiệp vào điều hướng của website.
  render();
  if (state.settings.enabled && state.settings.autoScan && isCurrentSiteEnabled()) {
    // Quét thụ động khi trang đã tải; không click, submit hay redirect.
    state.candidates = collectCandidates();
    const first = state.candidates.find(x => !isSameOrigin(x.url));
    if (first) state.destination = first.url;
  }

  // API gỡ lỗi thủ công trong console: window.__VSA_SCAN__(); không tự điều hướng.
  try {
    Object.defineProperty(window, '__VSA_SCAN__', { configurable: true, value: () => { runScan(); return state.candidates; } });
  } catch { /* Một số trang khóa thuộc tính window */ }
})();

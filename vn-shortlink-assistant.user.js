// ==UserScript==
// @name         VN Shortlink Assistant — Manual Bypass
// @namespace    https://github.com/tienadrr/Tienadrbypasslink
// @version      7.0.0
// @description  Bypass shortlink thủ công, menu gọn 1 trang, không tự chuyển hướng.
// @author       You
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    'use strict';

    const APP = 'vn-shortlink-assistant';
    const STORE = APP + ':settings';
    const VERSION = '7.0.0';

    const DEFAULT = {
        enabled: true,
        showFab: true,
        theme: 'midnight',
        accent: '#8b5cf6',
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

    // Host tải file thật — chỉ những host này mới được coi là link đích
    const DOWNLOAD_HOSTS = [
        'mediafire.com', 'drive.google.com', 'mega.nz', 'mega.co.nz',
        'dropbox.com', 'fshare.vn', 'onedrive.live.com', '1drv.ms',
        '4share.vn', 'tenlua.vn', 'icorner.ch', 'gofile.io',
        'pixeldrain.com', 'send.cm', 'katfile.com', 'rapidgator.net',
        'nitroflare.com', 'uploadhaven.com', 'anonfiles.com', 'workupload.com'
    ];

    // Host rác — luôn loại
    const BLOCK_HOSTS = [
        't.me', 'telegram.me', 'telegram.org', 'facebook.com', 'fb.com',
        'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'instagram.com',
        'github.com', 'raw.githubusercontent.com', 'gist.github.com',
        'googleapis.com', 'gstatic.com', 'googletagmanager.com', 'google-analytics.com',
        'cloudflare.com', 'cdnjs.cloudflare.com', 'jsdelivr.net', 'unpkg.com',
        'bootstrapcdn.com', 'jquery.com', 'doubleclick.net', 'googlesyndication.com',
        'tapvietcode.com', 'link4sub.com', 'sitetop.net', 'lentop.one', 'linkfree.click'
    ];

    const state = {
        settings: load(),
        open: false,
        busy: false,
        destination: '',
        candidates: [],
        logs: []
    };

    function load() {
        try {
            const raw = typeof GM_getValue === 'function' ? GM_getValue(STORE, null) : null;
            return { ...DEFAULT, ...(raw && typeof raw === 'object' ? raw : {}) };
        } catch { return { ...DEFAULT }; }
    }

    function save() {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(STORE, state.settings);
            else localStorage.setItem(STORE, JSON.stringify(state.settings));
        } catch {}
    }

    function log(msg, type = 'info') {
        state.logs.unshift({ t: new Date().toLocaleTimeString(), m: String(msg), type });
        state.logs = state.logs.slice(0, 60);
        if (state.settings.logs) console.info('[VSA]', msg);
        if (state.open) render();
    }

    function toast(msg) {
        const el = shadow?.querySelector('.vsa-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove('show'), 1800);
    }

    function hostOf(url) {
        try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
        catch { return ''; }
    }

    function isBlocked(url) {
        const h = hostOf(url);
        if (!h) return true;
        return BLOCK_HOSTS.some(b => h === b || h.endsWith('.' + b));
    }

    function isDownloadHost(url) {
        const h = hostOf(url);
        return DOWNLOAD_HOSTS.some(b => h === b || h.endsWith('.' + b));
    }

    function isFileUrl(url) {
        return /\.(zip|rar|7z|apk|exe|dmg|iso|tar|gz|mp4|mkv)(\?|$|#)/i.test(url);
    }

    function decodeWrap(value) {
        let cur = String(value || '').trim();
        for (let i = 0; i < 3; i++) {
            try {
                const d = decodeURIComponent(cur.replace(/\+/g, '%20'));
                if (d === cur) break;
                cur = d;
            } catch { break; }
        }
        const q = cur.match(/(?:^|[?&])(?:url|u|target|dest|destination|redirect|r|link|to)=([^&]+)/i);
        if (q) cur = decodeURIComponent(q[1]);
        try {
            if (/^[A-Za-z0-9+/_=-]{24,}$/.test(cur) && !/^https?:/i.test(cur)) {
                const n = cur.replace(/-/g, '+').replace(/_/g, '/');
                const d = atob(n.padEnd(Math.ceil(n.length / 4) * 4, '='));
                if (/https?:\/\//i.test(d)) cur = d;
            }
        } catch {}
        const m = cur.match(/https?:\/\/[^\s"'<>\\]+/i);
        return m ? m[0].replace(/[),.;\]}]+$/, '') : '';
    }

    function safe(url) {
        if (!url || typeof url !== 'string') return '';
        const s = url.trim();
        if (!s || /^(javascript|data|vbscript|#):?/i.test(s)) return '';
        try {
            const u = new URL(s, location.href);
            if (!['http:', 'https:'].includes(u.protocol)) return '';
            if (u.username || u.password) return '';
            return u.href;
        } catch { return ''; }
    }

    // ─────────────────────────────────────────────
    // SCAN — chặt, chỉ nhận link đích thật
    // ─────────────────────────────────────────────
    function scan() {
        const hits = [];

        const push = (raw, source) => {
            let url = safe(decodeWrap(raw) || raw);
            if (!url || url === location.href) return;
            if (isBlocked(url)) return;
            if (hostOf(url) === hostOf(location.href)) return;

            // Chỉ nhận: host download thật, hoặc file trực tiếp
            if (!isDownloadHost(url) && !isFileUrl(url)) return;

            if (!hits.some(x => x.url === url)) hits.push({ url, source });
        };

        // 1) Meta tags — nguồn tin cậy nhất
        [
            'meta[property="og:url"]',
            'meta[name="twitter:url"]',
            'meta[itemprop="url"]',
            'link[rel="canonical"]'
        ].forEach(sel => {
            document.querySelectorAll(sel).forEach(m => {
                const v = m.getAttribute('content') || m.getAttribute('href');
                if (v) push(v, 'Meta');
            });
        });

        // 2) Anchors trên trang
        document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            const txt = (a.textContent || '').toLowerCase();
            if (!href) return;
            // Bỏ qua anchor không liên quan
            if (!/download|tải|get|mirror|mediafire|drive|mega|fshare/i.test(txt) &&
                !isDownloadHost(href) && !isFileUrl(href)) return;
            push(href, 'Link trên trang');
        });

        // 3) data-url / hidden inputs — chỉ khi trỏ đến host download
        document.querySelectorAll('[data-url],[data-href],[data-target],[data-link],input[type="hidden"]').forEach(el => {
            ['value', 'data-url', 'data-href', 'data-target', 'data-link'].forEach(attr => {
                const v = attr === 'value' ? el.value : el.getAttribute(attr);
                if (v) push(v, 'Data attr');
            });
        });

        // 4) Raw HTML — CHỈ tìm host download cụ thể (không generic http)
        const html = document.documentElement?.innerHTML || '';
        DOWNLOAD_HOSTS.forEach(h => {
            const re = new RegExp(`https?:\\/\\/[^\\s"'<>]*${h.replace(/\./g, '\\.')}[^\\s"'<>]*`, 'gi');
            let m, n = 0;
            while ((m = re.exec(html)) && n++ < 20) {
                push(m[0].replace(/\\\//g, '/'), 'HTML');
            }
        });

        // Sort: MediaFire/Drive/MEGA đầu
        const rank = u => {
            const h = hostOf(u);
            if (/mediafire|drive\.google|mega\.nz|fshare/.test(h)) return 3;
            if (isDownloadHost(u)) return 2;
            return 1;
        };
        hits.sort((a, b) => rank(b.url) - rank(a.url));

        state.candidates = hits.slice(0, 20);
        if (state.candidates[0]) {
            state.destination = state.candidates[0].url;
            state.settings.destination = state.destination;
            save();
            log(`Tìm thấy ${state.candidates.length} link đích. Chọn: ${state.destination}`, 'ok');
            toast('Đã tìm thấy link đích!');
        } else {
            state.destination = '';
            log('Không tìm thấy link đích thật trên trang này.', 'error');
            toast('Không tìm thấy link đích');
        }
    }

    function bypass() {
        if (state.busy) return;
        state.busy = true;
        log('Đang quét…');
        try { scan(); } catch (e) { log('Lỗi: ' + e.message, 'error'); }
        state.busy = false;
        render();
    }

    function setDest(url) {
        const u = safe(url);
        if (!u) return toast('URL không hợp lệ');
        state.destination = u;
        state.settings.destination = u;
        save();
        render();
    }

    function copyDest() {
        const u = safe(state.destination);
        if (!u) return toast('Chưa có link');
        try {
            if (typeof GM_setClipboard === 'function') GM_setClipboard(u);
            else navigator.clipboard?.writeText(u);
            toast('Đã copy');
        } catch { toast('Không copy được'); }
    }

    function openDest() {
        const u = safe(state.destination);
        if (!u) return toast('Chưa có link');
        if (typeof GM_openInTab === 'function') GM_openInTab(u, { active: true, insert: true });
        else window.open(u, '_blank', 'noopener');
    }

    // ─────────────────────────────────────────────
    // UI
    // ─────────────────────────────────────────────
    const host = document.createElement('div');
    host.id = APP + '-host';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    function css() {
        const t = THEMES[state.settings.theme] || THEMES.midnight;
        const a = /^#[0-9a-f]{6}$/i.test(state.settings.accent) ? state.settings.accent : DEFAULT.accent;
        return `
            :host{all:initial;--bg:${t.bg};--panel:${t.panel};--text:${t.text};--muted:${t.muted};--border:${t.border};--accent:${a}}
            *{box-sizing:border-box}
            .vsa-fab{position:fixed;right:18px;bottom:18px;width:50px;height:50px;border:0;border-radius:14px;background:var(--accent);color:#fff;font:800 18px system-ui;box-shadow:0 8px 24px #0006;cursor:pointer;z-index:2147483646}
            .vsa-panel{position:fixed;right:18px;bottom:78px;width:min(380px,calc(100vw - 24px));max-height:min(78dvh,640px);display:flex;flex-direction:column;border:1px solid var(--border);border-radius:16px;background:var(--panel);color:var(--text);box-shadow:0 18px 50px #0009;font:13px/1.45 system-ui,sans-serif;z-index:2147483647;animation:vsa-in .22s ease both;overflow:hidden}
            @keyframes vsa-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
            .vsa-head{padding:11px 13px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);background:linear-gradient(135deg,var(--panel),color-mix(in srgb,var(--accent) 15%,var(--panel)))}
            .vsa-title{font-weight:800;font-size:13px}
            .vsa-sub{font-size:10px;color:var(--muted);margin-top:1px}
            .vsa-x{border:0;background:transparent;color:var(--text);font-size:16px;cursor:pointer;padding:4px 8px}
            .vsa-body{padding:11px;overflow:auto;display:flex;flex-direction:column;gap:9px}
            .vsa-card{border:1px solid var(--border);border-radius:11px;padding:10px;background:color-mix(in srgb,var(--bg) 55%,transparent)}
            .vsa-lbl{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}
            .vsa-row{display:flex;gap:6px;flex-wrap:wrap}
            .vsa-btn{border:0;border-radius:9px;padding:9px 12px;background:var(--accent);color:#fff;font:750 12px system-ui;cursor:pointer;flex:1;min-width:0}
            .vsa-btn:disabled{opacity:.45;cursor:not-allowed}
            .vsa-btn.ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
            .vsa-url{width:100%;min-height:58px;max-height:100px;overflow:auto;overflow-wrap:anywhere;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text);padding:8px;font:11px/1.4 ui-monospace,monospace;resize:vertical}
            .vsa-item{padding:7px 0;border-bottom:1px solid var(--border);font-size:11px}
            .vsa-item:last-child{border:0}
            .vsa-item .u{overflow-wrap:anywhere;color:var(--muted);margin-top:3px;font-family:ui-monospace,monospace;font-size:10px}
            .vsa-item .h{display:flex;justify-content:space-between;align-items:center;gap:6px}
            .vsa-badge{background:var(--accent);color:#fff;padding:1px 6px;border-radius:4px;font-size:9px;margin-left:4px}
            .vsa-mini{border:1px solid var(--border);background:transparent;color:var(--text);border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer}
            .vsa-empty{text-align:center;color:var(--muted);padding:12px;font-size:11px}
            .vsa-log{padding:4px 0;font-size:10px;color:var(--muted);border-bottom:1px solid var(--border);overflow-wrap:anywhere}
            .vsa-log:last-child{border:0}
            .vsa-log.error{color:#fb7185}
            .vsa-log.ok{color:#4ade80}
            .vsa-input,.vsa-select{width:100%;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);padding:7px;font:11px system-ui;outline:none}
            .vsa-sw{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:11px}
            .vsa-sw input{accent-color:var(--accent)}
            .vsa-toast{position:absolute;left:50%;bottom:40px;transform:translate(-50%,10px);opacity:0;pointer-events:none;background:#111827;color:#fff;padding:7px 12px;border-radius:8px;font:11px system-ui;transition:.2s;white-space:nowrap;z-index:10}
            .vsa-toast.show{opacity:1;transform:translate(-50%,0)}
            @media(max-width:520px){.vsa-panel{right:8px;bottom:70px;width:calc(100vw - 16px)}.vsa-fab{right:12px;bottom:12px}}
        `;
    }

    function badge(url) {
        const h = hostOf(url);
        if (/mediafire/.test(h)) return '<span class="vsa-badge">MF</span>';
        if (/drive\.google/.test(h)) return '<span class="vsa-badge">Drive</span>';
        if (/mega\./.test(h)) return '<span class="vsa-badge">MEGA</span>';
        if (/fshare/.test(h)) return '<span class="vsa-badge">Fshare</span>';
        if (isDownloadHost(url)) return '<span class="vsa-badge">Host</span>';
        return '';
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function render() {
        if (!state.settings.enabled) { shadow.innerHTML = ''; return; }

        const panel = state.open ? `
            <div class="vsa-panel">
                <div class="vsa-head">
                    <div><div class="vsa-title">Shortlink Assistant</div><div class="vsa-sub">v${VERSION} · thủ công</div></div>
                    <button class="vsa-x" data-a="close">✕</button>
                </div>
                <div class="vsa-body">
                    <div class="vsa-card">
                        <div class="vsa-row">
                            <button class="vsa-btn" data-a="bypass" ${state.busy?'disabled':''}>${state.busy?'Đang quét…':'⚡ Bypass'}</button>
                            <button class="vsa-btn ghost" data-a="refresh">↻</button>
                        </div>
                    </div>
                    <div class="vsa-card">
                        <div class="vsa-lbl">Link đích</div>
                        <textarea class="vsa-url" id="vsa-dest" spellcheck="false" placeholder="Chưa có…">${esc(state.destination)}</textarea>
                        <div class="vsa-row" style="margin-top:7px">
                            <button class="vsa-btn ghost" data-a="apply">Áp dụng</button>
                            <button class="vsa-btn ghost" data-a="copy">Copy</button>
                            <button class="vsa-btn" data-a="open">Mở</button>
                        </div>
                    </div>
                    <div class="vsa-card">
                        <div class="vsa-lbl">Ứng viên (${state.candidates.length})</div>
                        ${state.candidates.length ? state.candidates.map((c, i) => `
                            <div class="vsa-item">
                                <div class="h">
                                    <span>${esc(c.source)} ${badge(c.url)}</span>
                                    <span>
                                        <button class="vsa-mini" data-pick="${i}">Chọn</button>
                                        <button class="vsa-mini" data-copy="${i}">📋</button>
                                    </span>
                                </div>
                                <div class="u">${esc(c.url)}</div>
                            </div>
                        `).join('') : '<div class="vsa-empty">Chưa có. Nhấn Bypass.</div>'}
                    </div>
                    <details class="vsa-card" ${state.open?'open':''}>
                        <summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted)">⚙ Cài đặt & Log</summary>
                        <div style="margin-top:8px">
                            <div class="vsa-lbl">Chủ đề</div>
                            <select class="vsa-select" id="vsa-theme">${Object.keys(THEMES).map(k=>`<option value="${k}" ${state.settings.theme===k?'selected':''}>${k}</option>`).join('')}</select>
                            <div class="vsa-lbl" style="margin-top:8px">Màu nhấn</div>
                            <input class="vsa-input" id="vsa-accent" value="${esc(state.settings.accent)}">
                            <div class="vsa-sw"><span>Hiện nút nổi</span><input type="checkbox" data-s="showFab" ${state.settings.showFab?'checked':''}></div>
                            <div class="vsa-sw"><span>Ghi log console</span><input type="checkbox" data-s="logs" ${state.settings.logs?'checked':''}></div>
                            <div class="vsa-row" style="margin-top:8px">
                                <button class="vsa-btn" data-a="save">Lưu</button>
                                <button class="vsa-btn ghost" data-a="reset">Reset</button>
                            </div>
                            <div class="vsa-lbl" style="margin-top:10px">Log</div>
                            ${state.logs.slice(0,8).map(l => `<div class="vsa-log ${l.type}">${esc(l.t)} · ${esc(l.m)}</div>`).join('') || '<div class="vsa-empty">—</div>'}
                        </div>
                    </details>
                </div>
                <div class="vsa-toast"></div>
            </div>` : '';

        shadow.innerHTML = `<style>${css()}</style>
            ${state.settings.showFab ? `<button class="vsa-fab" data-a="toggle">↗</button>` : ''}
            ${panel}`;
    }

    shadow.addEventListener('click', e => {
        const btn = e.target.closest('[data-a],[data-pick],[data-copy]');
        if (!btn) return;

        if (btn.dataset.pick !== undefined) {
            const c = state.candidates[Number(btn.dataset.pick)];
            if (c) setDest(c.url);
            return;
        }
        if (btn.dataset.copy !== undefined) {
            const c = state.candidates[Number(btn.dataset.copy)];
            if (c) {
                try { GM_setClipboard(c.url); toast('Đã copy'); } catch { toast('Lỗi copy'); }
            }
            return;
        }

        const a = btn.dataset.a;
        if (a === 'toggle') { state.open = !state.open; render(); if (state.open) setTimeout(()=>shadow.querySelector('#vsa-dest')?.focus(), 50); }
        if (a === 'close') { state.open = false; render(); }
        if (a === 'bypass') bypass();
        if (a === 'refresh') bypass();
        if (a === 'apply') setDest(shadow.querySelector('#vsa-dest')?.value || '');
        if (a === 'copy') copyDest();
        if (a === 'open') openDest();
        if (a === 'save') {
            const th = shadow.querySelector('#vsa-theme')?.value;
            const ac = shadow.querySelector('#vsa-accent')?.value;
            if (th) state.settings.theme = th;
            if (/^#[0-9a-f]{6}$/i.test(ac||'')) state.settings.accent = ac;
            save(); toast('Đã lưu'); render();
        }
        if (a === 'reset') {
            state.settings = { ...DEFAULT };
            save(); render();
        }
    });

    shadow.addEventListener('change', e => {
        const el = e.target;
        if (el.dataset.s) {
            state.settings[el.dataset.s] = el.checked;
            save(); render();
        }
    });

    // ─────────────────────────────────────────────
    // FIX: menu luôn hiện — chống SPA xóa host
    // ─────────────────────────────────────────────
    function ensureHost() {
        if (!document.getElementById(APP + '-host')) {
            document.documentElement.appendChild(host);
        } else if (!host.isConnected) {
            document.documentElement.appendChild(host);
        }
    }
    setInterval(ensureHost, 1000);

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Mở Shortlink Assistant', () => {
            ensureHost();
            state.open = true;
            render();
        });
        GM_registerMenuCommand('Bypass ngay', () => {
            ensureHost();
            bypass();
        });
    }

    render();

    // Tự quét nhẹ khi vào trang (không redirect)
    if (state.settings.enabled) {
        setTimeout(() => { try { scan(); render(); } catch {} }, 800);
    }
})();

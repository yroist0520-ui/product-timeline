/* =========================================================================
   PRODUCT TIMELINE — 核心工具：API、时间换算、DOM、反馈组件
   所有显示时间都由服务端 UTC 时间戳换算，绝不读取客户端本地时间生成记录。
   ========================================================================= */

export const state = {
  user: null,          // 当前登录用户（未登录为 null）
  serverTime: null,    // 服务端 UTC 时间，用于页脚展示
  categories: [],      // 预设分类
  theme: 'light',
};

export async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  let data = {};
  try { data = await res.json(); } catch { /* 忽略非 JSON 响应 */ }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

export const API = {
  me: () => api('/api/auth/me'),
  login: (username, password) => api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }),
  register: (username, password, displayName) => api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, displayName }) }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  categories: () => api('/api/categories'),
  profile: (username) => api(`/api/profile/${encodeURIComponent(username)}`),
  timeline: (username, params = {}) => api(`/api/timeline/${encodeURIComponent(username)}?${new URLSearchParams(params)}`),
  product: (id) => api(`/api/products/${encodeURIComponent(id)}`, { cache: 'no-store' }),
  productNoCache: (id) => api(`/api/products/${encodeURIComponent(id)}?t=${Date.now()}`, { cache: 'no-store' }),
  publish: (formData) => api('/api/products', { method: 'POST', body: formData }),
  patchMe: (patch) => api('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  uploadAvatar: (formData) => api('/api/me/avatar', { method: 'POST', body: formData }),
  verify: () => api('/api/verify'),
  audit: () => api('/api/audit'),
  serverTime: () => api('/api/server-time'),
};

/* ── DOM ──────────────────────────────────────────────────────────────── */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('pt:navigate'));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/** 入场序列 + 滚动触发，只动 opacity / transform。 */
export function initReveal(root = document) {
  const nodes = $$('.reveal', root);
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodes.forEach((n) => n.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: .06 });
  nodes.forEach((n) => io.observe(n));
}

/* ── 反馈组件 ─────────────────────────────────────────────────────────── */
export function toast(message, type = 'info', duration = 3600) {
  const root = $('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

export function confirmModal({ eyebrow = 'CONFIRM', title, bodyHtml, confirmText = '确认', cancelText = '返回检查', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal__eyebrow">${escapeHtml(eyebrow)}</div>
        <h2 class="modal__title">${escapeHtml(title)}</h2>
        <div class="modal__body">${bodyHtml}</div>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-modal="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? '' : 'btn--accent'}" data-modal="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
      const btn = e.target.closest('[data-modal]');
      if (btn) close(btn.dataset.modal === 'confirm');
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(backdrop);
    $('[data-modal="confirm"]', backdrop).focus();
  });
}

/* ── 时间：UTC 存储 → 用户时区显示 ────────────────────────────────────── */
export function activeTimezone() {
  const tz = state.user?.timezone || '';
  if (tz) {
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: tz }); return tz; } catch { /* 回退 */ }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function tzLabel() {
  const tz = activeTimezone();
  const d = new Date();
  let offset = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(d);
    offset = (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  } catch { /* 忽略 */ }
  return `${tz}${offset ? ` (${offset})` : ''}`;
}

/** 把 UTC ISO 时间拆成指定时区的展示字段（hourCycle h23 避免 24:xx）。 */
export function timeParts(iso, tz = activeTimezone()) {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const p = {};
  fmt.formatToParts(date).forEach((part) => { p[part.type] = part.value; });
  return {
    year: p.year, month: p.month, day: p.day,
    hms: `${p.hour}:${p.minute}:${p.second}`,
    hm: `${p.hour}:${p.minute}`,
    weekday: p.weekday,
    dateKey: `${p.year}-${p.month}-${p.day}`,
    monthKey: `${p.year}-${p.month}`,
  };
}

export function formatFull(iso, tz = activeTimezone(), showSeconds = true) {
  const p = timeParts(iso, tz);
  return `${p.year}年${Number(p.month)}月${Number(p.day)}日 ${showSeconds ? p.hms : p.hm}`;
}

/** 按月份 → 日期两层分组，输入必须已按发布时间倒序。 */
export function groupProducts(products, tz = activeTimezone()) {
  const months = [];
  for (const product of products) {
    const p = timeParts(product.createdAt, tz);
    let month = months.find((m) => m.key === p.monthKey);
    if (!month) {
      month = { key: p.monthKey, year: p.year, month: p.month, count: 0, days: [] };
      months.push(month);
    }
    let day = month.days.find((d) => d.key === p.dateKey);
    if (!day) {
      day = { key: p.dateKey, day: p.day, weekday: p.weekday, count: 0, entries: [] };
      month.days.push(day);
    }
    day.entries.push({ product, parts: p });
    day.count += 1;
    month.count += 1;
  }
  return months;
}

export function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#161714' : '#f5f3ed');
}

/** 生成头像 HTML（无头像时用昵称首字，衬线字体）。 */
export function avatarHtml(user, cls = 'avatar') {
  if (user?.avatar) {
    return `<img class="${cls}" src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.displayName || user.username)} 的头像">`;
  }
  const ch = (user?.displayName || user?.username || 'P').trim().charAt(0).toUpperCase();
  return `<span class="${cls} avatar--letter" aria-hidden="true">${escapeHtml(ch)}</span>`;
}

export function categoryName(slug) {
  const found = state.categories.find((c) => c.slug === slug);
  return found ? found.name : slug;
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `tok-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

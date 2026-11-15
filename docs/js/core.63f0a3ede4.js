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

/* ── 独立前端模式 ───────────────────────────────────────────────────────
   GitHub Pages 只托管静态文件，本项目由 public/ 构建出 docs/ 并在页面注入
   PT_CONFIG：{ apiBase, sharecode, basePath }。此时页面直接调用真实后端，
   用 Bearer 令牌代替第三方 Cookie；发布时间、哈希链、不可篡改仍全在服务端。
   未注入配置时（主站）所有行为与原来完全一致。
   ---------------------------------------------------------------------- */
export const CFG = window.PT_CONFIG || null;
const TOKEN_KEY = 'pt-token';

/* ── 演示素材的真实照片 ──────────────────────────────────────────────────
   最初的演示记录用的是程序生成的抽象 PNG，体积大、经应用网关加载慢。这里
   只在「展示层」把这些已知的演示素材映射为随站点一起发布的真实摄影照片；
   数据库记录、图片 URL、哈希链和不可篡改规则完全不变。真实用户自己上传的
   图片不在映射表内，仍由服务端原样提供。
   ───────────────────────────────────────────────────────────────────── */
const PHOTO_FILES = [
  '01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg',
  '07.jpg', '08.jpg', '09.jpg', '10.jpg', '11.jpg', '12.jpg',
];
const DEMO_ART_HASHES = [
  'f649409742482629be1c8365d464e3f8e8c92a365bb36582a9bf36ca6edf9c55',
  '10139c05d9248a56e4c52a08f21b2e3dd59fc6a24885563e48a4675cf48a58ac',
  '9b79a1dab499fd479d03ac8db01bf96127c0aa76eccf274eb2139611da4ddd46',
  '3b13813d4a5cffe5fa0d7456be7eb850680d4ca2402a1bccecb506a28025ee84',
  '4203e137491ae513ab8a9ce1e3d760fad8d2240dc88cc17f61f12d86cd33f0a6',
  'f80471d0eab734334bae0b8c71abfa3407c3198faae5cad6730aa99414c2bdfe',
  'd847c874ea7635d0ce2f219636b7b62861096d4fd5aa9a3bcb14e6e4ccc4c43e',
  'c73d93d60a45a9a64499c0a66aca7eb9d3e57ca19b59a8324fd99aa093e7f6b2',
  'a43acee780834c725fc0f6af685250aeb5b5ff32f8c78ac4dce9d77e23855af0',
  '9ca2795000b0a74a452aed94aa637e15acc38db952aa46561b67e7e40371974a',
  'ac12522223632d78e3710cdadb56dd991ba276bf253e32a70170f2f882bc4ede',
  'f432ecf5729d6ae8800b26d93eebcadbe24c64d06cc1be47491d74befdf77795',
  '2deb7c12dc0ff300852439087b72b52247557232aef0019fdb93f7f2ef26cc15',
  '2b5981b9b7c5b034c7958988e2071141a55e9bd4e332ab57f88458d7531c1142',
  'a6903003d9f3b522bd533ddfd9c1b204d198c99ee62e883b517b7a5c0cf2dfea',
  '9a9e88f2e0a3ea49f09989ef8f7ca29bff64910d0f4e56e74a6478ac92fccfa4',
  '430d6c322e5ec701ba8732730b8c5117a018c15e4b9413cd836bed1c52546677',
  '282f3167fe2eee1f74688347d2bb3fa23c879c6817210d1a79ac815a31b4dd1b',
];
const DEMO_MEDIA = new Map(DEMO_ART_HASHES.map((h, i) => [h, PHOTO_FILES[i % PHOTO_FILES.length]]));
// 一条 2048px / 5.3 MB 的 PNG 会明显拖慢首屏，这里换成同一张图的压缩展示版。
DEMO_MEDIA.set('a2d24767ef39a4f641f80c224f11864f236cddf27e0f19d71ef581c9f5a454a5', 'user-01.jpg');

function photoUrl(file) {
  const base = CFG ? String(CFG.basePath || '/') : '/';
  return base.replace(/\/?$/, '/') + 'assets/photos/' + file;
}

/** 把后端返回的 /media/... 相对地址转成可跨域加载的绝对地址。 */
export function asset(url) {
  const value = String(url || '');
  if (!value) return value;
  const hash = /\/media\/[0-9a-f]{2}\/([0-9a-f]{40,})\.[a-z0-9]+/i.exec(value)?.[1];
  if (hash && DEMO_MEDIA.has(hash)) return photoUrl(DEMO_MEDIA.get(hash));
  if (/^(https?:|data:|blob:|\/\/)/i.test(value) || !CFG) return value;
  const sep = value.includes('?') ? '&' : '?';
  const q = CFG.sharecode ? sep + 'sharecode=' + encodeURIComponent(CFG.sharecode) : '';
  return CFG.apiBase + (value.startsWith('/') ? value : '/' + value) + q;
}

/** GitHub Pages 子路径下剥离 base，得到与主站一致的路由路径。 */
export function routePath() {
  const p = decodeURIComponent(location.pathname);
  if (!CFG) return p;
  const base = String(CFG.basePath || '/').replace(/\/$/, '');
  if (!base || p === base || p === base + '/') return '/';
  if (p.startsWith(base + '/')) return p.slice(base.length);
  return p;
}

function apiUrl(path) {
  if (!CFG) return path;
  const sep = path.includes('?') ? '&' : '?';
  const q = CFG.sharecode ? sep + 'sharecode=' + encodeURIComponent(CFG.sharecode) : '';
  return CFG.apiBase + path + q;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (CFG) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      // 网关可能占用标准 Authorization 头，同步发送专用头；后端按同一会话表校验。
      headers.set('X-PT-Session', token);
      headers.set('Authorization', 'Bearer ' + token);
    }
  }
  const res = await fetch(apiUrl(path), {
    credentials: CFG ? 'omit' : 'same-origin',
    ...options,
    headers,
  });
  let data = {};
  try { data = await res.json(); } catch { /* 忽略非 JSON 响应 */ }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  if (CFG && data && typeof data.token === 'string') localStorage.setItem(TOKEN_KEY, data.token);
  return data;
}

export const API = {
  me: () => api('/api/auth/me'),
  login: (username, password) => api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }),
  register: (username, password, displayName) => api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, displayName }) }),
  logout: async () => {
    try { return await api('/api/auth/logout', { method: 'POST' }); }
    finally { if (CFG) localStorage.removeItem(TOKEN_KEY); }
  },
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
  const target = CFG ? String(CFG.basePath || '/') + String(path).replace(/^\/+/, '') : path;
  if (replace) history.replaceState({}, '', target);
  else history.pushState({}, '', target);
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
    return `<img class="${cls}" src="${escapeHtml(asset(user.avatar))}" alt="${escapeHtml(user.displayName || user.username)} 的头像">`;
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

/* ── 头像图片规范化 ─────────────────────────────────────────────────────
   服务端按文件真实内容（魔数）判定格式，只持久化 JPG / PNG / WEBP /
   GIF / AVIF。iPhone 相册、从小红书等 App 保存的图片常常是 HEIC / HEIF
   （或后缀是 .jpg 但内容仍是 HEIF），直接上传会被拒绝；超长图、超大图、
   带 EXIF 旋转的照片也容易造成上传慢或显示歪斜。

   这里在浏览器里完成兼容：HEIC/HEIF 按需加载解码组件转为 JPEG，其余格式
   统一解码后居中裁成 512×512 的 JPEG 再上传。服务端收到的始终是标准图片，
   不需要改动后端、也不需要重新部署数据库；作品记录与不可篡改规则不受影响。
   ---------------------------------------------------------------------- */
const AVATAR_SIZE = 512;
const MAX_AVATAR_INPUT = 40 * 1024 * 1024;
let heicLoader = null;

function siteAsset(rel) {
  const base = CFG ? String(CFG.basePath || '/') : '/';
  return base.replace(/\/?$/, '/') + rel;
}

/** 只在确实选中 HEIC/HEIF 时才加载 1.3 MB 的解码组件，不拖累首屏。 */
function loadHeic2any() {
  if (typeof window.heic2any === 'function') return Promise.resolve(window.heic2any);
  if (!heicLoader) {
    heicLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = siteAsset('vendor/heic2any.min.js');
      script.async = true;
      script.onload = () => (typeof window.heic2any === 'function'
        ? resolve(window.heic2any)
        : reject(new Error('HEIC 解码组件加载异常')));
      script.onerror = () => reject(new Error('HEIC 解码组件加载失败，请检查网络后重试'));
      document.head.appendChild(script);
    }).catch((err) => { heicLoader = null; throw err; });
  }
  return heicLoader;
}

/** 读取文件头判断真实格式，绝不相信扩展名或 file.type。 */
async function fileSignature(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const text = (a, b) => Array.from(head.slice(a, b), (n) => String.fromCharCode(n)).join('');
  const brand = text(8, 12).toLowerCase();
  return {
    ftyp: text(4, 8) === 'ftyp',
    brand,
    avif: /^(avif|avis)/i.test(brand),
    known: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
      || text(1, 4) === 'PNG'
      || (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP')
      || /^GIF8[79]a$/.test(text(0, 6)),
  };
}

/** 解码任意浏览器可读图片，返回统一尺寸描述与释放句柄。 */
async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch { /* 老浏览器不支持选项或该格式，改用 <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('decode');
  }
}

/**
 * 把任意来源的图片变成「浏览器能解码、后端能接受」的文件。
 * 头像与作品发布共用：HEIC / HEIF 只在这里转成一次 JPEG。
 * 返回 { file, converted }。
 */
export async function ensureWebImage(file) {
  if (!file || !file.size) throw new Error('没有读取到图片内容，请重新选择文件');
  if (file.size > MAX_AVATAR_INPUT) throw new Error('图片超过 40 MB，请先压缩或截图后再上传');

  const sig = await fileSignature(file);
  // 所有 ftyp 容器且非 AVIF 的，基本都是 HEIC / HEIF 家族；
  // 后缀写成 .jpg 也照样按真实内容识别。
  const isHeif = (sig.ftyp && !sig.avif)
    || (/\.(heic|heif)$/i.test(String(file.name || '')) && !sig.known);
  if (isHeif) {
    const convert = await loadHeic2any();
    let output;
    try {
      output = await convert({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    } catch {
      throw new Error('这是 HEIC / HEIF 照片，自动转换失败。请在相册里用「共享 → 复制照片」或截图另存为 JPG 后再上传。');
    }
    const blob = Array.isArray(output) ? output[0] : output;
    if (!blob || !blob.size) throw new Error('HEIC 照片转换结果为空，请换一张图片重试');
    const name = String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return { file: new File([blob], name, { type: 'image/jpeg' }), converted: true };
  }

  // 魔数无法识别时先验证浏览器能否解码，避免非图片混进预览区和上传队列。
  if (!sig.known && !sig.avif) {
    let decoded;
    try { decoded = await decodeImage(file); } catch {
      throw new Error('这张图片浏览器无法读取，可能是 HEIC / RAW / 损坏文件。请用系统相册或预览导出为 JPG / PNG 后再上传。');
    }
    decoded.release();
  }
  return { file, converted: false };
}

/**
 * 把用户选择的文件转成后端一定接受的标准头像文件。
 * 返回 { file, converted }；converted 表示是否发生过格式转换。
 */
export async function normalizeAvatar(file) {
  const { file: prepared, converted } = await ensureWebImage(file);

  let decoded;
  try {
    decoded = await decodeImage(prepared);
  } catch {
    throw new Error('这张图片浏览器无法读取，可能是 HEIC / RAW / 损坏文件。请用系统相册或预览导出为 JPG / PNG 后再上传。');
  }
  if (!decoded.width || !decoded.height) {
    decoded.release();
    throw new Error('图片尺寸无效，请换一张照片重试');
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  // JPEG 不支持透明通道，先铺一层纸白底，避免透明 PNG 边缘变黑。
  ctx.fillStyle = '#f5f3ed';
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const side = Math.min(decoded.width, decoded.height);
  const sx = (decoded.width - side) / 2;
  const sy = (decoded.height - side) / 2;
  ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  decoded.release();

  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!out) throw new Error('图片处理失败，请换一张照片重试');
  const type = out.type || 'image/jpeg';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return { file: new File([out], `avatar.${ext}`, { type }), converted };
}

/* ── 图片加载反馈 ───────────────────────────────────────────────────────
   load / error 不冒泡，用捕获阶段监听。图片未到位时容器保持骨架占位，
   加载完成后淡入，避免「一片空白」被误认为上传或加载失败。
   ───────────────────────────────────────────────────────────────────── */
if (typeof document !== 'undefined') {
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth) return;
    img.classList.add('is-loaded');
    img.closest('.image-frame, .preview-card__image, .preview-item')?.classList.add('is-loaded');
  }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    img.classList.add('is-failed');
    img.closest('.image-frame')?.classList.add('is-failed');
  }, true);
}

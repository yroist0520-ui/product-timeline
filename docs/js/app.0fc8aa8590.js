/* =========================================================================
   PRODUCT TIMELINE — 应用入口：路由、导航、全局交互
   ========================================================================= */

import {
  state, API, $, $$, navigate, routePath, initReveal, applyTheme, avatarHtml, escapeHtml, toast,
} from './core.63f0a3ede4.js';
import * as V from './views.4cdc99091c.js';

const app = $('#app');
const nav = $('#site-nav');
const navToggle = $('#nav-toggle');
const quickPublish = $('#quick-publish');

/**
 * 打开即用：访客静默进入共享演示档案，登录页不再是必经门槛。
 * 后端认证与多用户隔离仍然保留；主动退出后不会自动重新进入。
 */
let pendingDemo = null;
async function ensureDemoSession() {
  if (state.user) return true;
  if (pendingDemo) return pendingDemo;
  pendingDemo = (async () => {
    try {
      const res = await API.login('demo', 'demo1234');
      state.user = res.user;
      return true;
    } catch {
      return false;
    } finally {
      pendingDemo = null;
    }
  })();
  return pendingDemo;
}

function updateNav() {
  const path = routePath();
  const u = state.user;
  const active = (href) => (href === '/' ? path === '/' || path.startsWith('/u/') || path.startsWith('/category/') : path.startsWith(href));
  const links = [
    `<a class="nav-link ${active('/') ? 'is-active' : ''}" href="/" data-link>时间线</a>`,
    u ? `<a class="nav-link ${active('/settings') ? 'is-active' : ''}" href="/settings" data-link>设置</a>` : '',
    u ? `<a class="nav-user" href="/settings" data-link>${avatarHtml(u, 'nav-user__avatar')}<span>@${escapeHtml(u.username)}</span></a>` : '',
  ].filter(Boolean).join('');
  nav.innerHTML = links;
  quickPublish.setAttribute('href', '/publish');
  quickPublish.setAttribute('aria-label', '发布作品（上传新作品）');
  nav.classList.remove('is-open');
  navToggle.setAttribute('aria-expanded', 'false');
}

async function resolveRoute() {
  const path = routePath();
  const query = new URLSearchParams(location.search);
  let match;

  if (path === '/' || path === '/index.html') {
    return V.homeView({ username: state.user ? state.user.username : undefined, category: 'all' });
  }
  if ((match = /^\/u\/([^/]+)\/category\/([^/]+)$/.exec(path))) {
    return V.homeView({ username: match[1], category: match[2] });
  }
  if ((match = /^\/u\/([^/]+)\/?$/.exec(path))) {
    return V.homeView({ username: match[1], category: 'all' });
  }
  if ((match = /^\/category\/([^/]+)\/?$/.exec(path))) {
    return V.homeView({ username: state.user ? state.user.username : undefined, category: match[1] });
  }
  if (path === '/publish') {
    await ensureDemoSession();
    return V.publishView();
  }
  if ((match = /^\/p\/([^/]+)\/?$/.exec(path))) return V.detailView(match[1]);
  if (path === '/settings') return V.settingsView();
  if (path === '/login') return V.authView(query.get('mode'));
  return V.notFoundView();
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  updateNav();
  app.innerHTML = `<div class="wrap"><div class="state"><div class="skeleton skeleton-line" style="width:32%"></div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-line" style="width:52%"></div></div></div>`;
  try {
    const view = await resolveRoute();
    if (token !== routeToken) return;
    app.innerHTML = view.html;
    document.title = view.title || 'PRODUCT TIMELINE';
    if (view.init) view.init();
    initReveal(app);
    app.focus({ preventScroll: true });
  } catch (err) {
    if (token !== routeToken) return;
    app.innerHTML = `<div class="wrap"><div class="state"><div class="state__glyph">!</div>
      <h3 class="state__title">载入失败</h3>
      <p class="state__text">${escapeHtml(err.message || '请稍后重试')}</p>
      <button class="btn" id="retry-btn">重新载入</button></div></div>`;
    const retry = $('#retry-btn');
    if (retry) retry.addEventListener('click', route);
  }
  window.scrollTo(0, 0);
  updateFooterTime();
}

async function updateFooterTime() {
  try {
    const res = await API.serverTime();
    state.serverTime = res.iso;
    const el = $('#footer-time');
    if (el) el.textContent = `SERVER · ${res.iso.slice(0, 19).replace('T', ' ')} UTC`;
  } catch { /* 页脚时间不影响功能 */ }
}

/* ── 全局事件 ─────────────────────────────────────────────────────────── */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http')) return;
  e.preventDefault();
  if (nav.contains(link)) nav.classList.remove('is-open');
  navigate(href);
});

navToggle.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(open));
});

window.addEventListener('popstate', route);
window.addEventListener('pt:navigate', route);
window.addEventListener('pt:user-change', updateNav);

/* ── 启动 ─────────────────────────────────────────────────────────────── */
async function boot() {
  const savedTheme = localStorage.getItem('pt-theme') || 'light';
  applyTheme(savedTheme);
  try {
    const [me, categories] = await Promise.all([API.me(), API.categories()]);
    state.user = me.user;
    state.categories = categories.categories;
  } catch (err) {
    toast('无法连接服务端，部分功能不可用', 'error');
  }
  if (!state.user && !localStorage.getItem('pt-manual-logout')) {
    await ensureDemoSession();
  }
  if (state.user) applyTheme(state.user.theme || 'light');
  document.addEventListener('pt:theme-change', (e) => {
    localStorage.setItem('pt-theme', e.detail);
    applyTheme(e.detail);
  });
  await route();
}

boot();

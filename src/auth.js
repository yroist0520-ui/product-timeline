'use strict';

/** 密码哈希与会话 Cookie（httpOnly + SameSite=Lax，令牌只以哈希形式入库）。 */

const crypto = require('node:crypto');
const { config } = require('./config');
const { parseCookies } = require('./http');

const COOKIE_NAME = 'pt_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * 会话令牌来源：同源站点用 httpOnly Cookie；可信独立前端（GitHub Pages）
 * 在第三方上下文里无法依赖 Cookie，改用 Authorization: Bearer。
 * 两种载体最终都落到同一张 sessions 表，权限与数据隔离完全一致。
 */
function sessionToken(req) {
  const header = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim().slice(0, 200);
  return parseCookies(req)[COOKIE_NAME] || '';
}

function setSessionCookie(res, token) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(config.SESSION_TTL_MS / 1000)}`,
  ].join('; ');
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * CSRF 防护。
 *
 * 线上服务位于反向代理之后：浏览器看到的 Origin 是公网域名，而 Node 收到的
 * Host 常被改写为内部地址。早期版本只比较两者，导致所有同源写请求（登录、
 * 注册、发布作品）都被误判为「跨站请求被拒绝」。
 *
 * 现在的判定顺序：
 *   1. Fetch Metadata（Sec-Fetch-Site）优先，现代浏览器可精确区分同站/跨站；
 *   2. 无 Origin 的原生请求放行（跨站表单无法伪造 JSON 请求，Cookie 为 SameSite=Lax）；
 *   3. Origin 与可信 host 比对：Host / X-Forwarded-Host / 配置的公网 Origin；
 *   4. 仅当确认处于代理链路（转发头存在）且 Host 为内部地址时，放行 https 的公网 Origin。
 */
/** 是否来自配置的独立前端白名单（GitHub Pages 等）。 */
function trustedFrontend(req) {
  const origin = String(req.headers.origin || '');
  return Boolean(origin) && config.CORS_ORIGINS.includes(origin);
}

function originAllowed(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  // 白名单前端天然是跨站请求，但携带服务端签发的 Bearer 令牌，属于可信调用方。
  if (site === 'cross-site') return trustedFrontend(req);
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return true;

  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true; // 原生请求 / 沙箱 WebView 无可用 Origin

  if (trustedFrontend(req)) return true;

  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const originHost = parsed.host;

  const trusted = new Set();
  if (req.headers.host) trusted.add(req.headers.host);
  const forwardedHost = req.headers['x-forwarded-host'];
  if (forwardedHost) {
    forwardedHost.split(',').forEach((h) => { if (h.trim()) trusted.add(h.trim()); });
  }
  for (const base of config.PUBLIC_ORIGINS) {
    try { trusted.add(new URL(base).host); } catch { /* 忽略无效配置 */ }
  }
  if (trusted.has(originHost)) return true;

  // 代理改写 Host 的兜底：只在明确存在转发头、且后端 Host 是内部地址时生效。
  // 本地直连/测试环境没有转发头，恶意 Origin 依旧会被拒绝。
  const proxied = Boolean(forwardedHost || req.headers['x-forwarded-proto']);
  const hostIsInternal = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.:]+$)/i.test(String(req.headers.host || ''));
  if (proxied && hostIsInternal && parsed.protocol === 'https:') return true;

  return false;
}

function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

module.exports = {
  COOKIE_NAME, hashPassword, verifyPassword, sessionToken,
  setSessionCookie, clearSessionCookie, originAllowed, trustedFrontend, validUsername,
};

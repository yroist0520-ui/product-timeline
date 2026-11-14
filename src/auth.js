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

function sessionToken(req) {
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

/** 简易 CSRF 防护：跨站表单无法伪造 Origin 头。 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 同源 GET / 无 Origin 的原生请求
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return host === req.headers.host;
}

function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

module.exports = {
  COOKIE_NAME, hashPassword, verifyPassword, sessionToken,
  setSessionCookie, clearSessionCookie, originAllowed, validUsername,
};

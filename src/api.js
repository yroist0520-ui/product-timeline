'use strict';

/**
 * REST API。
 *
 * 安全边界：
 * - 作品只有 GET（读）和 POST /api/products（追加）。不存在 PUT / PATCH / DELETE 的作品端点；
 *   对已发布记录的任何改写请求都会被明确拒绝并写入审计日志。
 * - 发布时的 user_id 强制来自会话，created_at 强制来自数据库时钟；请求体里出现的时间字段
 *   一律忽略并记录尝试，客户端系统时间对档案没有任何影响。
 * - 每条记录通过 client_token 幂等，防止重复提交产生两条档案。
 */

const { config, CATEGORIES } = require('./config');
const db = require('./db');
const auth = require('./auth');
const { sendJson, sendError, readBody, readJson, serveStatic } = require('./http');
const { parseMultipart, multipartBoundary, storeImage } = require('./upload');

const TIME_FIELDS = ['created_at', 'createdAt', 'timestamp', 'publishedAt', 'publishTime', 'date', 'time'];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireUser(req) {
  const user = db.sessionUser(auth.sessionToken(req));
  if (!user) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  return user;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

/** 解析 multipart 请求，返回文本字段与图片文件（按前端提交顺序）。 */
async function parsePost(req) {
  const boundary = multipartBoundary(req);
  if (!boundary) throw new HttpError(400, 'BAD_CONTENT_TYPE', '请使用 multipart/form-data 提交');
  const raw = await readBody(req, config.MAX_UPLOAD_BYTES * config.MAX_FILES_PER_POST + 1024 * 1024);
  const parts = parseMultipart(raw, boundary);
  const fields = {};
  const files = [];
  for (const part of parts) {
    if (part.filename !== null) {
      if (part.name === 'images' && part.data.length > 0) files.push(part);
      else if (part.name === 'avatar' && part.data.length > 0) files.push(part);
    } else if (part.name) {
      fields[part.name] = part.data.toString('utf8');
    }
  }
  return { fields, files };
}

function sanitizePost(fields) {
  const title = String(fields.title || '').trim().slice(0, 120);
  const category = String(fields.category || '').trim();
  const description = String(fields.description || '').trim().slice(0, 2000);
  const clientToken = String(fields.clientToken || '').trim().slice(0, 100) || 'AUTO-' + db.randomId(16);
  if (!title) throw new HttpError(400, 'TITLE_REQUIRED', '请填写作品名称');
  if (!CATEGORIES.some((c) => c.slug === category)) {
    throw new HttpError(400, 'CATEGORY_INVALID', '请选择一个有效的产品分类');
  }
  return { title, category, description, clientToken };
}

async function handleApi(req, res, pathname, url) {
  const method = req.method.toUpperCase();

  if (!auth.originAllowed(req)) {
    throw new HttpError(403, 'CSRF_REJECTED', '跨站请求被拒绝');
  }

  // ── 基础信息 ───────────────────────────────────────────────────────────
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, server: 'PRODUCT TIMELINE', serverTime: db.serverNow().iso });
  }
  if (pathname === '/api/server-time' && method === 'GET') {
    return sendJson(res, 200, { ok: true, ...db.serverNow(), source: 'database:strftime(now)', timezone: 'UTC' });
  }
  if (pathname === '/api/categories' && method === 'GET') {
    return sendJson(res, 200, { ok: true, categories: CATEGORIES });
  }

  // ── 认证 ───────────────────────────────────────────────────────────────
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 40) || username;
    if (!auth.validUsername(username)) {
      throw new HttpError(400, 'USERNAME_INVALID', '账号需为 3–24 位字母、数字或下划线');
    }
    if (password.length < 6 || password.length > 128) {
      throw new HttpError(400, 'PASSWORD_INVALID', '密码长度需为 6–128 位');
    }
    if (db.getUserByUsername(username)) {
      throw new HttpError(409, 'USERNAME_TAKEN', '该账号已被注册');
    }
    const user = db.createUser({
      username, displayName, passwordHash: auth.hashPassword(password),
      timezone: typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : '',
    });
    const token = db.createSession(user.id);
    db.audit('auth.login', { actor: user.id, target: user.id, detail: 'register', ip: clientIp(req) });
    return sendJson(res, 201, { ok: true, user: db.publicUser(user) }, {
      'Set-Cookie': auth.setSessionCookie(res, token),
    });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const user = db.getUserByUsername(username);
    if (!user || !auth.verifyPassword(String(body.password || ''), user.password_hash)) {
      db.audit('auth.login_failed', { target: username, ip: clientIp(req) });
      throw new HttpError(401, 'AUTH_FAILED', '账号或密码不正确');
    }
    const token = db.createSession(user.id);
    db.audit('auth.login', { actor: user.id, target: user.id, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, user: db.publicUser(user) }, {
      'Set-Cookie': auth.setSessionCookie(res, token),
    });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const user = db.sessionUser(auth.sessionToken(req));
    db.destroySession(auth.sessionToken(req));
    if (user) db.audit('auth.logout', { actor: user.id, target: user.id, ip: clientIp(req) });
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSessionCookie() });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = db.sessionUser(auth.sessionToken(req));
    return sendJson(res, 200, { ok: true, user: db.publicUser(user) });
  }

  // ── 个人主页与时间线（公开只读） ──────────────────────────────────────
  let match;
  if ((match = /^\/api\/profile\/([^/]+)$/.exec(pathname)) && method === 'GET') {
    const profile = db.getProfile(decodeURIComponent(match[1]));
    if (!profile) throw new HttpError(404, 'USER_NOT_FOUND', '未找到该用户');
    return sendJson(res, 200, { ok: true, ...profile, serverTime: db.serverNow().iso });
  }

  if ((match = /^\/api\/timeline\/([^/]+)$/.exec(pathname)) && method === 'GET') {
    const profile = db.getProfile(decodeURIComponent(match[1]));
    if (!profile) throw new HttpError(404, 'USER_NOT_FOUND', '未找到该用户');
    const category = String(url.searchParams.get('category') || '');
    if (category && !CATEGORIES.some((c) => c.slug === category)) {
      throw new HttpError(400, 'CATEGORY_INVALID', '无效的分类');
    }
    const limit = Number(url.searchParams.get('limit') || 60);
    const before = String(url.searchParams.get('before') || '');
    const products = db.getProducts({ userId: profile.user.id, category, limit, before });
    const last = products[products.length - 1];
    const nextCursor = products.length === Math.min(Math.max(limit, 1), 200) && last
      ? `${last.createdAt}|${last.seq}` : null;
    return sendJson(res, 200, {
      ok: true, products, nextCursor, serverTime: db.serverNow().iso,
      category: category || 'all', timeSource: 'server (UTC stored)',
    });
  }

  // ── 作品详情 ───────────────────────────────────────────────────────────
  if ((match = /^\/api\/products\/([^/]+)$/.exec(pathname))) {
    const id = decodeURIComponent(match[1]);
    if (method === 'GET') {
      const product = db.getProductById(id);
      if (!product) throw new HttpError(404, 'NOT_FOUND', '未找到该记录');
      const author = db.getUserById(product.userId);
      return sendJson(res, 200, {
        ok: true, product,
        author: author ? db.publicUser(author) : null,
        immutable: true, serverTime: db.serverNow().iso,
      });
    }
    // 任何针对已发布记录的改写 / 删除请求：拒绝 + 审计。数据库触发器是第二道锁。
    if (['PUT', 'PATCH', 'DELETE', 'POST'].includes(method)) {
      db.audit('product.mutation_rejected', {
        actor: (db.sessionUser(auth.sessionToken(req)) || {}).id || 'anonymous',
        target: id, detail: `${method} ${pathname}`, ip: clientIp(req),
      });
      throw new HttpError(405, 'IMMUTABLE_RECORD',
        '发布记录已永久锁定：内容、图片与发布时间均不可修改或删除。如需更正，请发布一条新作品。');
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
  }

  // ── 发布作品（唯一允许的写入） ────────────────────────────────────────
  if (pathname === '/api/products' && method === 'POST') {
    const user = requireUser(req);
    const { fields, files } = await parsePost(req);
    const payload = sanitizePost(fields);
    if (!files.length) throw new HttpError(400, 'IMAGE_REQUIRED', '请至少上传一张产品图片');
    if (files.length > config.MAX_FILES_PER_POST) {
      throw new HttpError(400, 'TOO_MANY_IMAGES', `单条作品最多 ${config.MAX_FILES_PER_POST} 张图片`);
    }

    // 客户端试图携带自定义时间：忽略，并留下审计痕迹。
    const attempted = TIME_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(fields, f));
    if (attempted.length) {
      db.audit('product.time_override_attempt', {
        actor: user.id, target: payload.clientToken,
        detail: `ignored fields: ${attempted.join(',')}`, ip: clientIp(req),
      });
    }
    // 客户端试图指定 user_id：忽略。
    if (fields.user_id || fields.userId) {
      db.audit('product.owner_override_attempt', { actor: user.id, target: payload.clientToken, ip: clientIp(req) });
    }

    // 图片先落盘；内容寻址保证不会覆盖任何已有文件。
    const images = files.map((file) => {
      try {
        return storeImage(file.data);
      } catch (err) {
        throw new HttpError(err.status || 400, 'IMAGE_REJECTED',
          `图片「${(file.filename || '').slice(0, 60)}」上传失败：${err.message}`);
      }
    });

    const { product, duplicate } = db.createProduct(user.id, { ...payload, images });
    if (!duplicate) {
      // 每次真实发布后生成一致性备份快照。
      db.backup('publish');
    }
    return sendJson(res, duplicate ? 200 : 201, {
      ok: true, product, duplicate,
      notice: '该记录已写入永久档案，内容、图片与发布时间均不可修改。',
    });
  }

  if (pathname === '/api/products' && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
    db.audit('product.mutation_rejected', {
      actor: (db.sessionUser(auth.sessionToken(req)) || {}).id || 'anonymous',
      detail: `${method} /api/products`, ip: clientIp(req),
    });
    throw new HttpError(405, 'IMMUTABLE_RECORD', '发布记录不可修改或删除');
  }

  // ── 个人资料（可修改，但不影响任何历史作品） ─────────────────────────
  if (pathname === '/api/me' && method === 'PATCH') {
    const user = requireUser(req);
    const body = await readJson(req);
    const patch = {};
    if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim().slice(0, 40) || user.display_name;
    if (typeof body.bio === 'string') patch.bio = body.bio.trim().slice(0, 200);
    if (typeof body.timezone === 'string') patch.timezone = body.timezone.slice(0, 64);
    if (body.theme === 'light' || body.theme === 'dark') patch.theme = body.theme;
    if (typeof body.showSeconds === 'boolean') patch.showSeconds = body.showSeconds ? 1 : 0;
    const updated = db.updateUser(user.id, patch);
    return sendJson(res, 200, { ok: true, user: db.publicUser(updated) });
  }

  if (pathname === '/api/me/avatar' && method === 'POST') {
    const user = requireUser(req);
    const { files } = await parsePost(req);
    const file = files.find((f) => f.name === 'avatar');
    if (!file) throw new HttpError(400, 'IMAGE_REQUIRED', '请选择头像图片');
    let stored;
    try { stored = storeImage(file.data); }
    catch (err) { throw new HttpError(err.status || 400, 'IMAGE_REJECTED', err.message); }
    const updated = db.updateUser(user.id, { avatar: stored.imageUrl });
    return sendJson(res, 200, { ok: true, user: db.publicUser(updated), avatar: stored.imageUrl });
  }

  // ── 完整性校验与审计（登录用户可见） ─────────────────────────────────
  if (pathname === '/api/verify' && method === 'GET') {
    const user = requireUser(req);
    return sendJson(res, 200, { ok: true, report: db.verifyChain(user.id), serverTime: db.serverNow().iso });
  }

  if (pathname === '/api/audit' && method === 'GET') {
    const user = requireUser(req);
    const rows = db.getDb()
      .prepare('SELECT action, target, detail, created_at FROM audit_log WHERE actor = ? ORDER BY id DESC LIMIT 100')
      .all(user.id);
    return sendJson(res, 200, { ok: true, events: rows });
  }

  throw new HttpError(404, 'NOT_FOUND', '接口不存在');
}

module.exports = { handleApi, HttpError, requireUser };

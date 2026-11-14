'use strict';

/** 零依赖 HTTP 工具：响应、请求体、静态文件（含目录穿越防护）。 */

const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 可信独立前端（如 GitHub Pages）的 CORS 响应头。
 * 只有配置白名单内的源才会被回显，且不使用 Cookie 凭据（改用 Bearer 令牌）。
 * 结果由 server.js 挂到 res._ptCors，所有 API 响应都会自动带上。
 */
function corsHeaders(req) {
  const origin = String(req.headers.origin || '');
  if (!origin || !config.CORS_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(res._ptCors || {}),
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) { done = true; resolve(Buffer.concat(chunks)); }
    });
    req.on('error', (err) => {
      if (!done) { done = true; reject(err); }
    });
  });
}

async function readJson(req) {
  const body = await readBody(req, config.MAX_JSON_BYTES);
  if (!body.length) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw Object.assign(new Error('JSON 格式不正确'), { status: 400 });
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

/** 只允许访问 public/ 与 uploads/ 下的真实文件，拒绝 .. 与符号链接逃逸。 */
function resolveStatic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  decoded = decoded.replace(/\\/g, '/');
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;

  let base;
  let rel;
  if (decoded.startsWith('/media/')) {
    base = config.UPLOAD_DIR;
    rel = decoded.slice('/media/'.length);
  } else {
    base = config.PUBLIC_DIR;
    rel = decoded.replace(/^\/+/, '') || 'index.html';
  }
  const full = path.resolve(base, rel);
  if (!full.startsWith(path.resolve(base) + path.sep)) return null;
  return full;
}

function serveStatic(req, res, urlPath) {
  const full = resolveStatic(urlPath);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  const stat = fs.statSync(full);
  const isMedia = full.startsWith(path.resolve(config.UPLOAD_DIR) + path.sep);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': isMedia ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(res._ptCors || {}),
  };
  res.writeHead(200, headers);
  fs.createReadStream(full).pipe(res);
  return true;
}

module.exports = {
  sendJson, sendError, readBody, readJson, parseCookies, serveStatic, resolveStatic, MIME, corsHeaders,
};

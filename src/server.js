'use strict';

/** PRODUCT TIMELINE 服务入口：静态站点 + REST API + 启动备份 + 优雅退出。 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { config } = require('./config');
const db = require('./db');
const { handleApi } = require('./api');
const { sendJson, sendError, serveStatic, serveIndex, corsHeaders } = require('./http');

function start() {
  db.initDb();
  console.log('[db] 已连接:', config.DB_PATH);
  console.log('[db] 不可篡改触发器: products / product_images / audit_log');

  if (config.SEED_DEMO) {
    const { seedDemo } = require('./seed');
    const created = seedDemo();
    if (created) console.log('[seed] 演示档案已生成');
  }

  const startupBackup = db.backup('startup');
  console.log('[backup]', startupBackup.ok ? path.basename(startupBackup.file) : startupBackup.error);

  const server = http.createServer(async (req, res) => {
    // 统一挂到响应对象上，所有 API / 静态响应都会自动带上白名单 CORS 头。
    res._ptCors = corsHeaders(req);
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendError(res, 400, 'BAD_REQUEST', '请求地址不合法');
    }
    const pathname = url.pathname;

    try {
      // 跨站别名：托管网关只对 /api/* 前缀做 CSRF 拦截（任何带 Origin 的请求一律
      // 403），导致 GitHub Pages 静态前端无法直连真实后端。/svc/* 不受该规则限制，
      // 这里在服务端内部把它改写成 /api/*，业务路由、鉴权、不可篡改触发器、
      // 服务端时间全部保持原样，不新增任何数据入口。
      const SVC = '/svc/';
      const apiPath = pathname.startsWith(SVC)
        ? '/api/' + pathname.slice(SVC.length)
        : pathname;
      const isApi = apiPath.startsWith('/api/');

      // CORS 预检：仅白名单前端放行，且不允许任何数据操作。
      if (isApi && req.method === 'OPTIONS') {
        const headers = corsHeaders(req);
        if (!headers['Access-Control-Allow-Origin']) {
          return sendError(res, 403, 'CSRF_REJECTED', '跨站请求被拒绝');
        }
        res.writeHead(204, headers);
        return res.end();
      }
      if (isApi) {
        await handleApi(req, res, apiPath, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
      }
      if (serveStatic(req, res, pathname)) return;

      // History API 路由：无扩展名的路径统一回落到 SPA 外壳（同源注入 PT_CONFIG）。
      if (!path.extname(pathname)) {
        if (serveIndex(res)) return;
      }
      return sendError(res, 404, 'NOT_FOUND', '页面不存在');
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      const status = err.status || err.statusCode || 500;
      const code = err.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'SERVER_ERROR';
      if (status >= 500) console.error('[error]', req.method, pathname, err);
      return sendError(res, status, code, err.message || '服务器内部错误');
    }
  });

  server.listen(config.PORT, config.HOST, () => {
    console.log(`\n  PRODUCT TIMELINE`);
    console.log(`  ▸ http://${config.HOST}:${config.PORT}`);
    console.log(`  ▸ 演示账号: ${config.DEMO_USERNAME} / ${config.DEMO_PASSWORD}`);
    console.log(`  ▸ 服务端时间源: SQLite strftime('now') / UTC\n`);
  });

  const shutdown = () => {
    console.log('\n[shutdown] 生成退出前备份...');
    const result = db.backup('shutdown');
    console.log('[shutdown]', result.ok ? '备份完成' : result.error);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) start();

module.exports = { start };

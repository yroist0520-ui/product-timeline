'use strict';

/** PRODUCT TIMELINE 服务入口：静态站点 + REST API + 启动备份 + 优雅退出。 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { config } = require('./config');
const db = require('./db');
const { handleApi } = require('./api');
const { sendJson, sendError, serveStatic } = require('./http');

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
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendError(res, 400, 'BAD_REQUEST', '请求地址不合法');
    }
    const pathname = url.pathname;

    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
      }
      if (serveStatic(req, res, pathname)) return;

      // History API 路由：无扩展名的路径统一回落到 SPA 外壳。
      if (!path.extname(pathname)) {
        const shell = path.join(config.PUBLIC_DIR, 'index.html');
        if (fs.existsSync(shell)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          fs.createReadStream(shell).pipe(res);
          return;
        }
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

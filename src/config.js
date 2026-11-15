'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  ROOT,
  PORT: Number(process.env.PORT || 4173),
  HOST: process.env.HOST || '0.0.0.0',
  // 反向代理后的公网 Origin（逗号分隔）。部署时显式声明，CSRF 校验无需依赖被改写的 Host。
  PUBLIC_ORIGINS: (process.env.PT_PUBLIC_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  // 允许调用本 API 的独立前端源（逗号分隔），例如 GitHub Pages 站点。
  // 这些源使用 Bearer 令牌而非 Cookie，因此不受 SameSite / 第三方 Cookie 限制。
  // 默认内置本站的 GitHub Pages 源，让 github.io 静态前端可直接调用真实后端。
  // 无论部署环境是否设置环境变量，都保留 github.io 静态前端这一可信源。
  CORS_ORIGINS: Array.from(new Set([
    'https://yroist0520-ui.github.io',
    ...(process.env.PT_CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  ])),
  DATA_DIR: process.env.PT_DATA_DIR || path.join(ROOT, 'data'),
  DB_PATH: process.env.PT_DB || path.join(ROOT, 'data', 'timeline.sqlite'),
  BACKUP_DIR: process.env.PT_BACKUP_DIR || path.join(ROOT, 'data', 'backups'),
  UPLOAD_DIR: process.env.PT_UPLOAD_DIR || path.join(ROOT, 'uploads'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  // 同源部署（前端与 API 同一 origin）时注入到 index.html 的分享码。
  // 网关要求每个请求带 ?sharecode 或持有 __wb_rsc cookie；首屏带一次分享码拿到
  // cookie 后，后续同源的子资源 / API 请求凭 cookie 即可被放行，从而绕开跨站 CSRF 拦截。
  SHARECODE: process.env.PT_SHARECODE || 'RTB3TFEX2S',
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  MAX_FILES_PER_POST: 9,
  MAX_JSON_BYTES: 256 * 1024,
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  BACKUP_KEEP: 20,
  SEED_DEMO: process.env.SEED_DEMO !== '0',
  DEMO_USERNAME: 'demo',
  DEMO_PASSWORD: 'demo1234',
};

// 预设分类。新增分类只需在此追加一行，数据库会在启动时自动同步。
const CATEGORIES = [
  { slug: 'square', name: '方图' },
  { slug: 'wallpaper', name: '壁纸' },
  { slug: 'watermark', name: '水印' },
  { slug: 'base', name: '底素' },
  { slug: 'scraps', name: '边角料' },
  { slug: 'photo', name: '实拍' },
  { slug: 'watermark-base', name: '水印素' },
  { slug: 'brush-base', name: '素刷' },
  { slug: 'brush', name: '笔刷' },
  { slug: 'preview-template', name: '预览模板' },
  { slug: 'other', name: '其他' },
];

const ALLOWED_IMAGE_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

module.exports = { config, CATEGORIES, ALLOWED_IMAGE_MIME };

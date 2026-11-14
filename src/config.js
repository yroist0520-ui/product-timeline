'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  ROOT,
  PORT: Number(process.env.PORT || 4173),
  HOST: process.env.HOST || '127.0.0.1',
  DATA_DIR: process.env.PT_DATA_DIR || path.join(ROOT, 'data'),
  DB_PATH: process.env.PT_DB || path.join(ROOT, 'data', 'timeline.sqlite'),
  BACKUP_DIR: process.env.PT_BACKUP_DIR || path.join(ROOT, 'data', 'backups'),
  UPLOAD_DIR: process.env.PT_UPLOAD_DIR || path.join(ROOT, 'uploads'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  MAX_UPLOAD_BYTES: 12 * 1024 * 1024,
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

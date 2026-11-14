'use strict';

/**
 * 由 public/ 生成 GitHub Pages 站点 docs/。
 *
 * GitHub Pages 只能托管静态文件，因此这里复制同一套前端代码，并注入
 * PT_CONFIG 让页面直接调用真实后端（Bearer 令牌 + 分享码）：
 *   - 界面、分类、时间线、发布、详情、设置与主站完全一致；
 *   - 发布时间、哈希链、图片存储、不可篡改触发器仍在服务端；
 *   - 404.html 作为 SPA 兜底，支持子路径刷新；
 *   - 单一代码来源，避免 docs/ 与 public/ 视觉或功能分叉。
 *
 * 用法：npm run build:pages
 * 可用环境变量覆盖：PT_PAGES_API / PT_PAGES_SHARECODE / PT_PAGES_BASE
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DOCS_DIR = path.join(ROOT, 'docs');

const API_BASE = (process.env.PT_PAGES_API || 'https://wbapp-ijb1eofcihfnvqostmjo0u.app.workbuddy.host').replace(/\/$/, '');
// 显式空字符串用于本地模拟（本地后端不需要分享码），因此不能用 || 回退。
const SHARECODE = process.env.PT_PAGES_SHARECODE !== undefined
  ? process.env.PT_PAGES_SHARECODE
  : 'RTB3TFEX2S';
const BASE_PATH = process.env.PT_PAGES_BASE || '/product-timeline/';

const pageConfig = { apiBase: API_BASE, sharecode: SHARECODE, basePath: BASE_PATH };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(rel, targetRel = rel) {
  const from = path.join(PUBLIC_DIR, rel);
  const to = path.join(DOCS_DIR, targetRel);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return to;
}

function buildShell() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const inject = `<head>\n  <base href="${BASE_PATH}">\n  <script>window.PT_CONFIG = ${JSON.stringify(pageConfig)};</script>`;
  html = html.replace('<head>', inject);
  // <base> 已指向站点根，静态资源改用相对路径，子路径刷新时也能正确解析。
  html = html.replace('href="/css/styles.css"', 'href="css/styles.css"');
  html = html.replace('src="/js/app.js"', 'src="js/app.js"');
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="PRODUCT TIMELINE 网站使用界面：浏览时间线、按分类筛选、发布并永久锁定作品记录。">',
  );
  return html;
}

function main() {
  ensureDir(DOCS_DIR);
  const shell = buildShell();

  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), shell, 'utf8');
  // GitHub Pages 对不存在的子路径会返回 404.html；用 SPA 外壳兜底，
  // 让 /product-timeline/publish 之类的地址刷新后仍能正常渲染。
  fs.writeFileSync(path.join(DOCS_DIR, '404.html'), shell, 'utf8');
  // 跳过 Jekyll 处理，确保静态文件名原样发布。
  fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '', 'utf8');

  copyFile('css/styles.css');
  for (const name of fs.readdirSync(path.join(PUBLIC_DIR, 'js'))) {
    if (name.endsWith('.js')) copyFile(path.join('js', name));
  }

  console.log('[pages] 已生成 docs/');
  console.log('[pages] 入口      :', `${BASE_PATH} (index.html + 404.html)`);
  console.log('[pages] 后端 API  :', API_BASE);
  console.log('[pages] 前端文件  :', fs.readdirSync(path.join(DOCS_DIR, 'js')).length, '个 JS + styles.css');
}

main();

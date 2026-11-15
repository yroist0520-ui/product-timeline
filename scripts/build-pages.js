'use strict';

/**
 * 由 public/ 生成 GitHub Pages 站点 docs/。
 *
 * GitHub Pages 只能托管静态文件，因此这里复制同一套前端代码，并注入
 * PT_CONFIG 让页面直接调用真实后端（会话令牌 + 分享码）：
 *   - 界面、分类、时间线、发布、详情、设置与主站完全一致；
 *   - 发布时间、哈希链、图片存储、不可篡改触发器仍在服务端；
 *   - 404.html 作为 SPA 兜底，支持子路径刷新；
 *   - 静态资源采用内容哈希文件名。GitHub Pages 的 CDN 缓存 10 分钟，
 *     若 HTML 已更新而 JS 仍是旧版，会出现白屏；内容寻址文件名可避免错配。
 *   - 上一代哈希文件名会以「当前内容」保留一份：被 CDN 缓存的旧 HTML 仍能
 *     加载到新版资源，不会因为旧哈希文件被删除而 404 / 无样式。
 *
 * 用法：npm run build:pages
 * 可用环境变量覆盖：PT_PAGES_API / PT_PAGES_SHARECODE / PT_PAGES_BASE
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
const digest = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const read = (rel) => fs.readFileSync(path.join(PUBLIC_DIR, rel));

function buildShell(names) {
  let html = read('index.html').toString('utf8');
  const inject = `<head>\n  <base href="${BASE_PATH}">\n  <script>window.PT_CONFIG = ${JSON.stringify(pageConfig)};</script>`;
  html = html.replace('<head>', inject);
  // <base> 已指向站点根，静态资源改用相对路径，子路径刷新时也能正确解析。
  html = html.replace('href="/css/styles.css"', `href="css/${names.css}"`);
  html = html.replace('src="/js/app.js"', `src="js/${names.app}"`);
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="PRODUCT TIMELINE 网站使用界面：浏览时间线、按分类筛选、发布并永久锁定作品记录。">',
  );
  return html;
}

/** 读取上一次构建留下的哈希文件名，供 CDN 缓存窗口内的旧 HTML 继续命中。 */
function previousHashedAssets() {
  const found = { css: [], core: [], views: [], app: [] };
  const patterns = [
    ['css', 'css', /^styles\.[0-9a-f]+\.css$/],
    ['js', 'core', /^core\.[0-9a-f]+\.js$/],
    ['js', 'views', /^views\.[0-9a-f]+\.js$/],
    ['js', 'app', /^app\.[0-9a-f]+\.js$/],
  ];
  for (const [dir, kind, re] of patterns) {
    const base = path.join(DOCS_DIR, dir);
    if (!fs.existsSync(base)) continue;
    found[kind].push(...fs.readdirSync(base).filter((name) => re.test(name)));
  }
  return found;
}

function main() {
  const previous = previousHashedAssets();
  const css = read('css/styles.css');
  const core = read('js/core.js').toString('utf8');
  const views = read('js/views.js').toString('utf8');
  const app = read('js/app.js').toString('utf8');

  const names = {
    css: `styles.${digest(css)}.css`,
    core: `core.${digest(core)}.js`,
    views: `views.${digest(views)}.js`,
    app: `app.${digest(app)}.js`,
  };

  // 模块内部 import 同步改写为哈希文件名；core 在两处必须指向同一 URL，
  // 否则浏览器会加载两份模块实例、state 将不再共享。
  const viewsOut = views.replace(/from '\.\/core\.js'/g, `from './${names.core}'`);
  const appOut = app
    .replace(/from '\.\/core\.js'/g, `from './${names.core}'`)
    .replace(/from '\.\/views\.js'/g, `from './${names.views}'`);

  // 清空旧产物，避免历史哈希文件堆积在仓库里。
  fs.rmSync(path.join(DOCS_DIR, 'js'), { recursive: true, force: true });
  fs.rmSync(path.join(DOCS_DIR, 'css'), { recursive: true, force: true });
  fs.mkdirSync(path.join(DOCS_DIR, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DOCS_DIR, 'css'), { recursive: true });

  // 演示素材的真实照片随站点一起发布，避免每张图都绕道应用网关。
  const assetsSrc = path.join(PUBLIC_DIR, 'assets');
  const assetsDst = path.join(DOCS_DIR, 'assets');
  if (fs.existsSync(assetsSrc)) {
    fs.rmSync(assetsDst, { recursive: true, force: true });
    fs.cpSync(assetsSrc, assetsDst, { recursive: true });
  }

  // HEIC/HEIF 浏览器解码组件：只在用户真的选中这类照片时才按需加载，
  // 因此不参与入口资源哈希，但需要随静态站点一起发布。
  const vendorSrc = path.join(PUBLIC_DIR, 'vendor');
  const vendorDst = path.join(DOCS_DIR, 'vendor');
  if (fs.existsSync(vendorSrc)) {
    fs.rmSync(vendorDst, { recursive: true, force: true });
    fs.cpSync(vendorSrc, vendorDst, { recursive: true });
  }

  // 浏览器仍会按惯例请求站点根目录的 favicon.ico，避免子路径下 404。
  const ico = path.join(PUBLIC_DIR, 'favicon.ico');
  if (fs.existsSync(ico)) fs.copyFileSync(ico, path.join(DOCS_DIR, 'favicon.ico'));

  const shell = buildShell(names);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), shell, 'utf8');
  // GitHub Pages 对不存在的子路径会返回 404.html；用 SPA 外壳兜底，
  // 让 /product-timeline/publish 之类的地址刷新后仍能正常渲染。
  fs.writeFileSync(path.join(DOCS_DIR, '404.html'), shell, 'utf8');
  // 跳过 Jekyll 处理，确保静态文件名原样发布。
  fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '', 'utf8');

  fs.writeFileSync(path.join(DOCS_DIR, 'css', names.css), css);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', names.core), core);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', names.views), viewsOut);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', names.app), appOut);

  // 兼容副本：GitHub Pages 的 CDN 会缓存 HTML 约 10 分钟，旧版 HTML 仍引用
  // 无哈希文件名。保留一套完整且内容最新的同名文件，避免缓存窗口内 404 白屏。
  fs.writeFileSync(path.join(DOCS_DIR, 'css', 'styles.css'), css);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', 'core.js'), core);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', 'views.js'), views);
  fs.writeFileSync(path.join(DOCS_DIR, 'js', 'app.js'), app);

  // 旧 HTML（CDN 缓存）引用的上一代哈希文件继续存在，但内容换成当前版本，
  // 因此缓存窗口内看到的依然是最新界面，且不会出现 404 / 无样式。
  const current = { css, core, views: viewsOut, app: appOut };
  for (const [kind, files] of Object.entries(previous)) {
    const dir = kind === 'css' ? 'css' : 'js';
    for (const file of files) {
      fs.writeFileSync(path.join(DOCS_DIR, dir, file), current[kind]);
    }
  }
  const kept = Object.values(previous).flat();

  console.log('[pages] 已生成 docs/（静态资源内容哈希）');
  if (kept.length) console.log('[pages] 兼容旧缓存  :', kept.join(', '));
  console.log('[pages] 入口      :', `${BASE_PATH} (index.html + 404.html)`);
  console.log('[pages] 后端 API  :', API_BASE);
  console.log('[pages] 资源      :', Object.values(names).join(', '));
}

main();

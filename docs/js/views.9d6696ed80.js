/* =========================================================================
   PRODUCT TIMELINE — 页面视图
   每个视图返回 { html, title, init? }；init 在 DOM 插入后执行。
   ========================================================================= */

import {
  state, API, $, $$, escapeHtml, navigate, toast, confirmModal, initReveal,
  activeTimezone, tzLabel, timeParts, formatFull, groupProducts,
  avatarHtml, categoryName, uid, asset, normalizeAvatar, ensureWebImage,
} from './core.63f0a3ede4.js';

const CATEGORY_HINT = 'CATEGORY INDEX / 分类索引';

/* ── 公共片段 ─────────────────────────────────────────────────────────── */

function imageGrid(product, mode = 'entry') {
  const count = product.images.length;
  const cls = mode === 'entry' ? 'entry__images' : 'detail-gallery';
  const items = product.images.map((img, i) => {
    const inner = `<img src="${escapeHtml(asset(img.url))}" alt="${escapeHtml(product.title)} — 图片 ${i + 1}" loading="lazy">`;
    return mode === 'entry'
      ? `<a class="image-frame" href="/p/${encodeURIComponent(product.id)}" data-link aria-label="查看作品：${escapeHtml(product.title)}">
           ${inner}<span class="image-frame__zoom">VIEW ↗</span>
         </a>`
      : `<a class="image-frame" href="${escapeHtml(asset(img.url))}" target="_blank" rel="noopener" aria-label="打开高清原图">${inner}</a>`;
  }).join('');
  return `<div class="${cls}" data-count="${count}">${items}</div>`;
}

function entryHtml({ product, parts }, showSeconds) {
  const p = product;
  return `
    <article class="entry reveal" data-pid="${escapeHtml(p.id)}">
      <div class="entry__time">
        <span class="entry__hms">${showSeconds ? parts.hms : parts.hm}</span>
        <span class="entry__tz">${escapeHtml(activeTimezone().split('/').pop())}</span>
        <span class="entry__node" aria-hidden="true"></span>
      </div>
      <div class="entry__body">
        <div class="entry__top">
          <a class="entry__cat" href="/category/${encodeURIComponent(p.category)}" data-link>${escapeHtml(categoryName(p.category))}</a>
          <span class="entry__id">${escapeHtml(p.id)}</span>
        </div>
        <h4 class="entry__title"><a href="/p/${encodeURIComponent(p.id)}" data-link>${escapeHtml(p.title)}</a></h4>
        ${p.description ? `<p class="entry__desc">${escapeHtml(p.description)}</p>` : ''}
        ${imageGrid(p, 'entry')}
        <div class="entry__foot">
          <span>${p.images.length} IMAGE${p.images.length > 1 ? 'S' : ''}</span>
          <span class="entry__lock">PERMANENT RECORD · 不可编辑</span>
          <a href="/p/${encodeURIComponent(p.id)}" data-link>查看详情 →</a>
        </div>
      </div>
    </article>`;
}

function monthsHtml(products, showSeconds) {
  const months = groupProducts(products);
  if (!months.length) return '';
  return months.map((month) => `
    <div class="month-band reveal">
      <span class="month-band__year">${escapeHtml(month.year)}</span>
      <span class="month-band__num">${Number(month.month)}</span>
      <span class="month-band__unit">月</span>
      <span class="rule"></span>
      <span class="month-band__count">${String(month.count).padStart(2, '0')} RECORDS</span>
    </div>
    ${month.days.map((day) => `
      <div class="day-group">
        <aside class="day-axis">
          <span class="day-axis__num">${Number(day.day)}</span>
          <span class="day-axis__meta">${escapeHtml(month.month)} / ${escapeHtml(day.weekday)}</span>
          <span class="day-axis__count">${day.count} 件作品</span>
          <span class="day-axis__line" aria-hidden="true"></span>
        </aside>
        <div class="day-entries">
          ${day.entries.map((e) => entryHtml(e, showSeconds)).join('')}
        </div>
      </div>`).join('')}
  `).join('');
}

function mastheadHtml(profile, viewing) {
  const { user, stats } = profile;
  const tz = activeTimezone();
  const showSeconds = user.showSeconds !== false;
  const earliest = stats.earliest ? formatFull(stats.earliest, tz, showSeconds).split(' ')[0] : '—';
  const latest = stats.latest ? formatFull(stats.latest, tz, showSeconds).split(' ')[0] : '—';
  const isMine = state.user && state.user.username === user.username;
  let notice = '';
  if (!state.user) {
    notice = `<div class="masthead__notice">正在浏览公开演示档案。<a href="/publish" data-link>点这里发布作品</a>，或创建属于自己的独立档案。</div>`;
  } else if (!isMine) {
    notice = `<div class="masthead__notice">正在浏览 ${escapeHtml(user.username)} 的公开档案。<a href="/" data-link>回到我的时间线 →</a></div>`;
  }
  return `
    <section class="masthead">
      <div class="masthead__kicker"><span>PERSONAL PRODUCT ARCHIVE</span><span class="rule"></span><span>档案编号 / ${escapeHtml(user.id)}</span></div>
      <div class="masthead__grid">
        <div class="identity">
          ${avatarHtml(user)}
          <div class="identity__body">
            <h1 class="identity__name reveal">${escapeHtml(user.displayName)}<span class="dot">.</span></h1>
            <p class="identity__handle">@${escapeHtml(user.username)} · 建档于 ${escapeHtml((user.createdAt || '').slice(0, 10))}</p>
            <p class="identity__bio">${escapeHtml(user.bio || '这个人还没有写下签名。')}</p>
          </div>
        </div>
        <div class="masthead__stats reveal" data-delay="1">
          <div class="stat"><span class="stat__value">${String(stats.total).padStart(2, '0')}</span><span class="stat__label">作品总数 / WORKS</span></div>
          <div class="stat"><span class="stat__value">${String(stats.categoryCount).padStart(2, '0')}</span><span class="stat__label">已用分类 / CATEGORIES</span></div>
          <div class="stat"><span class="stat__value stat__value--small">${escapeHtml(earliest)}</span><span class="stat__label">最早发布 / FIRST</span></div>
          <div class="stat"><span class="stat__value stat__value--small">${escapeHtml(latest)}</span><span class="stat__label">最近发布 / LATEST</span></div>
        </div>
      </div>
      ${notice}
    </section>`;
}

function filtersHtml(profile, activeCategory, ownerBase = '') {
  const root = ownerBase || '';
  const items = [
    `<a class="filter ${activeCategory === 'all' ? 'is-active' : ''}" href="${root || '/'}" data-link>全部作品<sup>${profile.stats.total}</sup></a>`,
    ...profile.categories.map((c) => `
      <a class="filter ${activeCategory === c.slug ? 'is-active' : ''} ${c.count === 0 ? 'is-empty' : ''}"
         href="${root}/category/${encodeURIComponent(c.slug)}" data-link>${escapeHtml(c.name)}<sup>${c.count}</sup></a>`),
  ];
  return `
    <nav class="filters" aria-label="产品分类筛选">
      <div class="filters__head">
        <span class="filters__title">${CATEGORY_HINT}</span>
        <span class="filters__hint">共 ${profile.categories.length} 个预设分类 · 点击仅查看该类作品</span>
      </div>
      <div class="filters__list">${items.join('')}</div>
    </nav>`;
}

function emptyHtml(profile, category) {
  if (category !== 'all') {
    return `<div class="state"><div class="state__glyph">∅</div>
      <h3 class="state__title">「${escapeHtml(categoryName(category))}」还是空的</h3>
      <p class="state__text">这一分类尚未发布过作品。每一次发布都会在档案里留下一条真实、不可改写的时间记录。</p>
      <a class="btn btn--accent" href="/publish" data-link>发布作品 →</a>
    </div>`;
  }
  return `<div class="state"><div class="state__glyph">01</div>
    <h3 class="state__title">档案从第一件作品开始</h3>
    <p class="state__text">这里将按真实发布时间倒序陈列你的全部作品，同一天的记录归入同一日期区块，永久保留。</p>
    <a class="btn btn--accent" href="/publish" data-link>发布第一件作品 →</a>
  </div>`;
}

function loadingHtml() {
  return `<div class="state"><div class="skeleton skeleton-line" style="width:40%"></div>
    <div class="skeleton skeleton-line" style="width:70%"></div>
    <div class="skeleton skeleton-block"></div>
    <div class="skeleton skeleton-line" style="width:55%"></div></div>`;
}

/* ── A. 首页 / 分类时间线 ─────────────────────────────────────────────── */
export async function homeView({ username, category = 'all' }) {
  const target = username || (state.user ? state.user.username : 'demo');
  let profile;
  let timeline;
  try {
    [profile, timeline] = await Promise.all([
      API.profile(target),
      API.timeline(target, { category: category === 'all' ? '' : category, limit: 60 }),
    ]);
  } catch (err) {
    if (err.status === 404) {
      return { title: '未找到该档案', html: `<div class="wrap"><div class="state"><div class="state__glyph">404</div><h3 class="state__title">没有找到 @${escapeHtml(target)} 的档案</h3><p class="state__text">请检查用户名，或回到首页浏览演示档案。</p><a class="btn" href="/" data-link>返回首页 →</a></div></div>` };
    }
    throw err;
  }

  if (timeline.serverTime) state.serverTime = timeline.serverTime;
  const showSeconds = profile.user.showSeconds !== false;
  const catName = category === 'all' ? '全部作品' : categoryName(category);
  const products = timeline.products;
  // 浏览他人主页时，分类链接仍停留在该用户的档案内。
  const ownerBase = username && (!state.user || state.user.username !== username)
    ? `/u/${encodeURIComponent(username)}` : '';

  const html = `
    <div class="wrap">
      ${mastheadHtml(profile, target)}
      ${filtersHtml(profile, category, ownerBase)}
      <section class="timeline-head reveal">
        <div>
          <h2 class="timeline-head__title">THE <span>TIMELINE</span></h2>
          <p class="timeline-head__desc">${category === 'all'
            ? '全部作品按真实发布时间倒序排列 · 发布后内容与时间永久锁定'
            : `当前仅显示「${escapeHtml(catName)}」· 按真实发布时间倒序排列`}</p>
        </div>
        <div class="timeline-head__meta">
          <strong>${escapeHtml(tzLabel())}</strong><br>
          服务端 UTC 时间戳换算 · 精确到秒<br>
          SERVER: ${escapeHtml((timeline.serverTime || '').slice(0, 19).replace('T', ' '))} UTC
        </div>
      </section>
      <section class="timeline" id="timeline-body" aria-label="作品时间线">
        ${products.length ? monthsHtml(products, showSeconds) : emptyHtml(profile, category)}
      </section>
      <div class="timeline-more" id="timeline-more">
        ${timeline.nextCursor ? `<button class="btn btn--ghost" id="load-more">载入更早的记录 ↓</button>` : ''}
        ${products.length ? `<span class="eyebrow" style="align-self:center;margin-left:16px">END OF CURRENT VIEW · ${products.length} / ${category === 'all' ? profile.stats.total : products.length}</span>` : ''}
      </div>
    </div>`;

  const init = () => {
    const body = $('#timeline-body');
    const more = $('#timeline-more');
    let all = [...products];
    let cursor = timeline.nextCursor;
    const btn = $('#load-more');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.classList.add('is-loading');
      btn.textContent = '载入中…';
      try {
        const next = await API.timeline(target, {
          category: category === 'all' ? '' : category, limit: 60, before: cursor,
        });
        all = all.concat(next.products);
        cursor = next.nextCursor;
        body.innerHTML = monthsHtml(all, showSeconds);
        initReveal(body);
        if (!cursor) { more.innerHTML = `<span class="eyebrow">全部 ${all.length} 条记录已呈现 · ARCHIVE COMPLETE</span>`; }
        else { btn.classList.remove('is-loading'); btn.textContent = '载入更早的记录 ↓'; }
      } catch (err) {
        toast(err.message || '载入失败', 'error');
        btn.classList.remove('is-loading');
        btn.textContent = '重试载入 ↓';
      }
    });
  };

  return { html, title: `${profile.user.displayName} · ${catName} — PRODUCT TIMELINE`, init };
}

/* ── B. 发布页 ────────────────────────────────────────────────────────── */
export function publishView() {
  if (!state.user) {
    return { title: '正在准备档案', html: `<div class="wrap"><div class="state"><div class="state__glyph">↗</div><h3 class="state__title">档案会话尚未建立</h3><p class="state__text">返回时间线后点击顶部「＋ 发布作品」即可自动进入，无需注册。</p><a class="btn btn--accent" href="/" data-link>返回时间线 →</a></div></div>` };
  }
  const options = state.categories.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
  const html = `
    <div class="wrap">
      <header class="publish-head">
        <span class="eyebrow">NEW ENTRY / 追加一条永久记录</span>
        <h1 class="publish-head__title">发布作品<span class="dot">.</span></h1>
        <p class="publish-head__sub">上传本次完成的作品，选择品类，确认后写入档案。同一条发布中的多张图片共享同一个服务端时间戳。</p>
      </header>
      <div class="publish-grid">
        <div class="publish-main">
          <h2 class="section-label"><span class="section-label__num">01</span> 产品图片 <span class="rule"></span></h2>
          <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="点击或拖拽上传图片">
            <div>
              <div class="dropzone__mark">＋</div>
              <p class="dropzone__title">点击选择，或将图片拖到此处</p>
              <p class="dropzone__hint">JPG / PNG / WEBP / GIF / AVIF / HEIC · 单张 ≤ 12 MB · 一次最多 9 张<br>大图与 HEIC 会自动转换压缩，发布后加载更快</p>
              <span class="dropzone__btn">选择图片</span>
            </div>
          </div>
          <input type="file" id="file-input" accept="image/*,.heic,.heif,.HEIC,.HEIF,.avif,.webp" multiple hidden>
          <div class="preview-list" id="preview-list" aria-live="polite"></div>

          <h2 class="section-label" style="margin-top:56px"><span class="section-label__num">02</span> 作品信息 <span class="rule"></span></h2>
          <form id="publish-form" novalidate>
            <div class="field">
              <label class="field__label" for="f-title">产品名称 <span class="accent">*</span></label>
              <input class="input" id="f-title" maxlength="120" placeholder="例如：雾蓝渐变壁纸 · 竖版" autocomplete="off">
              <span class="field__hint">发布后不可修改，请确认名称无误。</span>
            </div>
            <div class="field">
              <label class="field__label" for="f-category">产品分类 <span class="accent">*</span></label>
              <select class="select" id="f-category">${options}</select>
            </div>
            <div class="field">
              <label class="field__label" for="f-desc">产品描述（可留空）</label>
              <textarea class="textarea" id="f-desc" maxlength="2000" placeholder="记录这次创作的想法、用材或参数…"></textarea>
            </div>
          </form>
        </div>

        <aside class="publish-aside">
          <h2 class="section-label"><span class="section-label__num">03</span> 发布预览 <span class="rule"></span></h2>
          <div class="preview-card">
            <div class="preview-card__head">
              <span class="preview-card__title">FINAL PREVIEW</span>
              <span class="preview-card__time">SERVER TIME</span>
            </div>
            <div class="preview-card__image" id="preview-image">
              <span class="preview-card__placeholder">图片将显示在这里</span>
            </div>
            <div class="preview-card__name" id="preview-name">未命名作品</div>
            <div class="preview-card__meta" id="preview-meta">分类：— · 0 张图片</div>
            <div class="preview-card__foot">发布时间由服务端生成 · UTC 存储 · 精确到秒</div>
          </div>
          <div class="lock-note">
            <strong>发布前请确认</strong>
            发布后，作品内容及发布时间将永久锁定，无法修改，请确认信息无误后发布。
            若填写有误，只能重新发布一条新作品，原记录仍会保留在时间线中。
          </div>
          <button class="btn btn--accent publish-submit" id="submit-btn">确认并永久发布 →</button>
          <p class="auth-note">提交前会再次弹出确认界面。系统不会使用你设备的本地时间。</p>
        </aside>
      </div>
    </div>`;

  const init = () => {
    const dropzone = $('#dropzone');
    const input = $('#file-input');
    const list = $('#preview-list');
    const previewImage = $('#preview-image');
    const previewName = $('#preview-name');
    const previewMeta = $('#preview-meta');
    const titleInput = $('#f-title');
    const categoryInput = $('#f-category');
    const descInput = $('#f-desc');
    const submitBtn = $('#submit-btn');
    let files = [];
    let clientToken = uid();
    let submitting = false;

    const refreshPreview = () => {
      list.innerHTML = files.map((item, i) => `
        <div class="preview-item" draggable="true" data-id="${item.id}">
          <span class="preview-item__badge">${String(i + 1).padStart(2, '0')}</span>
          <img src="${item.url}" alt="待发布图片 ${i + 1}">
          <div class="preview-item__bar">
            <span class="preview-item__order">${escapeHtml(item.file.name.slice(0, 12))}</span>
            <button type="button" data-move="left" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="向前移动">←</button>
            <button type="button" data-move="right" data-index="${i}" ${i === files.length - 1 ? 'disabled' : ''} aria-label="向后移动">→</button>
            <button type="button" data-move="remove" data-index="${i}" aria-label="移除图片">×</button>
          </div>
        </div>`).join('');

      const first = files[0];
      previewImage.innerHTML = first
        ? `<img src="${first.url}" alt="发布预览">`
        : `<span class="preview-card__placeholder">图片将显示在这里</span>`;
      previewName.textContent = titleInput.value.trim() || '未命名作品';
      const cat = state.categories.find((c) => c.slug === categoryInput.value);
      previewMeta.textContent = `分类：${cat ? cat.name : '—'} · ${files.length} 张图片${files.length > 1 ? ' · 同一条记录' : ''}`;
    };

    /** 大图先在本地缩放 + WebP 转码，避免 5 MB 级 PNG 上传与后续加载都变慢。 */
    const optimizeImage = async (file) => {
      if (file.size <= 900 * 1024 || file.type === 'image/gif') return file;
      try {
        const bitmap = await createImageBitmap(file);
        const maxEdge = 1800;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
        // 后端按文件头魔数判类型；编码未生成真正的 WebP 时保持原图，避免名实不符。
        if (!blob || blob.type !== 'image/webp' || !blob.size || blob.size >= file.size * 0.92) return file;
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
      } catch {
        return file; // 浏览器不支持时保持原图，不影响发布
      }
    };

    const addFiles = async (incoming) => {
      const accepted = [];
      for (const file of incoming) {
        if (!file || !file.size) continue;
        if (file.size > 12 * 1024 * 1024) { toast(`${file.name || '图片'} 超过 12 MB`, 'error'); continue; }
        // 不再依赖 file.type：小红书 / 相册保存的文件常没有类型或后缀名不符，
        // 真正的格式由 ensureWebImage 按文件头魔数判断。
        accepted.push(file);
      }
      const room = 9 - files.length;
      if (room <= 0) { toast('单条作品最多 9 张图片', 'error'); return; }
      const chosen = accepted.slice(0, room);
      if (chosen.some((f) => f.size > 900 * 1024 && f.type !== 'image/gif')) toast('正在优化大图，稍候即可预览');
      for (const file of chosen) {
        try {
          const { file: readable, converted } = await ensureWebImage(file);
          if (converted) toast(`${file.name || 'HEIC 照片'} 已自动转为 JPG`);
          const optimized = await optimizeImage(readable);
          files.push({ id: uid(), file: optimized, url: URL.createObjectURL(optimized) });
        } catch (err) {
          toast(`${file.name || '图片'}：${err.message}`, 'error', 7000);
        }
      }
      refreshPreview();
      if (accepted.length > room) toast(`已保留前 ${room} 张，单次最多 9 张`, 'error');
    };

    const openPicker = () => input.click();
    dropzone.addEventListener('click', openPicker);
    dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
    input.addEventListener('change', () => { addFiles(Array.from(input.files || [])); input.value = ''; });
    ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (e) => {
      e.preventDefault(); dropzone.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (e) => {
      e.preventDefault(); dropzone.classList.remove('is-dragover');
    }));
    dropzone.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer?.files || [])));
    window.addEventListener('dragover', (e) => e.preventDefault(), { once: true });
    window.addEventListener('drop', (e) => e.preventDefault(), { once: true });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const i = Number(btn.dataset.index);
      const action = btn.dataset.move;
      if (action === 'remove') {
        URL.revokeObjectURL(files[i].url);
        files.splice(i, 1);
      } else if (action === 'left' && i > 0) {
        [files[i - 1], files[i]] = [files[i], files[i - 1]];
      } else if (action === 'right' && i < files.length - 1) {
        [files[i + 1], files[i]] = [files[i], files[i + 1]];
      }
      refreshPreview();
    });

    // 拖拽排序
    let dragIndex = null;
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.preview-item');
      if (!item) return;
      dragIndex = files.findIndex((f) => f.id === item.dataset.id);
      item.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const item = e.target.closest('.preview-item');
      $$('.preview-item', list).forEach((n) => n.classList.remove('is-drop-target'));
      if (item) item.classList.add('is-drop-target');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.preview-item');
      if (!item || dragIndex === null) return;
      const to = files.findIndex((f) => f.id === item.dataset.id);
      if (to >= 0 && to !== dragIndex) {
        const [moved] = files.splice(dragIndex, 1);
        files.splice(to, 0, moved);
        refreshPreview();
      }
      dragIndex = null;
    });
    list.addEventListener('dragend', () => {
      $$('.preview-item', list).forEach((n) => n.classList.remove('is-dragging', 'is-drop-target'));
      dragIndex = null;
    });

    [titleInput, descInput].forEach((el) => el.addEventListener('input', refreshPreview));
    categoryInput.addEventListener('change', refreshPreview);

    submitBtn.addEventListener('click', async () => {
      if (submitting) return;
      const title = titleInput.value.trim();
      const category = categoryInput.value;
      const description = descInput.value.trim();
      if (!title) { toast('请填写产品名称', 'error'); titleInput.focus(); return; }
      if (!files.length) { toast('请至少上传一张产品图片', 'error'); return; }

      const cat = state.categories.find((c) => c.slug === category);
      const ok = await confirmModal({
        eyebrow: 'PERMANENT RECORD / 永久记录',
        title: '确认发布？',
        bodyHtml: `<strong>发布后，作品内容及发布时间将永久锁定，无法修改，请确认信息无误后发布。</strong>
          <div class="modal__summary">
            <div><span>产品名称</span><span>${escapeHtml(title)}</span></div>
            <div><span>产品分类</span><span>${escapeHtml(cat ? cat.name : category)}</span></div>
            <div><span>图片数量</span><span>${files.length} 张 · 共享同一时间戳</span></div>
            <div><span>发布时间</span><span>由服务端生成（UTC）</span></div>
            <div><span>描述</span><span>${description ? escapeHtml(description.slice(0, 24)) + (description.length > 24 ? '…' : '') : '留空'}</span></div>
          </div>
          <p>如需更正，只能重新发布一条新作品，原记录会永久保留在时间线中。</p>`,
        confirmText: '确认发布，永久锁定',
      });
      if (!ok) return;

      submitting = true;
      submitBtn.disabled = true;
      submitBtn.classList.add('is-loading');
      submitBtn.textContent = '正在写入档案…';
      const formData = new FormData();
      formData.append('title', title);
      formData.append('category', category);
      formData.append('description', description);
      formData.append('clientToken', clientToken);
      files.forEach((item) => formData.append('images', item.file, item.file.name));
      try {
        const res = await API.publish(formData);
        files.forEach((item) => URL.revokeObjectURL(item.url));
        toast(res.duplicate ? '该提交已存在，已返回原记录' : '发布成功 · 记录已永久锁定');
        clientToken = uid();
        navigate(`/p/${encodeURIComponent(res.product.id)}`);
      } catch (err) {
        toast(err.message || '发布失败，请检查图片后重试', 'error', 6000);
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
        submitBtn.textContent = '确认并永久发布 →';
      }
    });

    refreshPreview();
  };

  return { html, title: '发布作品 — PRODUCT TIMELINE', init };
}

/* ── C. 作品详情 ──────────────────────────────────────────────────────── */
export async function detailView(id) {
  let data;
  try { data = await API.product(id); }
  catch (err) {
    if (err.status === 404) {
      return { title: '记录不存在', html: `<div class="wrap"><div class="state"><div class="state__glyph">404</div><h3 class="state__title">未找到这条记录</h3><p class="state__text">作品档案中不存在该编号。</p><a class="btn" href="/" data-link>返回时间线 →</a></div></div>` };
    }
    throw err;
  }
  const p = data.product;
  const author = data.author;
  const tz = activeTimezone();
  const full = formatFull(p.createdAt, tz, true);
  const html = `
    <div class="wrap">
      <a class="detail-back" href="/" data-link>← 返回时间线</a>
      <div class="detail-grid">
        <div class="detail-gallery-wrap reveal">${imageGrid(p, 'detail')}</div>
        <aside class="detail-info reveal" data-delay="1">
          <span class="detail-info__id">${escapeHtml(p.id)}</span>
          <h1 class="detail-info__title">${escapeHtml(p.title)}</h1>
          <div class="detail-row">
            <span class="detail-row__key">分类</span>
            <span class="detail-row__val"><a href="/category/${encodeURIComponent(p.category)}" data-link>${escapeHtml(categoryName(p.category))} →</a></span>
          </div>
          <div class="detail-row">
            <span class="detail-row__key">描述</span>
            <span class="detail-row__val muted">${p.description ? escapeHtml(p.description).replace(/\n/g, '<br>') : '（发布时未填写描述）'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__key">发布时间</span>
            <span class="detail-row__val big">${escapeHtml(full)}<br><span class="eyebrow">${escapeHtml(tzLabel())}</span></span>
          </div>
          <div class="detail-row">
            <span class="detail-row__key">UTC 记录</span>
            <span class="detail-row__val mono" style="font-size:.8rem">${escapeHtml(p.createdAt)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__key">图片</span>
            <span class="detail-row__val">${p.images.length} 张 · 同一次发布</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__key">作者</span>
            <span class="detail-row__val">${author ? `<a href="/u/${encodeURIComponent(author.username)}" data-link>@${escapeHtml(author.username)} →</a>` : '—'}</span>
          </div>
          <div class="detail-lock">
            <div class="detail-lock__title">此记录已永久锁定</div>
            <p>发布时间由数据库服务器时钟生成，内容、图片、名称、分类与描述均不可修改或删除。不提供编辑入口。</p>
            <div class="hash-line">RECORD HASH · ${escapeHtml(p.recordHash)}</div>
            <div class="hash-line">CHAIN SEQ · ${p.seq} / PREV · ${escapeHtml(p.prevHash.slice(0, 16))}…</div>
          </div>
        </aside>
      </div>
    </div>`;
  return { html, title: `${p.title} — PRODUCT TIMELINE` };
}

/* ── D. 个人设置 ──────────────────────────────────────────────────────── */
const TIMEZONES = [
  ['', '跟随浏览器本地时区'], ['Asia/Shanghai', 'Asia/Shanghai · 中国标准时间'],
  ['Asia/Tokyo', 'Asia/Tokyo · 日本'], ['Asia/Singapore', 'Asia/Singapore · 新加坡'],
  ['Europe/London', 'Europe/London · 英国'], ['Europe/Paris', 'Europe/Paris · 法国'],
  ['America/New_York', 'America/New_York · 美东'], ['America/Los_Angeles', 'America/Los_Angeles · 美西'],
  ['UTC', 'UTC · 协调世界时'],
];

export async function settingsView() {
  if (!state.user) {
    return { title: '请先登录', html: `<div class="wrap"><div class="state"><div class="state__glyph">↗</div><h3 class="state__title">登录后管理个人资料</h3><a class="btn btn--accent" href="/login" data-link>登录 / 注册 →</a></div></div>` };
  }
  const u = state.user;
  const tzOptions = TIMEZONES.map(([v, label]) => `<option value="${escapeHtml(v)}" ${u.timezone === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  let auditHtml = '<p class="panel__text">读取中…</p>';
  let audit = [];
  try { audit = (await API.audit()).events || []; } catch { /* 忽略 */ }
  if (audit.length) {
    auditHtml = `<div class="audit-list">${audit.slice(0, 40).map((e) => `
      <div class="audit-item"><time>${escapeHtml((e.created_at || '').slice(0, 19).replace('T', ' '))}</time>
      <span class="action">${escapeHtml(e.action)}</span>
      <span>${escapeHtml((e.target || '').slice(0, 20))}</span></div>`).join('')}</div>`;
  } else auditHtml = '<p class="panel__text">暂无操作记录。</p>';

  const html = `
    <div class="wrap">
      <header class="publish-head">
        <span class="eyebrow">ACCOUNT / 个人设置</span>
        <h1 class="publish-head__title">个人资料<span class="dot">.</span></h1>
        <p class="publish-head__sub">资料可以随时修改，但已发布作品的内容与时间记录不受任何影响。</p>
      </header>
      <div class="settings-grid">
        <div>
          <h2 class="section-label"><span class="section-label__num">01</span> 基本信息 <span class="rule"></span></h2>
          <div class="settings-avatar">
            <span id="settings-avatar">${avatarHtml(u)}</span>
            <div class="settings-avatar__body">
              <span class="field__hint">支持 JPG / PNG / WEBP / GIF / AVIF / HEIC（iPhone、小红书常见格式），自动压缩并居中裁成方形</span>
              <button class="btn btn--ghost" id="avatar-btn" style="min-height:40px;padding:8px 16px">更换头像</button>
              <input type="file" id="avatar-input" accept="image/*,.heic,.heif,.HEIC,.HEIF,.avif,.webp" hidden>
            </div>
          </div>
          <form id="settings-form">
            <div class="field">
              <label class="field__label" for="s-name">昵称</label>
              <input class="input" id="s-name" maxlength="40" value="${escapeHtml(u.displayName)}">
            </div>
            <div class="field">
              <label class="field__label" for="s-bio">个性签名</label>
              <textarea class="textarea" id="s-bio" maxlength="200">${escapeHtml(u.bio)}</textarea>
            </div>
            <div class="field">
              <label class="field__label" for="s-tz">时间显示时区</label>
              <select class="select" id="s-tz">${tzOptions}</select>
              <span class="field__hint">作品始终以 UTC 存储，这里只影响你看到的显示时间。</span>
            </div>
            <div class="settings-row">
              <div><div class="settings-row__label">深色界面</div><div class="settings-row__hint">切换个人浏览界面，不改变档案内容</div></div>
              <button type="button" class="switch ${u.theme === 'dark' ? 'is-on' : ''}" id="s-theme" role="switch" aria-checked="${u.theme === 'dark'}" aria-label="深色界面"></button>
            </div>
            <div class="settings-row">
              <div><div class="settings-row__label">时间精确到秒</div><div class="settings-row__hint">关闭后时间线只显示时：分</div></div>
              <button type="button" class="switch ${u.showSeconds !== false ? 'is-on' : ''}" id="s-seconds" role="switch" aria-checked="${u.showSeconds !== false}" aria-label="时间精确到秒"></button>
            </div>
            <button class="btn btn--accent" type="submit" id="save-settings">保存资料 →</button>
          </form>
        </div>
        <aside>
          <h2 class="section-label"><span class="section-label__num">02</span> 档案完整性 <span class="rule"></span></h2>
          <div class="panel">
            <div class="panel__title">INTEGRITY CHECK</div>
            <p class="panel__text">校验你的哈希链、图片文件哈希与时间戳是否连续完整。任何一条记录被改动都会在这里暴露。</p>
            <button class="btn btn--ghost" id="verify-btn" style="width:100%">运行完整性校验</button>
            <div id="verify-result"></div>
          </div>
          <div class="panel">
            <div class="panel__title">AUDIT LOG / 操作记录</div>
            ${auditHtml}
          </div>
          <div class="panel">
            <div class="panel__title">ACCOUNT</div>
            <p class="panel__text mono" style="font-size:.72rem">@${escapeHtml(u.username)}<br>${escapeHtml(u.id)}</p>
            <button class="btn btn--ghost" id="logout-btn" style="width:100%;margin-top:8px">退出登录</button>
            <a class="settings-switch" href="/login" data-link>切换 / 创建独立档案 →</a>
          </div>
        </aside>
      </div>
    </div>`;

  const init = () => {
    const form = $('#settings-form');
    const themeBtn = $('#s-theme');
    const secondsBtn = $('#s-seconds');
    let theme = u.theme === 'dark' ? 'dark' : 'light';
    let showSeconds = u.showSeconds !== false;
    themeBtn.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      themeBtn.classList.toggle('is-on', theme === 'dark');
      themeBtn.setAttribute('aria-checked', String(theme === 'dark'));
    });
    secondsBtn.addEventListener('click', () => {
      showSeconds = !showSeconds;
      secondsBtn.classList.toggle('is-on', showSeconds);
      secondsBtn.setAttribute('aria-checked', String(showSeconds));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#save-settings');
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const res = await API.patchMe({
          displayName: $('#s-name').value.trim(),
          bio: $('#s-bio').value,
          timezone: $('#s-tz').value,
          theme, showSeconds,
        });
        state.user = res.user;
        window.dispatchEvent(new CustomEvent('pt:theme-change', { detail: theme }));
        toast('资料已保存 · 历史作品不受影响');
      } catch (err) {
        toast(err.message || '保存失败', 'error');
      } finally {
        btn.disabled = false; btn.textContent = '保存资料 →';
      }
    });
    $('#avatar-btn').addEventListener('click', () => $('#avatar-input').click());
    $('#avatar-input').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // 允许再次选择同一张图片
      if (!file) return;
      const btn = $('#avatar-btn');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '正在处理图片…';
      try {
        const { file: prepared, converted } = await normalizeAvatar(file);
        btn.textContent = '正在上传…';
        const fd = new FormData();
        fd.append('avatar', prepared, prepared.name);
        const res = await API.uploadAvatar(fd);
        state.user = res.user;
        $('#settings-avatar').innerHTML = avatarHtml(res.user);
        const navAvatar = document.querySelector('.nav-user__avatar');
        if (navAvatar && res.user.avatar) navAvatar.src = asset(res.user.avatar);
        window.dispatchEvent(new CustomEvent('pt:user-change'));
        toast(converted ? '头像已更新 · HEIC 照片已自动转为 JPG' : '头像已更新');
      } catch (err) {
        // 格式说明较长，给足阅读时间
        toast(err.message || '头像上传失败', 'error', 7000);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    $('#verify-btn').addEventListener('click', async () => {
      const box = $('#verify-result');
      box.innerHTML = '<div class="verify-result">校验中…</div>';
      try {
        const res = await API.verify();
        const r = res.report;
        box.innerHTML = `<div class="verify-result">${r.ok ? '✓ 完整' : '✗ 异常'} · ${r.records} 条记录 · ${r.checkedUsers} 位用户<br>${r.ok ? '哈希链连续，图片未被替换，时间可信。' : r.issues.map((i) => escapeHtml(i.issue)).join('<br>')}</div>`;
        toast(r.ok ? '档案完整性校验通过' : '发现异常，请查看结果', r.ok ? 'info' : 'error');
      } catch (err) { box.innerHTML = `<div class="verify-result">${escapeHtml(err.message)}</div>`; }
    });
    $('#logout-btn').addEventListener('click', async () => {
      await API.logout();
      state.user = null;
      localStorage.setItem('pt-manual-logout', '1');
      toast('已退出登录');
      navigate('/login');
    });
  };
  return { html, title: '个人设置 — PRODUCT TIMELINE', init };
}

/* ── E. 登录 / 注册 ───────────────────────────────────────────────────── */
export function authView(mode = 'login') {
  let current = mode === 'register' ? 'register' : 'login';
  const html = `
    <div class="wrap">
      <div class="auth-grid">
        <section class="auth-manifesto">
          <span class="eyebrow">PRODUCT TIMELINE / 数字产品档案</span>
          <h1 class="auth-manifesto__title">每一次发布，<br>都是一条<em>不可改写</em><br>的时间。</h1>
          <p class="auth-manifesto__text">这里不是社交动态，而是你的创作档案。作品按真实发布时间永久陈列，图片与文字一旦发布便锁定。</p>
          <span class="auth-manifesto__stamp">SERVER TIME · UTC STORED · APPEND ONLY</span>
        </section>
        <section class="auth-panel">
          <div class="auth-panel__inner">
            <div class="auth-quick">
              <span class="auth-quick__eyebrow">QUICK START / 打开即用</span>
              <button class="btn btn--accent btn--quick" id="quick-enter" type="button">一键进入 <span aria-hidden="true">→</span></button>
              <p class="auth-quick__hint">无需账号密码，直接开始发布作品。<br>当前使用共享演示档案，作品会公开陈列在时间线上。</p>
            </div>
            <div class="auth-divider"><span>已有自己的独立档案？</span></div>
            <div class="auth-tabs" role="tablist">
              <button class="auth-tab ${current === 'login' ? 'is-active' : ''}" data-tab="login" role="tab">登录</button>
              <button class="auth-tab ${current === 'register' ? 'is-active' : ''}" data-tab="register" role="tab">创建独立档案</button>
            </div>
            <div id="form-error"></div>
            <form class="auth-form" id="auth-form" novalidate>
              <div class="field">
                <label class="field__label" for="a-username">账号</label>
                <input class="input" id="a-username" autocomplete="username" placeholder="3–24 位字母、数字或下划线">
              </div>
              <div class="field" id="display-field" style="display:${current === 'register' ? 'block' : 'none'}">
                <label class="field__label" for="a-display">昵称（可留空）</label>
                <input class="input" id="a-display" maxlength="40" placeholder="展示在主页上的名字">
              </div>
              <div class="field">
                <label class="field__label" for="a-password">密码</label>
                <input class="input" id="a-password" type="password" autocomplete="current-password" placeholder="至少 6 位">
              </div>
              <button class="btn btn--accent" type="submit" id="auth-submit">${current === 'login' ? '登录 →' : '创建档案 →'}</button>
            </form>
            <p class="auth-note">独立档案拥有自己的数据空间。所有发布时间由数据库服务器时钟生成，与设备本地时间无关。</p>
            <div class="auth-demo">只想先看看？<a href="/u/demo" data-link>浏览公开演示时间线 →</a></div>
          </div>
        </section>
      </div>
    </div>`;

  const init = () => {
    const form = $('#auth-form');
    const errorBox = $('#form-error');
    const displayField = $('#display-field');
    const quick = $('#quick-enter');
    quick.addEventListener('click', async () => {
      quick.disabled = true; quick.textContent = '正在进入…';
      try {
        const res = await API.login('demo', 'demo1234');
        state.user = res.user;
        localStorage.removeItem('pt-manual-logout');
        toast('已进入演示档案 · 可以开始发布作品');
        navigate('/');
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error">${escapeHtml(err.message || '进入失败')}</div>`;
        quick.disabled = false;
        quick.innerHTML = '一键进入 <span aria-hidden="true">→</span>';
      }
    });
    $$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
      current = tab.dataset.tab;
      $$('.auth-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      displayField.style.display = current === 'register' ? 'block' : 'none';
      $('#auth-submit').textContent = current === 'login' ? '登录 →' : '创建档案 →';
      errorBox.innerHTML = '';
      history.replaceState({}, '', current === 'register' ? '/login?mode=register' : '/login');
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#a-username').value.trim();
      const password = $('#a-password').value;
      const displayName = $('#a-display').value.trim();
      const btn = $('#auth-submit');
      errorBox.innerHTML = '';
      btn.disabled = true; btn.textContent = '请稍候…';
      try {
        const res = current === 'login'
          ? await API.login(username, password)
          : await API.register(username, password, displayName);
        state.user = res.user;
        localStorage.removeItem('pt-manual-logout');
        toast(current === 'login' ? '欢迎回来' : '档案已创建，开始记录吧');
        navigate('/');
      } catch (err) {
        errorBox.innerHTML = `<div class="form-error">${escapeHtml(err.message || '操作失败')}</div>`;
        btn.disabled = false;
        btn.textContent = current === 'login' ? '登录 →' : '创建档案 →';
      }
    });
  };
  return { html, title: '登录 / 注册 — PRODUCT TIMELINE', init };
}

export function notFoundView() {
  return {
    title: '页面不存在',
    html: `<div class="wrap"><div class="state"><div class="state__glyph">404</div><h3 class="state__title">这一页不在档案里</h3><a class="btn" href="/" data-link>返回时间线 →</a></div></div>`,
  };
}

export { loadingHtml };

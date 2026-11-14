'use strict';

/**
 * PRODUCT TIMELINE 安全性与机制测试
 * 在完全隔离的临时数据库 + 独立端口上运行，不触碰正式数据。
 * 运行：npm test
 *
 * 覆盖需求文档第七阶段列出的全部重点测试项。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-security-'));
process.env.PT_DATA_DIR = path.join(TMP, 'data');
process.env.PT_DB = path.join(TMP, 'data', 'timeline.sqlite');
process.env.PT_BACKUP_DIR = path.join(TMP, 'data', 'backups');
process.env.PT_UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.PORT = '4183';
process.env.HOST = '127.0.0.1';
process.env.SEED_DEMO = '0';

const { start } = require('../src/server');
const db = require('../src/db');
const { artwork } = require('../src/png');

const BASE = 'http://127.0.0.1:4183';
const results = [];
let cookie = '';
let server;

async function request(pathname, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (auth && cookie) h.Cookie = cookie;
  if (body && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(BASE + pathname, { method, headers: h, body });
  let data = {};
  try { data = await res.json(); } catch { /* 忽略 */ }
  return { status: res.status, data, headers: res.headers };
}

async function register(username) {
  const res = await request('/api/auth/register', {
    method: 'POST', auth: false,
    body: { username, password: 'test-pass-1234', displayName: username.toUpperCase() }, // gau:allow 临时测试账号密码
  });
  assert.equal(res.status, 201, `注册 ${username} 失败: ${JSON.stringify(res.data)}`);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
}

async function login(username) {
  const res = await request('/api/auth/login', {
    method: 'POST', auth: false,
    body: { username, password: 'test-pass-1234' }, // gau:allow 临时测试账号密码
  });
  assert.equal(res.status, 200, `登录 ${username} 失败`);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
}

function form(fields, images = []) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
  images.forEach((buf, i) => {
    fd.append('images', new Blob([buf], { type: 'image/png' }), `image-${i}.png`);
  });
  return fd;
}

function png(i) { return artwork(i, i % 8, 240, 300); }

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
}

function nearServerTime(iso, toleranceMs = 6000) {
  const diff = Math.abs(Date.parse(iso) - Date.now());
  assert.ok(diff < toleranceMs, `时间 ${iso} 与服务器当前时间相差 ${diff}ms，超过容差`);
}

async function run() {
  server = start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  console.log('\n  PRODUCT TIMELINE · 安全性测试（隔离数据库）\n');

  let userA, userB;
  let recordA;
  let forgedFields;

  await test('0. 服务端时间源：UTC、来自数据库时钟', async () => {
    const res = await request('/api/server-time', { auth: false });
    assert.equal(res.status, 200);
    assert.equal(res.data.source, 'database:strftime(now)');
    nearServerTime(res.data.iso);
  });

  await test('0. 用户注册与数据空间建立（A / B 两个独立账号）', async () => {
    userA = 'alice_' + Date.now().toString().slice(-6);
    userB = 'bob_' + Date.now().toString().slice(-6);
    await register(userA);
    await register(userB);
    assert.ok(userA && userB);
  });

  // ── 重点测试 1：修改手机系统时间后发布 ──────────────────────────────
  await test('1. 手机系统时间改为 2020 年后发布，时间仍为服务器真实时间', async () => {
    await login(userA);
    forgedFields = {
      title: '手机时间篡改测试', category: 'square', clientToken: 'tok-phone-1',
      createdAt: '2020-01-01T08:00:00.000Z',   // 伪造的「设备时间」
      created_at: '2020-01-01T08:00:00.000Z',
      timestamp: '1577865600000',
      date: '2020-01-01',
    };
    const res = await request('/api/products', {
      method: 'POST',
      headers: { 'X-Client-Time': '2020-01-01T08:00:00.000Z', 'X-Device-Timezone': 'Pacific/Kiritimati' },
      body: form(forgedFields, [png(1)]),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    recordA = res.data.product;
    nearServerTime(recordA.createdAt);
    assert.ok(recordA.createdAt.startsWith(new Date().getUTCFullYear().toString()), '年份被客户端伪造');
    assert.ok(!recordA.createdAt.startsWith('2020'), '发布记录错误地采用了 2020 年');
    assert.equal(recordA.title, '手机时间篡改测试');
  });

  // ── 重点测试 2：修改电脑系统时间后发布 ──────────────────────────────
  await test('2. 电脑系统时间改为 1999 年后发布，时间仍为服务器真实时间', async () => {
    const res = await request('/api/products', {
      method: 'POST',
      headers: { Date: 'Mon, 01 Jan 1999 00:00:00 GMT', 'X-Local-Time': '1999-01-01T00:00:00Z' },
      body: form({
        title: '电脑时间篡改测试', category: 'wallpaper', clientToken: 'tok-pc-1',
        publishedAt: '1999-01-01T00:00:00.000Z', publishTime: 915148800, time: '1999-01-01',
      }, [png(2)]),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    nearServerTime(res.data.product.createdAt);
    assert.ok(!res.data.product.createdAt.startsWith('1999'));
  });

  // ── 重点测试 3：刷新页面后历史时间不变 ──────────────────────────────
  await test('3. 刷新页面（重复读取）后历史发布时间完全不变', async () => {
    const first = await request(`/api/timeline/${userA}?limit=20`);
    const second = await request(`/api/timeline/${userA}?limit=20`);
    const third = await request(`/api/products/${recordA.id}`);
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.products.map((p) => p.createdAt), second.data.products.map((p) => p.createdAt));
    assert.equal(third.data.product.createdAt, recordA.createdAt);
    assert.equal(third.data.product.recordHash, recordA.recordHash);
  });

  // ── 重点测试 4：退出登录重新登录后记录不变 ─────────────────────────
  await test('4. 退出登录再重新登录，记录内容与时间保持不变', async () => {
    const out = await request('/api/auth/logout', { method: 'POST' });
    assert.equal(out.status, 200, `退出登录失败: ${JSON.stringify(out.data)}`);
    cookie = '';
    const anonymous = await request('/api/auth/me');
    assert.equal(anonymous.data.user, null);
    await login(userA);
    const res = await request(`/api/products/${recordA.id}`);
    assert.equal(res.data.product.createdAt, recordA.createdAt);
    assert.equal(res.data.product.title, recordA.title);
    assert.equal(res.data.product.recordHash, recordA.recordHash);
  });

  // ── 重点测试 5：浏览器开发者工具 / 前端构造请求修改记录 ─────────────
  await test('5. 开发者工具构造 PUT / PATCH 修改记录，被拒绝', async () => {
    for (const method of ['PUT', 'PATCH']) {
      const res = await request(`/api/products/${recordA.id}`, {
        method, body: { title: '被篡改的标题', created_at: '2020-01-01T00:00:00Z' },
      });
      assert.equal(res.status, 405, `${method} 应当返回 405`);
      assert.equal(res.data.code, 'IMMUTABLE_RECORD');
    }
    const after = await request(`/api/products/${recordA.id}`);
    assert.equal(after.data.product.title, '手机时间篡改测试');
    assert.equal(after.data.product.createdAt, recordA.createdAt);
  });

  // ── 重点测试 6：直接构造 API / 数据库修改，被拒绝 ───────────────────
  await test('6. API DELETE 与数据库层直接 UPDATE / DELETE 均被拒绝', async () => {
    const del = await request(`/api/products/${recordA.id}`, { method: 'DELETE' });
    assert.equal(del.status, 405);
    const patchAll = await request('/api/products', { method: 'PATCH', body: { title: 'x' } });
    assert.equal(patchAll.status, 405);

    // 绕过应用直接操作数据库：触发器必须拦住。
    assert.throws(
      () => db.getDb().prepare('UPDATE products SET title = ? WHERE id = ?').run('hacked', recordA.id),
      /IMMUTABLE_RECORD/
    );
    assert.throws(
      () => db.getDb().prepare('UPDATE product_images SET image_url = ? WHERE product_id = ?').run('/media/x.png', recordA.id),
      /IMMUTABLE_RECORD/
    );
    assert.throws(
      () => db.getDb().prepare('DELETE FROM products WHERE id = ?').run(recordA.id),
      /IMMUTABLE_RECORD/
    );
    const after = await request(`/api/products/${recordA.id}`);
    assert.equal(after.data.product.title, '手机时间篡改测试');
  });

  // ── 重点测试 7：多张图片属于同一条记录、共享同一时间戳 ──────────────
  let multi;
  await test('7. 一次发布 3 张图片 → 同一条记录、同一时间戳、顺序正确', async () => {
    const res = await request('/api/products', {
      method: 'POST',
      body: form({ title: '三图同档', category: 'brush', clientToken: 'tok-multi-1' },
        [png(3), png(4), png(5)]),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    multi = res.data.product;
    assert.equal(multi.images.length, 3);
    assert.deepEqual(multi.images.map((i) => i.sortOrder), [0, 1, 2]);
    assert.ok(multi.images.every((i) => i.fileHash.length === 64));
    const fresh = await request(`/api/timeline/${userA}?limit=20`);
    const sameRecord = fresh.data.products.filter((p) => p.id === multi.id);
    assert.equal(sameRecord.length, 1, '多图被拆成了多条记录');
    assert.equal(sameRecord[0].createdAt, multi.createdAt);
  });

  // ── 重点测试 8：多用户数据隔离 ──────────────────────────────────────
  await test('8. 多个用户之间数据隔离，且不能冒充他人发布', async () => {
    await login(userB);
    const bTimeline = await request(`/api/timeline/${userB}?limit=50`);
    assert.equal(bTimeline.data.products.length, 0, 'B 看到了 A 的作品');
    const bProfile = await request(`/api/profile/${userB}`);
    assert.equal(bProfile.data.stats.total, 0);

    // 尝试在请求里伪造 user_id
    const spoof = await request('/api/products', {
      method: 'POST',
      body: form({ title: '冒充 A 发布', category: 'other', clientToken: 'tok-spoof-1', user_id: userA }, [png(6)]),
    });
    assert.equal(spoof.status, 201);
    assert.equal(spoof.data.product.userId, bProfile.data.user.id, 'user_id 伪造未生效');
    const aTimeline = await request(`/api/timeline/${userA}?limit=50`);
    assert.ok(!aTimeline.data.products.some((p) => p.title === '冒充 A 发布'), '伪造记录进入了 A 的档案');

    const denied = await request(`/api/products/${recordA.id}`, { method: 'PUT', body: { title: 'B 篡改' } });
    assert.equal(denied.status, 405);
  });

  // ── 附加机制测试 ─────────────────────────────────────────────────────
  await test('9. 防重复提交：相同 clientToken 只产生一条记录', async () => {
    const before = (await request(`/api/timeline/${userB}?limit=50`)).data.products.length;
    const payload = () => form({ title: '幂等测试', category: 'scraps', clientToken: 'tok-idempotent-1' }, [png(7)]);
    const r1 = await request('/api/products', { method: 'POST', body: payload() });
    const r2 = await request('/api/products', { method: 'POST', body: payload() });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 200);
    assert.equal(r2.data.duplicate, true);
    assert.equal(r2.data.product.id, r1.data.product.id);
    const after = (await request(`/api/timeline/${userB}?limit=50`)).data.products.length;
    assert.equal(after, before + 1);
  });

  await test('10. 图片上传失败处理：非图片文件被拒绝且不产生记录', async () => {
    const before = (await request(`/api/timeline/${userB}?limit=50`)).data.products.length;
    const fd = new FormData();
    fd.append('title', '伪装图片'); fd.append('category', 'other'); fd.append('clientToken', 'tok-bad-file');
    fd.append('images', new Blob([Buffer.from('this is not an image')], { type: 'image/png' }), 'fake.png');
    const res = await request('/api/products', { method: 'POST', body: fd });
    assert.equal(res.status, 400);
    const after = (await request(`/api/timeline/${userB}?limit=50`)).data.products.length;
    assert.equal(after, before);
  });

  await test('11. 分类筛选：只返回指定分类且按时间倒序', async () => {
    await login(userA);
    const res = await request(`/api/timeline/${userA}?category=square`);
    assert.equal(res.status, 200);
    assert.ok(res.data.products.length >= 1);
    assert.ok(res.data.products.every((p) => p.category === 'square'));
    const times = res.data.products.map((p) => p.createdAt);
    assert.deepEqual(times, [...times].sort().reverse());
  });

  await test('12. 发布记录必须选择分类，非法分类被拒绝', async () => {
    const res = await request('/api/products', {
      method: 'POST',
      body: form({ title: '无分类', category: 'not-a-category', clientToken: 'tok-bad-cat' }, [png(8)]),
    });
    assert.equal(res.status, 400);
  });

  await test('13. 哈希链完整性校验通过，审计日志记录篡改尝试', async () => {
    const verify = await request('/api/verify');
    assert.equal(verify.status, 200);
    assert.equal(verify.data.report.ok, true, JSON.stringify(verify.data.report.issues));
    const audit = await request('/api/audit');
    assert.ok(audit.data.events.some((e) => e.action === 'product.mutation_rejected'));
    assert.ok(audit.data.events.some((e) => e.action === 'product.time_override_attempt'));
  });

  await test('14. 修改个人资料不影响任何历史作品', async () => {
    const before = (await request(`/api/timeline/${userA}?limit=50`)).data.products;
    const res = await request('/api/me', { method: 'PATCH', body: { displayName: '改名后的 A', bio: '新签名', timezone: 'Asia/Tokyo' } });
    assert.equal(res.status, 200);
    const after = (await request(`/api/timeline/${userA}?limit=50`)).data.products;
    assert.deepEqual(after.map((p) => [p.id, p.title, p.createdAt, p.recordHash]),
      before.map((p) => [p.id, p.title, p.createdAt, p.recordHash]));
  });

  await test('15. 图片内容寻址：同一图片复用文件、绝不覆盖替换', async () => {
    const filesBefore = fs.readdirSync(path.join(TMP, 'uploads')).length;
    const res = await request('/api/products', {
      method: 'POST',
      body: form({ title: '重复图片', category: 'other', clientToken: 'tok-same-img' }, [png(1)]),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.product.images[0].fileHash, recordA.images[0].fileHash);
    assert.equal(res.data.product.images[0].url, recordA.images[0].url);
    const original = fs.readFileSync(path.join(TMP, 'uploads', recordA.images[0].url.replace('/media/', '')));
    assert.equal(db.sha256(original), recordA.images[0].fileHash);
    assert.ok(fs.readdirSync(path.join(TMP, 'uploads')).length >= filesBefore);
  });

  await test('16. 数据备份机制：自动快照文件已生成', async () => {
    const files = fs.readdirSync(path.join(TMP, 'data', 'backups')).filter((f) => f.endsWith('.sqlite'));
    assert.ok(files.length >= 1, '未生成备份快照');
  });

  await test('17. 未登录用户无法发布作品', async () => {
    cookie = '';
    const res = await request('/api/products', {
      method: 'POST', auth: false,
      body: form({ title: '匿名发布', category: 'other', clientToken: 'tok-anon' }, [png(9)]),
    });
    assert.equal(res.status, 401);
  });

  // 线上部署在反向代理之后：Host 被改写为内部地址，早期版本会把所有同源写请求
  // 误判为跨站。以下用例锁定修复后的行为，同时保留真实跨站防护。
  await test('18. 本地直连：伪造跨站 Origin 仍被拒绝', async () => {
    const res = await request('/api/health', {
      headers: { Origin: 'https://evil.example' }, auth: false,
    });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, 'CSRF_REJECTED');
  });

  await test('19. 反向代理：公网 https Origin + 转发头不再被误判为跨站', async () => {
    const res = await request('/api/health', {
      auth: false,
      headers: {
        Origin: 'https://wbapp-example.app.workbuddy.host',
        'X-Forwarded-Proto': 'https',
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.ok, true);
  });

  await test('20. Fetch Metadata：cross-site 拒绝，same-origin 放行', async () => {
    const cross = await request('/api/health', {
      auth: false,
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(cross.status, 403);
    const same = await request('/api/health', {
      auth: false,
      headers: { Origin: 'https://wbapp-example.app.workbuddy.host', 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(same.status, 200);
  });

  await test('21. 配置的公网 Origin 被信任（不依赖转发头）', async () => {
    const { config } = require('../src/config');
    config.PUBLIC_ORIGINS.push('https://archive.example.com');
    try {
      const res = await request('/api/health', {
        auth: false, headers: { Origin: 'https://archive.example.com' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.data));
    } finally {
      config.PUBLIC_ORIGINS.pop();
    }
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n  结果：${passed} 通过 / ${failed} 失败（共 ${results.length} 项）\n`);
  if (failed) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}: ${r.error}`));
  }
  return failed;
}

run().then(async (failed) => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error('测试运行异常：', err);
  process.exit(1);
});

'use strict';

/**
 * 数据层：SQLite 持久化、服务端可信时间、哈希链与不可篡改约束。
 *
 * 设计要点：
 * 1. 所有发布时间来自 SQLite 的 strftime('%Y-%m-%dT%H:%M:%fZ','now')，即数据库服务器时钟，
 *    HTTP 请求体中的任何时间字段都会被 API 层直接丢弃，不参与 INSERT。
 * 2. products / product_images / audit_log 上建立 BEFORE UPDATE / BEFORE DELETE 触发器，
 *    用 RAISE(ABORT) 在数据库引擎层面拒绝一切改写，前后端都无法绕过。
 * 3. 每个用户维护一条 record_hash 哈希链，任何一条记录被改动都会导致后续校验失败。
 * 4. server_stamp 由数据库 DEFAULT 生成，记录"该行实际写入数据库的时刻"，
 *    用于证明 created_at 不可能是事后伪造的未来时间。
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { config, CATEGORIES } = require('./config');

const GENESIS = 'GENESIS';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

let db = null;

function getDb() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

function initDb() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

  db = new DatabaseSync(config.DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar        TEXT NOT NULL DEFAULT '',
      bio           TEXT NOT NULL DEFAULT '',
      timezone      TEXT NOT NULL DEFAULT '',
      theme         TEXT NOT NULL DEFAULT 'light',
      show_seconds  INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      slug       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id),
      title          TEXT NOT NULL,
      category       TEXT NOT NULL REFERENCES categories(slug),
      description    TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      created_epoch  INTEGER NOT NULL,
      seq            INTEGER NOT NULL,
      prev_hash      TEXT NOT NULL,
      record_hash    TEXT NOT NULL,
      client_token   TEXT NOT NULL UNIQUE,
      server_stamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (user_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_products_user_time
      ON products (user_id, created_at DESC, seq DESC);
    CREATE INDEX IF NOT EXISTS idx_products_category
      ON products (user_id, category, created_at DESC);

    CREATE TABLE IF NOT EXISTS product_images (
      id         TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      image_url  TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      file_hash  TEXT NOT NULL,
      file_size  INTEGER NOT NULL,
      mime       TEXT NOT NULL,
      UNIQUE (product_id, sort_order)
    );
    CREATE INDEX IF NOT EXISTS idx_images_product ON product_images (product_id, sort_order);

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      actor      TEXT,
      target     TEXT,
      detail     TEXT,
      ip         TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  // ── 不可篡改约束：数据库引擎级拦截，独立于任何应用代码 ──────────────────
  const immutable = [
    ['products', 'product'],
    ['product_images', 'product image'],
    ['audit_log', 'audit log'],
  ];
  for (const [table, label] of immutable) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_no_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: ${label} records are append-only and cannot be updated');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_no_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: ${label} records are append-only and cannot be deleted');
      END;
    `);
  }

  // 分类表允许扩展：新增分类只需在 config.js 追加，启动时自动同步。
  const upsertCategory = db.prepare(
    'INSERT INTO categories (slug, name, sort_order) VALUES (?, ?, ?) ' +
    'ON CONFLICT(slug) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order'
  );
  db.exec('BEGIN');
  CATEGORIES.forEach((c, i) => upsertCategory.run(c.slug, c.name, i));
  db.exec('COMMIT');

  // 清理过期会话（会话表不属于档案记录，允许清理）
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

  return db;
}

/** 从数据库服务器时钟读取 UTC 时间；这是唯一合法的发布时间来源。 */
function serverNow() {
  const row = getDb()
    .prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS iso, CAST(strftime('%s','now') AS INTEGER) AS epoch")
    .get();
  return { iso: row.iso, epoch: Number(row.epoch) };
}

function audit(action, { actor = '', target = '', detail = '', ip = '' } = {}) {
  getDb()
    .prepare('INSERT INTO audit_log (action, actor, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run(action, actor, target, detail, ip);
}

// ── 用户与会话 ───────────────────────────────────────────────────────────

function createUser({ username, displayName, passwordHash, timezone = '', theme = 'light' }) {
  const id = 'USR-' + randomId(10);
  getDb()
    .prepare('INSERT INTO users (id, username, display_name, password_hash, timezone, theme) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, displayName, passwordHash, timezone, theme);
  audit('user.register', { actor: id, target: id, detail: username });
  return getUserById(id);
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    timezone: row.timezone,
    theme: row.theme,
    showSeconds: Number(row.show_seconds) !== 0,
    createdAt: row.created_at,
  };
}

function updateUser(userId, fields) {
  const allowed = {
    display_name: 'displayName',
    avatar: 'avatar',
    bio: 'bio',
    timezone: 'timezone',
    theme: 'theme',
    show_seconds: 'showSeconds',
  };
  const sets = [];
  const values = [];
  for (const [column, key] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${column} = ?`);
      values.push(fields[key]);
    }
  }
  if (!sets.length) return getUserById(userId);
  values.push(userId);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  audit('user.profile.update', { actor: userId, target: userId, detail: sets.join(',') });
  return getUserById(userId);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, Date.now() + config.SESSION_TTL_MS);
  return token;
}

function sessionUser(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.token_hash = ? AND s.expires_at > ?'
    )
    .get(sha256(token), Date.now());
  return row || null;
}

function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

// ── 作品记录 ─────────────────────────────────────────────────────────────

/** 哈希链载荷：任何字段被改动都会使 record_hash 失配。 */
function computeRecordHash(record, imageHashes) {
  const payload = [
    record.prev_hash,
    record.id,
    record.user_id,
    record.seq,
    record.title,
    record.category,
    record.description,
    record.created_at,
    record.created_epoch,
    imageHashes.map((h, i) => `${i}:${h}`).join('|'),
  ].join('\u001f');
  return sha256(payload);
}

function makeRecordId(iso) {
  const day = iso.slice(0, 10).replace(/-/g, '');
  return `PT-${day}-${randomId(5).toUpperCase()}`;
}

/**
 * 追加一条永久作品记录（事务）。
 * images: [{ imageUrl, fileHash, fileSize, mime }]，多图共享同一个 created_at。
 * options.createdAt 仅供服务端可信脚本（如演示数据 seed）使用；HTTP API 永不传入。
 */
function createProduct(userId, { title, category, description = '', clientToken, images }, options = {}) {
  const database = getDb();
  const existing = database.prepare('SELECT id FROM products WHERE client_token = ?').get(clientToken);
  if (existing) {
    // 幂等：重复提交返回同一条记录，不产生新时间戳。
    audit('product.duplicate_suppressed', { actor: userId, target: existing.id, detail: clientToken });
    return { product: getProductById(existing.id), duplicate: true };
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const now = options.createdAt
      ? { iso: options.createdAt, epoch: Math.floor(Date.parse(options.createdAt) / 1000) }
      : serverNow();

    const last = database
      .prepare('SELECT seq, record_hash FROM products WHERE user_id = ? ORDER BY seq DESC LIMIT 1')
      .get(userId);
    const seq = last ? Number(last.seq) + 1 : 1;
    const prevHash = last ? last.record_hash : GENESIS;
    const id = makeRecordId(now.iso);

    const record = {
      id,
      user_id: userId,
      title,
      category,
      description,
      created_at: now.iso,
      created_epoch: now.epoch,
      seq,
      prev_hash: prevHash,
    };
    const imageHashes = images.map((img) => img.fileHash);
    record.record_hash = computeRecordHash(record, imageHashes);

    database
      .prepare(
        `INSERT INTO products
          (id, user_id, title, category, description, created_at, created_epoch,
           seq, prev_hash, record_hash, client_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id, record.user_id, record.title, record.category, record.description,
        record.created_at, record.created_epoch, record.seq, record.prev_hash,
        record.record_hash, clientToken
      );

    const insertImage = database.prepare(
      `INSERT INTO product_images
        (id, product_id, image_url, sort_order, file_hash, file_size, mime)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    images.forEach((img, index) => {
      insertImage.run(
        'IMG-' + randomId(10), record.id, img.imageUrl, index,
        img.fileHash, img.fileSize, img.mime
      );
    });

    database.exec('COMMIT');
    audit('product.publish', {
      actor: userId,
      target: record.id,
      detail: `${category} | ${images.length} image(s) | ${record.created_at}`,
    });
    return { product: getProductById(record.id), duplicate: false };
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function imagesFor(productId) {
  return getDb()
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC')
    .all(productId);
}

function shapeProduct(row, withImages = true) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    category: row.category,
    description: row.description,
    createdAt: row.created_at,
    createdEpoch: Number(row.created_epoch),
    seq: Number(row.seq),
    prevHash: row.prev_hash,
    recordHash: row.record_hash,
    serverStamp: row.server_stamp,
    images: withImages
      ? imagesFor(row.id).map((img) => ({
          id: img.id,
          url: img.image_url,
          sortOrder: Number(img.sort_order),
          fileHash: img.file_hash,
          fileSize: Number(img.file_size),
          mime: img.mime,
        }))
      : undefined,
  };
}

function getProductById(id) {
  return shapeProduct(getDb().prepare('SELECT * FROM products WHERE id = ?').get(id));
}

/** 时间线查询：按发布时间倒序，支持分类筛选与游标分页。 */
function getProducts({ userId, category = '', limit = 60, before = '' }) {
  const clauses = ['user_id = ?'];
  const params = [userId];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (before) {
    // 复合游标格式：created_at|seq，保证同一毫秒内的多条记录也不会重复或漏掉。
    const [ts, seqStr] = before.split('|');
    clauses.push('(created_at < ? OR (created_at = ? AND seq < ?))');
    params.push(ts, ts, Number(seqStr) || 0);
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const rows = getDb()
    .prepare(
      `SELECT * FROM products WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, seq DESC LIMIT ?`
    )
    .all(...params);
  return rows.map((row) => shapeProduct(row));
}

function getProfile(username) {
  const user = getUserByUsername(username);
  if (!user) return null;
  const database = getDb();
  const totals = database
    .prepare(
      `SELECT COUNT(*) AS total,
              MIN(created_at) AS earliest,
              MAX(created_at) AS latest,
              COUNT(DISTINCT category) AS category_count
       FROM products WHERE user_id = ?`
    )
    .get(user.id);
  const counts = database
    .prepare('SELECT category, COUNT(*) AS count FROM products WHERE user_id = ? GROUP BY category')
    .all(user.id);
  const bySlug = {};
  counts.forEach((r) => { bySlug[r.category] = Number(r.count); });
  const categories = database
    .prepare('SELECT slug, name, sort_order FROM categories ORDER BY sort_order ASC')
    .all()
    .map((c) => ({ slug: c.slug, name: c.name, count: bySlug[c.slug] || 0 }));

  return {
    user: publicUser(user),
    stats: {
      total: Number(totals.total),
      categoryCount: Number(totals.category_count),
      earliest: totals.earliest,
      latest: totals.latest,
    },
    categories,
  };
}

/**
 * 完整性校验：重算每位用户的哈希链、校验图片文件哈希、检查时间不可能晚于实际入库时刻。
 */
function verifyChain(userId = '') {
  const database = getDb();
  const users = userId
    ? [getUserById(userId)].filter(Boolean)
    : database.prepare('SELECT * FROM users').all();
  const report = { checkedUsers: users.length, records: 0, issues: [], ok: true };

  for (const user of users) {
    const rows = database
      .prepare('SELECT * FROM products WHERE user_id = ? ORDER BY seq ASC')
      .all(user.id);
    let expectedPrev = GENESIS;
    let expectedSeq = 1;
    for (const row of rows) {
      report.records += 1;
      const imgs = imagesFor(row.id);
      const recomputed = computeRecordHash(row, imgs.map((i) => i.file_hash));
      const add = (msg) => { report.issues.push({ user: user.username, id: row.id, issue: msg }); };

      if (recomputed !== row.record_hash) add('record_hash 不匹配：记录内容可能被改动');
      if (row.prev_hash !== expectedPrev) add('哈希链断裂：prev_hash 与上一条不一致');
      if (Number(row.seq) !== expectedSeq) add('序号不连续：可能存在被删除的记录');
      // server_stamp 由 DB DEFAULT 生成，created_at 不允许晚于真实入库时刻。
      if (Date.parse(row.created_at) > Date.parse(row.server_stamp) + 2000) {
        add('created_at 晚于数据库入库时刻：疑似伪造未来时间');
      }
      for (const img of imgs) {
        const rel = img.image_url.replace(/^\/media\//, '');
        const file = path.join(config.UPLOAD_DIR, rel);
        if (!fs.existsSync(file)) {
          add(`图片文件缺失：${img.image_url}`);
          continue;
        }
        if (sha256(fs.readFileSync(file)) !== img.file_hash) {
          add(`图片内容与 file_hash 不符：${img.image_url}`);
        }
      }
      expectedPrev = row.record_hash;
      expectedSeq += 1;
    }
  }
  report.ok = report.issues.length === 0;
  return report;
}

/** 备份：VACUUM INTO 生成一致性快照，保留最近 N 份。 */
function backup(reason = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(config.BACKUP_DIR, `timeline-${stamp}-${reason}.sqlite`);
  try {
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const files = fs.readdirSync(config.BACKUP_DIR)
      .filter((f) => f.endsWith('.sqlite'))
      .sort();
    while (files.length > config.BACKUP_KEEP) {
      fs.unlinkSync(path.join(config.BACKUP_DIR, files.shift()));
    }
    return { ok: true, file: target, backups: files.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sha256, randomId, initDb, getDb, serverNow, audit,
  createUser, getUserById, getUserByUsername, publicUser, updateUser,
  createSession, sessionUser, destroySession,
  createProduct, getProductById, getProducts, getProfile,
  computeRecordHash, verifyChain, backup,
};

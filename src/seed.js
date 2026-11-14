'use strict';

/**
 * 演示档案 seed（可用 SEED_DEMO=0 关闭）。
 *
 * 说明：演示记录的时间由服务端脚本按「当前服务器时间 - 偏移量」生成，用来展示
 * 跨日 / 跨月的日期分组视觉；真实用户账号中不存在任何预置数据，所有发布时间
 * 都来自发布瞬间的数据库时钟。演示账号在签名中明确标注，避免与真实档案混淆。
 */

const db = require('./db');
const { storeImage } = require('./upload');
const { artwork } = require('./png');
const { config, CATEGORIES } = require('./config');
const { hashPassword } = require('./auth');

const POSTS = [
  { hoursAgo: 0.06, title: '静物与光 · 方图 No.07', category: 'square', images: 1,
    description: '用三种灰和一个亮色块处理午后的窗光，方形构图留了三分之一的空白。' },
  { hoursAgo: 3.2, title: '雾蓝渐变壁纸 · 竖版', category: 'wallpaper', images: 2,
    description: '锁屏与桌面两版，色阶压到 8 级，避免夜间刺眼。' },
  { hoursAgo: 6.7, title: '细线水印组 · 2026 秋', category: 'watermark', images: 3,
    description: '一组可叠在任何底色上的细线标记，含横排、竖排与角标三种。' },
  { hoursAgo: 27, title: '旧纸底素 04', category: 'base', images: 1,
    description: '' },
  { hoursAgo: 31, title: '边角料 · 拼贴试验', category: 'scraps', images: 2,
    description: '把之前几套产品里没用上的形状重新排了一次，意外地好看。' },
  { hoursAgo: 51, title: '窗边实拍 · 胶片扫描', category: 'photo', images: 1,
    description: '自然光，未调色，只做了颗粒保留。' },
  { hoursAgo: 75, title: '半透明水印素 A/B', category: 'watermark-base', images: 2,
    description: '' },
  { hoursAgo: 99, title: '柔边素刷 · 三件套', category: 'brush-base', images: 1,
    description: '低不透明度，适合叠色而非勾线。' },
  { hoursAgo: 147, title: '干笔触笔刷组', category: 'brush', images: 2,
    description: '做了 12 个压力档，最细的一档接近铅笔。' },
  { hoursAgo: 221, title: '预览模板 · 竖版三联', category: 'preview-template', images: 1,
    description: '用于方图与壁纸的组合展示，留白比例 1 : 1.618。' },
  { hoursAgo: 380, title: '未命名色卡试验', category: 'other', images: 1,
    description: '暂时没想好归到哪一类，先存进档案。' },
  { hoursAgo: 620, title: '开档第一件 · 方图 No.01', category: 'square', images: 1,
    description: '把第一件作品放进这里，之后每一次发布都会留下一条真实的时间记录。' },
];

function seedDemo() {
  if (db.getUserByUsername(config.DEMO_USERNAME)) return false;

  const user = db.createUser({
    username: config.DEMO_USERNAME,
    displayName: '样本工作室',
    passwordHash: hashPassword(config.DEMO_PASSWORD),
    timezone: '',
  });

  const totalImages = POSTS.reduce((sum, p) => sum + p.images, 0);
  const stored = [];
  for (let i = 0; i < totalImages; i += 1) {
    const horizontal = i % 5 === 2;
    const png = artwork(i, i % 8, horizontal ? 960 : 720, horizontal ? 720 : 900);
    stored.push(storeImage(png));
  }

  db.updateUser(user.id, {
    avatar: stored[0].imageUrl,
    bio: '演示档案 · 记录每一次产品创作。你自己的账号从注册那一刻起，全部记录都由服务端真实时间生成。',
  });

  let cursor = 0;
  // 从最旧到最新插入，保证哈希链顺序与时间顺序一致。
  [...POSTS].sort((a, b) => b.hoursAgo - a.hoursAgo).forEach((post, index) => {
    const images = stored.slice(cursor, cursor + post.images);
    cursor += post.images;
    const createdAt = new Date(Date.now() - post.hoursAgo * 3600 * 1000).toISOString();
    db.createProduct(user.id, {
      title: post.title,
      category: post.category,
      description: post.description,
      clientToken: `SEED-${config.DEMO_USERNAME}-${index}-${db.randomId(6)}`,
      images,
    }, { createdAt });
  });

  db.backup('seed');
  return true;
}

module.exports = { seedDemo, POSTS };

if (require.main === module) {
  db.initDb();
  const created = seedDemo();
  const report = db.verifyChain();
  console.log(JSON.stringify({ created, categories: CATEGORIES.length, verify: report.ok, records: report.records }, null, 2));
}

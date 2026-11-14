'use strict';

/** 档案完整性校验 CLI：哈希链、图片文件哈希、时间可信度、序号连续性。 */

const db = require('./db');

db.initDb();
const report = db.verifyChain();
console.log(`校验用户: ${report.checkedUsers}  作品记录: ${report.records}`);
if (report.ok) {
  console.log('✓ 全部记录完整：哈希链连续、图片未被替换、时间可信。');
} else {
  console.error(`✗ 发现 ${report.issues.length} 处异常：`);
  report.issues.forEach((i) => console.error(`  [${i.user}] ${i.id} — ${i.issue}`));
}
process.exit(report.ok ? 0 : 1);

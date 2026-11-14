# PRODUCT TIMELINE

个人产品发布与永久时间档案。记录每一次创作、每一次发布：作品按真实服务端时间倒序陈列，图片与文字一经发布便永久锁定，不可编辑、不可删除、不可篡改。

它不是社交动态流，而是一座有个人温度的数字档案馆。

---

## 特性

- **11 个预设产品分类**：方图 / 壁纸 / 水印 / 底素 / 边角料 / 实拍 / 水印素 / 素刷 / 笔刷 / 预览模板 / 其他。每类独立筛选、显示数量，新增分类只需在 `src/config.js` 追加一行。
- **日期分组时间轴**：按月 → 日两级归档，精确到秒的等宽时间戳、唯一记录编号，桌面端左轴右内容，移动端单列。
- **真实时间**：`created_at` 由 SQLite `strftime('%Y-%m-%dT%H:%M:%fZ','now')` 生成并以 UTC 存储；前端传入的任何时间字段一律丢弃并记录审计。修改设备系统时间、浏览器时间、刷新或重新登录都不会改变历史记录。
- **发布后永久锁定**：数据库 `BEFORE UPDATE / BEFORE DELETE` 触发器 `RAISE(ABORT)` 覆盖 `products`、`product_images`、`audit_log`；API 不提供任何改写/删除端点；`record_hash` 逐用户哈希链 + `server_stamp` 佐证入库时刻。
- **图片内容寻址**：文件名即文件 SHA-256，同内容复用、绝不覆盖替换，魔数校验真实图片类型，`file_hash` 可在完整性校验中复核。
- **多用户隔离**：scrypt 密码哈希、httpOnly Cookie 会话、独立个人主页 `/u/:username`；`user_id` 强制取自会话。
- **完整发布流程**：点击 / 拖拽多图上传、预览、拖拽排序、最终效果预览、发布前二次确认；多图共享同一条记录与同一时间戳。
- **可靠性**：`client_token` 幂等防重复提交、图片失败回滚、启动/发布/退出时自动 `VACUUM INTO` 备份快照、追加式审计日志、一键完整性校验。
- **个人资料可改，档案不可改**：头像、昵称、签名、显示时区、明暗界面、秒级显示均可调整，不影响任何历史作品。
- **响应式与可访问性**：375 / 768 / 1440 三档验证，键盘可达、可见焦点、支持 `prefers-reduced-motion`。

---

## 快速开始

零第三方依赖，需要 **Node.js ≥ 22.5**（使用内置 `node:sqlite`）。

```bash
npm start
# 打开 http://127.0.0.1:4173
```

- 演示档案：`demo` / `demo1234`（也可直接浏览公开时间线）
- 建议注册自己的账号：从注册那一刻起，档案中没有任何预置数据，全部记录都由服务端真实时间生成
- 关闭演示数据：`SEED_DEMO=0 npm start`
- 自定义端口 / 数据目录：`PORT=8080 PT_DB=/path/to/timeline.sqlite PT_UPLOAD_DIR=/path/to/uploads npm start`

常用命令：

```bash
npm start        # 启动服务
npm test         # 19 项安全性与机制测试（隔离数据库，不触碰正式数据）
npm run verify   # 校验哈希链、图片哈希、时间可信度、序号连续性
npm run seed     # 手动生成演示档案（已存在则跳过）
```

---

## 使用示例

1. 注册并登录 → 点击「发布作品」
2. 拖入 1–9 张图片，拖动缩略图或用 ← → 调整顺序
3. 填写名称、选择分类、可留空描述；右侧实时预览最终效果（预览中的时间标注为 `SERVER TIME`，因为发布时间尚未产生，也不由客户端决定）
4. 点击「确认并永久发布」→ 二次确认弹窗 → 写入档案
5. 在首页时间线按日期回看；点击分类只看该品类；点击作品进入详情查看高清原图、UTC 原始记录与哈希
6. 在「设置」里运行完整性校验，查看自己的操作审计日志

主要 HTTP 接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/server-time` | 数据库时钟（UTC），客户端时间可信性对照 |
| POST | `/api/auth/register` · `/login` · `/logout` | 认证 |
| GET | `/api/profile/:username` | 个人信息与统计 |
| GET | `/api/timeline/:username?category=&before=` | 时间线（倒序、分页、分类筛选） |
| GET | `/api/products/:id` | 作品详情 |
| POST | `/api/products` | **唯一写入**：追加一条永久记录（multipart） |
| PATCH | `/api/me` · POST `/api/me/avatar` | 修改个人资料 |
| GET | `/api/verify` · `/api/audit` | 完整性校验与审计日志 |
| PUT / PATCH / DELETE | `/api/products/*` | 一律 `405 IMMUTABLE_RECORD`，并写入审计 |

---

## 安全机制

| 目标 | 实现 |
| --- | --- |
| 时间不可伪造 | 数据库服务器时钟生成 `created_at`；请求体中的 `createdAt` / `timestamp` / `date` 等字段被忽略并审计；`server_stamp` 由数据库 DEFAULT 生成，证明记录不可能携带未来的时间 |
| 内容不可改写 | SQLite 触发器在引擎层 `RAISE(ABORT)`；不存在 UPDATE/DELETE API；`audit_log` 亦为追加式 |
| 记录可验证 | 每位用户一条 `record_hash` 哈希链（含前序哈希、标题、分类、描述、时间、序号、所有图片哈希），`/api/verify` 重算并比对 |
| 图片不可替换 | 内容寻址命名 + `file_hash` + `wx` 独占写入，已存在的同名文件只复用不覆盖 |
| 防重复提交 | `client_token` 唯一约束，重复请求幂等返回原记录 |
| 会话安全 | scrypt 加盐哈希、随机 32 字节令牌仅以哈希入库、httpOnly + SameSite=Lax、Origin 校验 |
| 数据备份 | 启动 / 每次发布 / 退出时生成一致性快照，保留最近 20 份 |

> 管理员删除能力按需求**刻意未实现**。若未来需要违规内容处置，应新增独立管理权限、专用审计日志与软删除标记，而不是放开普通记录的 UPDATE/DELETE。

---

## 项目结构

```
product-timeline/
├── src/
│   ├── server.js      # HTTP 入口、静态站点、启动备份、优雅退出
│   ├── api.js         # REST 路由与安全边界
│   ├── db.js          # Schema、不可篡改触发器、哈希链、时间源、备份
│   ├── auth.js        # 密码哈希与会话 Cookie
│   ├── upload.js      # multipart 解析、魔数校验、内容寻址存储
│   ├── http.js        # 响应、请求体、静态文件与目录穿越防护
│   ├── config.js      # 配置与预设分类
│   ├── png.js         # 零依赖 PNG 生成（仅用于演示素材）
│   ├── seed.js        # 演示档案
│   └── verify.js      # 完整性校验 CLI
├── public/
│   ├── index.html     # SPA 外壳
│   ├── css/styles.css # 设计令牌、组件、动效、响应式
│   └── js/            # core.js（API/时间/DOM）、views.js（页面）、app.js（路由）
├── tests/security.test.js  # 19 项自动化测试
├── data/              # SQLite 数据库与备份快照（运行时生成）
├── uploads/           # 内容寻址图片（运行时生成）
└── README.md
```

数据模型：`users` / `sessions` / `categories` / `products`（含 `record_hash`、`prev_hash`、`seq`、`client_token`、`server_stamp`）/ `product_images`（含 `file_hash`、`sort_order`）/ `audit_log`。

---

## 演示数据说明

`demo` 账号中的 12 条示例记录由**服务端脚本**按「当前服务器时间 − 偏移量」生成，用于展示跨日、跨月的日期分组效果，并在签名中明确标注为演示档案。真实用户账号不含任何预置记录，其每条时间都是发布瞬间数据库时钟的真实取值。可用 `SEED_DEMO=0` 完全关闭演示数据。

---

## 设计定调

面向独立创作者的「数字档案 + iOS 液态玻璃」方向：连续圆角、半透明玻璃卡与 `backdrop-filter` 高斯模糊、彩色光斑折射背景、胶囊按钮与柔和层叠阴影，系统字体栈（无外部字体请求）。同时保留 Editorial 的信息层级与「月份 → 日期 → 精确到秒」的档案日期轴，以及克制的荧光绿强调色。暗色主题与减弱动效均有对应降级。

---

## GitHub Pages 使用界面

`https://yroist0520-ui.github.io/product-timeline/` 直接呈现**完整可使用的网站界面**：时间线、分类筛选、发布作品、作品详情、个人设置，而非跳转页或仓库文件列表。

GitHub Pages 只能托管静态文件，因此 `docs/` 由 `public/` 通过 `npm run build:pages` 生成，并在页面注入 `PT_CONFIG`：

- 页面以 `X-PT-Session` 会话令牌调用真实后端（托管网关会剥离标准 `Authorization` / `Cookie` 头）；
- 发布时间、图片存储、哈希链与不可篡改触发器**仍在服务端**，Pages 只负责界面；
- `404.html` 为子路径刷新兜底；静态资源采用内容哈希文件名，并保留无哈希副本以避开 CDN 10 分钟缓存窗口内的白屏；
- 部署后端需设置 `PT_CORS_ORIGINS=https://yroist0520-ui.github.io`；构建参数可用 `PT_PAGES_API` / `PT_PAGES_SHARECODE` / `PT_PAGES_BASE` 覆盖。

后端服务停止时，Pages 界面将无法读取或写入档案。

---

## License

个人项目，未声明开源许可；如需开源请自行补充 LICENSE。

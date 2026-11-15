'use strict';
// 零依赖 PNG/ICO 图标生成器：用 SDF 绘制「时间轴」品牌图标
//   一根墨色主轴 + 三个节点（上/中为空环，底部为荧光绿实心「最新发布」节点）
//   输出 apple-touch-icon、manifest 图标与浏览器 favicon。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'public');

const PAPER = [245, 243, 237];
const INK = [21, 21, 19];
const ACCENT = [169, 210, 34];

// ── 有符号距离场基元（逻辑坐标 1000×1000，原点居中）──
function sdRoundRect(x, y, w, h, r) {
  const qx = Math.abs(x) - w / 2 + r;
  const qy = Math.abs(y) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function sdCircle(nx, ny, cx, cy, r) { return Math.hypot(nx - cx, ny - cy) - r; }
// 圆环（annulus）：外 R 实心、内 r 镂空
function annulus(nx, ny, cx, cy, R, r) {
  return Math.max(sdCircle(nx, ny, cx, cy, R), -sdCircle(nx, ny, cx, cy, r));
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// 主轴中心 (-140, 0)；三个节点位于 (x=-140, y=-230/0/230)
const SPINE = (nx, ny) => sdRoundRect(nx + 140, ny, 40, 660, 20);
const RING_TOP = (nx, ny) => annulus(nx, ny, -140, -230, 66, 42);
const RING_MID = (nx, ny) => annulus(nx, ny, -140, 0, 66, 42);
const DISC_BOT = (nx, ny) => sdCircle(nx, ny, -140, 230, 66); // <0 内部（绿色实心）
const BAR = (nx, ny, by) => sdRoundRect(nx - 128, ny - by, 404, 28, 14); // 从 -74 到 330

// 墨色覆盖度（<0 内部）
function inkCoverage(nx, ny) {
  let s = SPINE(nx, ny);
  s = Math.min(s, RING_TOP(nx, ny));
  s = Math.min(s, RING_MID(nx, ny));
  s = Math.min(s, BAR(nx, ny, -230));
  s = Math.min(s, BAR(nx, ny, 0));
  s = Math.min(s, BAR(nx, ny, 230));
  return s;
}

function render(size) {
  const aa = 1.6 * (1000 / size);
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size * 1000 - 500;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 1000 - 500;
      const iA = clamp(0.5 - inkCoverage(nx, ny) / aa, 0, 1);
      const gA = clamp(0.5 - DISC_BOT(nx, ny) / aa, 0, 1);
      let r = lerp(PAPER[0], INK[0], iA);
      let g = lerp(PAPER[1], INK[1], iA);
      let b = lerp(PAPER[2], INK[2], iA);
      r = lerp(r, ACCENT[0], gA); g = lerp(g, ACCENT[1], gA); b = lerp(b, ACCENT[2], gA);
      const o = (y * size + x) * 4;
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g); buf[o + 2] = Math.round(b); buf[o + 3] = 255;
    }
  }
  return buf;
}

// ── 最小 PNG 编码器（RGBA, 8bit）──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const cd = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cd), 0);
  return Buffer.concat([len, cd, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── 最小 ICO 编码器（32×32，32bpp BGRA）──
function encodeICO(size, rgba) {
  const dib = Buffer.alloc(40 + size * size * 4);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8); // 高度含 AND mask 区
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // 自下而上
    const dstRow = 40 + y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4, d = dstRow + x * 4;
      dib[d] = rgba[s + 2]; dib[d + 1] = rgba[s + 1]; dib[d + 2] = rgba[s]; dib[d + 3] = rgba[s + 3];
    }
  }
  const andMask = Buffer.alloc(Math.ceil(size * size / 8)); // 全 0 = 全不透明
  const image = Buffer.concat([dib, andMask]);
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size; entry[1] = size;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([dir, entry, image]);
}

const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];
for (const [name, size] of targets) {
  fs.writeFileSync(path.join(OUT_DIR, name), encodePNG(size, size, render(size)));
  console.log('written', name, size + 'px', fs.statSync(path.join(OUT_DIR, name)).size, 'bytes');
}
fs.writeFileSync(path.join(OUT_DIR, 'favicon.ico'), encodeICO(32, render(32)));
console.log('written favicon.ico', '32px');

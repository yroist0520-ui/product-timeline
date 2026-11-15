'use strict';
// 零依赖 PNG 图标生成器：用 SDF 绘制品牌字母 P + 绿色句点，输出 apple-touch-icon 与 manifest 图标。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'public');

const PAPER = [245, 243, 237];
const INK = [21, 21, 19];
const ACCENT = [169, 210, 34];

// 有符号距离场：圆角矩形（中心在原点）
function sdRoundRect(x, y, w, h, r) {
  const qx = Math.abs(x) - w / 2 + r;
  const qy = Math.abs(y) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function sdRect(x, y, w, h) {
  const qx = Math.abs(x) - w / 2;
  const qy = Math.abs(y) - h / 2;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// 逻辑坐标（1000×1000，原点居中）下字母 P 的覆盖度。
// sdRect/sdRoundRect 以原点为中心，故用 (nx±cx, ny±cy) 把矩形平移到目标位置。
function pCoverage(nx, ny) {
  const stem = sdRect(nx + 290, ny, 140, 720);                 // 竖干 中心(-290,0)  → x[-360,-220]
  const bowlOuter = sdRoundRect(nx - 65, ny + 160, 590, 400, 90); // 碗外 中心(65,-160) → x[-230,360] y[-360,40]
  const bowlHole = sdRect(nx - 65, ny + 95, 330, 270, 40);        // 碗洞 中心(65,-95)  → x[-100,230] y[-230,40]
  const union = Math.min(stem, bowlOuter); // SDF 并集取 min（交集才取 max）
  const solid = Math.max(union, -bowlHole); // 减去碗洞：max(d, -洞)
  return solid; // <0 内部
}
function dotCoverage(nx, ny) {
  return sdRoundRect(nx + 185, ny - 320, 48, 48, 24); // 绿色句点，紧贴竖干下端的“P.”效果
}

function render(size) {
  const aa = 1.6 * (1000 / size); // 边缘抗锯齿宽度（逻辑单位）
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size * 1000 - 500;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 1000 - 500;
      const pA = clamp(0.5 - pCoverage(nx, ny) / aa, 0, 1);
      const dA = clamp(0.5 - dotCoverage(nx, ny) / aa, 0, 1);
      let r = lerp(PAPER[0], INK[0], pA);
      let g = lerp(PAPER[1], INK[1], pA);
      let b = lerp(PAPER[2], INK[2], pA);
      r = lerp(r, ACCENT[0], dA); g = lerp(g, ACCENT[1], dA); b = lerp(b, ACCENT[2], dA);
      const o = (y * size + x) * 4;
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g); buf[o + 2] = Math.round(b); buf[o + 3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

// --- 最小 PNG 编码器（RGBA, 8bit）---
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

const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];
for (const [name, size] of targets) {
  fs.writeFileSync(path.join(OUT_DIR, name), render(size));
  console.log('written', name, size + 'px', fs.statSync(path.join(OUT_DIR, name)).size, 'bytes');
}

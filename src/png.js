'use strict';

/**
 * 零依赖 PNG 生成器：仅为演示档案生成抽象设计作品图。
 * 真实用户上传的图片走 uploads/ 内容寻址存储，不经过这里。
 */

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(surface) {
  const { w, h, data } = surface;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * stride] = 0; // filter: none
    data.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hex(color) {
  const s = color.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function blend(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

class Surface {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  gradient(top, bottom) {
    const a = hex(top);
    const b = hex(bottom);
    for (let y = 0; y < this.h; y += 1) {
      const c = blend(a, b, y / Math.max(this.h - 1, 1));
      for (let x = 0; x < this.w; x += 1) {
        const p = (y * this.w + x) * 4;
        this.data[p] = c[0]; this.data[p + 1] = c[1]; this.data[p + 2] = c[2]; this.data[p + 3] = 255;
      }
    }
    return this;
  }

  rect(x, y, w, h, color, alpha = 255) {
    const c = hex(color);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        const p = (yy * this.w + xx) * 4;
        if (alpha >= 255) {
          this.data[p] = c[0]; this.data[p + 1] = c[1]; this.data[p + 2] = c[2]; this.data[p + 3] = 255;
        } else {
          const t = alpha / 255;
          this.data[p] = Math.round(this.data[p] * (1 - t) + c[0] * t);
          this.data[p + 1] = Math.round(this.data[p + 1] * (1 - t) + c[1] * t);
          this.data[p + 2] = Math.round(this.data[p + 2] * (1 - t) + c[2] * t);
          this.data[p + 3] = 255;
        }
      }
    }
    return this;
  }

  circle(cx, cy, r, color, alpha = 255) {
    const c = hex(color);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.w, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.h, Math.ceil(cy + r + 1));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        // 边缘 1px 羽化，避免锯齿
        const edge = Math.min(1, (r - Math.sqrt(d2)) / 1.5);
        const t = (alpha / 255) * edge;
        const p = (y * this.w + x) * 4;
        this.data[p] = Math.round(this.data[p] * (1 - t) + c[0] * t);
        this.data[p + 1] = Math.round(this.data[p + 1] * (1 - t) + c[1] * t);
        this.data[p + 2] = Math.round(this.data[p + 2] * (1 - t) + c[2] * t);
        this.data[p + 3] = 255;
      }
    }
    return this;
  }

  hLine(y, x0, x1, color, thickness = 1, alpha = 255) {
    return this.rect(x0, y, x1 - x0, thickness, color, alpha);
  }

  vLine(x, y0, y1, color, thickness = 1, alpha = 255) {
    return this.rect(x, y0, thickness, y1 - y0, color, alpha);
  }

  grain(rng, strength = 10) {
    for (let p = 0; p < this.data.length; p += 4) {
      const n = (rng() - 0.5) * strength;
      this.data[p] = Math.max(0, Math.min(255, this.data[p] + n));
      this.data[p + 1] = Math.max(0, Math.min(255, this.data[p + 1] + n));
      this.data[p + 2] = Math.max(0, Math.min(255, this.data[p + 2] + n));
    }
    return this;
  }
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const PALETTES = [
  { bg: '#F1EFE7', ink: '#1A1B18', accent: '#C8F04A', soft: '#D8D5C9' },
  { bg: '#202A46', ink: '#F2EFE6', accent: '#8FA8FF', soft: '#3A4770' },
  { bg: '#E9D8C9', ink: '#5B3226', accent: '#C8663C', soft: '#CDB5A2' },
  { bg: '#E6E9DF', ink: '#2F3A2D', accent: '#7E9468', soft: '#C7CEBE' },
  { bg: '#F0E4E4', ink: '#4A2E35', accent: '#D08C97', soft: '#DCC7C8' },
  { bg: '#EDEBE6', ink: '#33322E', accent: '#A9A79F', soft: '#D2CFC7' },
  { bg: '#111214', ink: '#F5F3ED', accent: '#C8F04A', soft: '#2B2D2E' },
  { bg: '#F6F2E8', ink: '#29353B', accent: '#5B8FA8', soft: '#DDD8C8' },
];

/** 生成一张抽象设计作品图，variant 决定构图。 */
function artwork(index, variant = index % 8, w = 720, h = 900) {
  const rng = makeRng(index * 7919 + 13);
  const p = PALETTES[index % PALETTES.length];
  const s = new Surface(w, h);
  s.gradient(p.bg, p.soft);

  switch (variant) {
    case 0: { // 大圆 + 基线
      s.circle(w * 0.52, h * 0.42, w * 0.34, p.accent);
      s.circle(w * 0.52, h * 0.42, w * 0.24, p.bg);
      s.hLine(h * 0.78, w * 0.1, w * 0.9, p.ink, 2);
      s.rect(w * 0.1, h * 0.13, w * 0.16, 6, p.ink);
      break;
    }
    case 1: { // 竖向色带
      const bands = 7;
      for (let i = 0; i < bands; i += 1) {
        s.rect(w * (0.08 + i * 0.125), h * 0.12, w * 0.075, h * 0.76,
          i % 3 === 0 ? p.accent : p.ink, i % 3 === 0 ? 255 : 40 + i * 18);
      }
      s.hLine(h * 0.12, w * 0.08, w * 0.92, p.ink, 2);
      s.hLine(h * 0.88, w * 0.08, w * 0.92, p.ink, 2);
      break;
    }
    case 2: { // 叠印方块
      s.rect(w * 0.12, h * 0.16, w * 0.52, h * 0.46, p.accent);
      s.rect(w * 0.34, h * 0.34, w * 0.52, h * 0.46, p.ink, 205);
      s.rect(w * 0.2, h * 0.68, w * 0.6, h * 0.14, p.ink, 40);
      break;
    }
    case 3: { // 细线网格
      for (let i = 0; i <= 12; i += 1) {
        s.hLine(h * 0.12 + i * (h * 0.76 / 12), w * 0.1, w * 0.9, p.ink, 1, 70);
      }
      for (let i = 0; i <= 9; i += 1) {
        s.vLine(w * 0.1 + i * (w * 0.8 / 9), h * 0.12, h * 0.88, p.ink, 1, 70);
      }
      s.circle(w * 0.5, h * 0.5, w * 0.18, p.accent, 235);
      break;
    }
    case 4: { // 半圆构成
      s.circle(w * 0.28, h * 0.5, w * 0.34, p.ink, 220);
      s.circle(w * 0.74, h * 0.5, w * 0.34, p.accent, 230);
      s.rect(0, h * 0.5, w, h * 0.5, p.bg, 205);
      s.hLine(h * 0.5, 0, w, p.ink, 2);
      break;
    }
    case 5: { // 横条 + 圆点
      for (let i = 0; i < 9; i += 1) {
        s.rect(w * 0.1, h * 0.14 + i * (h * 0.72 / 9), w * (0.42 + rng() * 0.46), 10,
          i % 4 === 0 ? p.accent : p.ink, i % 4 === 0 ? 255 : 150);
      }
      break;
    }
    case 6: { // 中心方框
      s.rect(w * 0.18, h * 0.2, w * 0.64, h * 0.6, p.ink, 230);
      s.rect(w * 0.24, h * 0.26, w * 0.52, h * 0.48, p.bg);
      s.rect(w * 0.3, h * 0.32, w * 0.4, h * 0.36, p.accent);
      s.circle(w * 0.5, h * 0.5, w * 0.12, p.bg);
      break;
    }
    default: { // 散点构成
      for (let i = 0; i < 40; i += 1) {
        const x = w * (0.08 + rng() * 0.84);
        const y = h * (0.1 + rng() * 0.8);
        const r = 3 + rng() * 22;
        s.circle(x, y, r, i % 5 === 0 ? p.accent : p.ink, 40 + rng() * 150);
      }
      s.hLine(h * 0.9, w * 0.08, w * 0.92, p.ink, 2);
    }
  }
  s.grain(rng, 8);
  return encodePng(s);
}

module.exports = { artwork, PALETTES };

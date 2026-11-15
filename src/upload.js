'use strict';

/**
 * multipart/form-data 解析 + 内容寻址图片存储。
 * 文件名 = 文件内容的 SHA-256，因此同名文件永远不会被覆盖替换；
 * 服务端按魔数判定真实图片类型，不信任客户端声明的 Content-Type 或扩展名。
 */

const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');
const { sha256 } = require('./db');

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from('--' + boundary);
  const parts = [];
  let pos = buffer.indexOf(delimiter);
  if (pos < 0) return parts;

  while (pos >= 0) {
    const after = pos + delimiter.length;
    if (buffer.slice(after, after + 2).toString() === '--') break; // 结束分隔符
    const cursor = after + 2; // 跳过 \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = buffer.indexOf(delimiter, bodyStart);
    if (next < 0) break;
    let bodyEnd = next;
    if (bodyEnd >= 2 && buffer[bodyEnd - 2] === 13 && buffer[bodyEnd - 1] === 10) bodyEnd -= 2;

    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    const disposition = headers['content-disposition'] || '';
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    const fileMatch = /filename="([^"]*)"/.exec(disposition);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: fileMatch ? fileMatch[1] : null,
      contentType: (headers['content-type'] || 'application/octet-stream').split(';')[0].trim(),
      data: buffer.slice(bodyStart, bodyEnd),
    });
    pos = next;
  }
  return parts;
}

function multipartBoundary(req) {
  const ct = req.headers['content-type'] || '';
  if (!ct.toLowerCase().startsWith('multipart/form-data')) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  return match ? (match[1] || match[2]).trim() : null;
}

/** 按文件头魔数判定真实类型，返回 { mime, ext }。 */
function detectImage(buf) {
  const has = (offset, bytes) => bytes.every((b, i) => buf[offset + i] === b);
  if (buf.length >= 3 && has(0, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 8 && has(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp' };
  }
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.slice(0, 6).toString('ascii'))) {
    return { mime: 'image/gif', ext: '.gif' };
  }
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand.startsWith('avif') || brand.startsWith('avis')) return { mime: 'image/avif', ext: '.avif' };
  }
  return null;
}

/**
 * 落盘一张图片。已存在同哈希文件时直接复用（绝不覆盖），
 * 若极端情况下同哈希文件内容不同，则改用更长文件名避免覆盖。
 */
function storeImage(buffer) {
  const detected = detectImage(buffer);
  if (!detected) {
    throw Object.assign(new Error('不支持的图片格式，仅接受 JPG / PNG / WEBP / GIF / AVIF'), { status: 400 });
  }
  if (buffer.length > config.MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('单张图片超过 50 MB 限制'), { status: 413 });
  }
  const hash = sha256(buffer);
  const bucket = hash.slice(0, 2);
  const dir = path.join(config.UPLOAD_DIR, bucket);
  fs.mkdirSync(dir, { recursive: true });

  let filename = hash + detected.ext;
  let file = path.join(dir, filename);
  if (fs.existsSync(file)) {
    if (sha256(fs.readFileSync(file)) !== hash) {
      filename = hash.slice(0, 40) + detected.ext;
      file = path.join(dir, filename);
      if (fs.existsSync(file) && sha256(fs.readFileSync(file)) !== hash) {
        throw Object.assign(new Error('图片存储冲突，请重试'), { status: 409 });
      }
    }
  }
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, buffer, { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return {
    imageUrl: `/media/${bucket}/${filename}`,
    fileHash: hash,
    fileSize: buffer.length,
    mime: detected.mime,
  };
}

module.exports = { parseMultipart, multipartBoundary, detectImage, storeImage };

/* Dev tool: generate the PWA icons without dependencies.
   Draws the ReelKeep mark (broadcast-blue rounded square + dark play triangle)
   into an RGBA buffer and encodes PNG with node:zlib. Run: node scripts/gen-icons.mjs */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = [0x58, 0xa6, 0xff];
  const fg = [0x10, 0x11, 0x13];
  const radius = maskable ? 0 : size * 0.22;
  // play triangle geometry (safe zone for maskable: inner 80%)
  const cx = size / 2;
  const cy = size / 2;
  const s = maskable ? size * 0.26 : size * 0.3;
  const x0 = cx - s * 0.55;
  const x1 = cx + s * 0.75;
  const half = s * 0.72;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (radius > 0) {
        const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
        const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
        inside = dx * dx + dy * dy <= radius * radius;
      }
      let color = inside ? bg : [0, 0, 0];
      let alpha = inside ? 255 : 0;
      // triangle: x from x0..x1, half-height shrinks linearly
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        if (Math.abs(y - cy) <= half * (1 - t)) {
          color = fg;
          alpha = 255;
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = alpha;
    }
  }
  return encodePng(size, size, buf);
}

fs.writeFileSync(path.join(OUT, 'icon-192.png'), draw(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), draw(512));
fs.writeFileSync(path.join(OUT, 'maskable-512.png'), draw(512, { maskable: true }));
console.log('icons written: icon-192.png, icon-512.png, maskable-512.png');

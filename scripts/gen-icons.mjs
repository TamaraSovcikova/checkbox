#!/usr/bin/env node
// Generate the PWA icon set from scratch (no image deps) — a full-bleed indigo
// tile with a white checkmark, matching the app's single-indigo brand. Full-bleed
// square is correct for both iOS (rounds apple-touch-icon itself) and Android
// maskable (the platform masks to its shape). Run: node scripts/gen-icons.mjs
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public");
fs.mkdirSync(OUT, { recursive: true });

// ── minimal PNG encoder ──────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── draw the icon ────────────────────────────────────────────────────────────
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function drawIcon(size) {
  const bg = [99, 102, 241]; // indigo-500
  const fg = [255, 255, 255];
  const SS = 4; // supersample for smooth edges
  const rgba = Buffer.alloc(size * size * 4);
  // checkmark polyline in unit coords + stroke half-width
  const p = [[0.28, 0.52], [0.44, 0.68], [0.74, 0.33]];
  const half = 0.052;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / size;
          const uy = (y + (sy + 0.5) / SS) / size;
          const d = Math.min(
            distToSeg(ux, uy, p[0][0], p[0][1], p[1][0], p[1][1]),
            distToSeg(ux, uy, p[1][0], p[1][1], p[2][0], p[2][1])
          );
          if (d <= half) cov++;
        }
      }
      cov /= SS * SS;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(bg[c] * (1 - cov) + fg[c] * cov);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
];
for (const [name, size] of targets) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size));
  console.log("wrote", name, `(${size}x${size})`);
}

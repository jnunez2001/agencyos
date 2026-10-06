// Joshua Nunez
// Makes the Nexus logo files from the artwork: removes the dark background so only the mark is left, crops it to a
// square and writes 512, 128 and 64 px PNGs into public/. No image library: a small PNG reader and writer.
// Run: node scripts/logo-from-image.js path/to/artwork.png   (convert other formats first, for example with sips)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8; let w; let h; let type; let depth; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const kind = buf.toString('ascii', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12] !== 0) throw new Error('Interlaced PNG is not supported'); }
    if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error('Use an 8-bit RGB or RGBA PNG');
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(w * bpp); const row = Buffer.alloc(w * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * bpp + 1)]; const line = raw.subarray(y * (w * bpp + 1) + 1, (y + 1) * (w * bpp + 1));
    for (let i = 0; i < w * bpp; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = row[x * bpp]; out[(y * w + x) * 4 + 1] = row[x * bpp + 1]; out[(y * w + x) * 4 + 2] = row[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? row[x * bpp + 3] : 255; }
    row.copy(prev);
  }
  return { w, h, px: out };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function writePng(file, n, px) {
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Everything dark is background; the pale and the lime parts of the mark stay, with soft edges.
function removeBackground({ w, h, px }, crop) {
  const [x0, y0, x1, y1] = crop;
  const side = Math.max(x1 - x0, y1 - y0);
  const ox = Math.round((x0 + x1) / 2 - side / 2); const oy = Math.round((y0 + y1) / 2 - side / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = ox + x; const sy = oy + y;
    if (sx < x0 || sx >= x1 || sy < y0 || sy >= y1 || sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const i = (sy * w + sx) * 4; const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const lime = smooth(40, 90, g - b);
    const alpha = Math.max(smooth(62, 100, lum), lime);
    const o = (y * side + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(alpha * 255);
  }
  return { side, px: out };
}

function resize({ side, px }, n) {
  const out = Buffer.alloc(n * n * 4); const k = side / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0; let g = 0; let b = 0; let a = 0; let cnt = 0;
    for (let sy = Math.floor(y * k); sy < Math.min(side, Math.ceil((y + 1) * k)); sy++) for (let sx = Math.floor(x * k); sx < Math.min(side, Math.ceil((x + 1) * k)); sx++) {
      const i = (sy * side + sx) * 4; const al = px[i + 3]; r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al; cnt += 1;
    }
    const o = (y * n + x) * 4;
    out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0; out[o + 3] = Math.round(a / cnt);
  }
  return out;
}

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/logo-from-image.js artwork.png'); process.exit(1); }
const img = readPng(src);
// The mark sits in the middle of the artwork (the rest is the tile and its glow).
const crop = [Math.round(img.w * 0.185), Math.round(img.h * 0.2), Math.round(img.w * 0.815), Math.round(img.h * 0.785)];
const mark = removeBackground(img, crop);
const pub = path.join(__dirname, '..', 'public');
for (const [name, n] of [['logo-512.png', 512], ['logo.png', 128], ['favicon.png', 64]]) writePng(path.join(pub, name), n, resize(mark, n));
console.log('Wrote public/logo-512.png, public/logo.png and public/favicon.png');

/**
 * Draws AquaMate's icons (no image tools needed): the app icon that
 * electron-builder turns into .icns/.ico, and the tray / menu-bar icons.
 *
 *   npm run generate:icons
 */
import zlib from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------- PNG encoder
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ shapes
// All coordinates are 0–1 across the image, y down.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function inDrop(x, y, cx, cy, r, tipY) {
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= r * r) return true;
  const h = cy - tipY; // tip above the circle
  const vx = x - cx;
  const vy = y - tipY;
  const along = vy; // axis points straight down from the tip
  if (along <= 0) return false;
  const sinA = r / h;
  const cosA = Math.sqrt(1 - sinA * sinA);
  const len = Math.hypot(vx, vy);
  return along / len >= cosA && along <= (h * h - r * r) / h;
}
function inRoundRect(x, y, x0, y0, x1, y1, rad) {
  const qx = Math.max(x0 + rad - x, 0, x - (x1 - rad));
  const qy = Math.max(y0 + rad - y, 0, y - (y1 - rad));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && qx * qx + qy * qy <= rad * rad;
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inSmile = (x, y, cx, cy, r, w) => {
  const d = Math.hypot(x - cx, y - cy);
  return y > cy && Math.abs(d - r) <= w / 2;
};

/** Supersampled painter: `paint(x, y)` returns [r,g,b,a] (0–255, straight alpha) for a point. */
function render(size, paint, ss = 4) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = paint((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          const al = ca / 255;
          r += cr * al;
          g += cg * al;
          b += cb * al;
          a += al;
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      out[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
    }
  }
  return out;
}

const DROP = { cx: 0.5, cy: 0.585, r: 0.205, tip: 0.17 };
const face = (x, y, s = 1) => {
  const eye = 0.021 * s;
  if (inCircle(x, y, 0.455, 0.585, eye) || inCircle(x, y, 0.545, 0.585, eye)) return true;
  return inSmile(x, y, 0.5, 0.615, 0.05, 0.016 * s);
};

// App icon: blue rounded square, white drop with a friendly face.
const appIcon = (x, y) => {
  const [t0, t1] = [hex('#5cb6ff'), hex('#1f6fd6')];
  let col = [0, 0, 0, 0];
  if (inRoundRect(x, y, 0.1, 0.1, 0.9, 0.9, 0.18)) {
    const k = (y - 0.1) / 0.8;
    col = [...t0.map((c, i) => c + (t1[i] - c) * k), 255];
  }
  if (inDrop(x, y, DROP.cx, DROP.cy, DROP.r, DROP.tip)) {
    col = [255, 255, 255, 255];
    if (inCircle(x, y, 0.42, 0.52, 0.035)) col = [...hex('#d6ebff'), 255];
    if (face(x, y)) col = [...hex('#1f6fd6'), 255];
  }
  return col;
};

// Tray: a plain drop. macOS template images are black + alpha (the OS tints them).
const trayTemplate = (x, y) => (inDrop(x, y, 0.5, 0.6, 0.31, 0.04) ? [0, 0, 0, 255] : [0, 0, 0, 0]);
const trayColor = (x, y) => {
  if (!inDrop(x, y, 0.5, 0.6, 0.31, 0.04)) return [0, 0, 0, 0];
  return inCircle(x, y, 0.4, 0.58, 0.08) ? [...hex('#d6ebff'), 255] : [...hex('#2f80ed'), 255];
};

const write = (file, size, paint, ss) => {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(size, render(size, paint, ss)));
  console.log('Wrote', file);
};
write('build/icon.png', 1024, appIcon);
write('assets/tray/trayTemplate.png', 16, trayTemplate);
write('assets/tray/trayTemplate@2x.png', 32, trayTemplate);
write('assets/tray/tray.png', 16, trayColor);
write('assets/tray/tray@2x.png', 32, trayColor);

// ------------------------------------------------------------------ Android
const res = resolve(root, 'android/app/src/main/res');
if (existsSync(res)) {
  const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const ANDROID_BG = '#3a8eef';
  // Adaptive icon: the white drop on a blue background layer (Android masks the shape).
  const foreground = (x, y) => {
    const u = (x - 0.5) / 0.62 + 0.5; // keep the drop inside the 66% safe zone
    const v = (y - 0.5) / 0.62 + 0.5;
    if (!inDrop(u, v, DROP.cx, DROP.cy, DROP.r, DROP.tip)) return [0, 0, 0, 0];
    if (inCircle(u, v, 0.42, 0.52, 0.035)) return [...hex('#d6ebff'), 255];
    if (face(u, v)) return [...hex('#1f6fd6'), 255];
    return [255, 255, 255, 255];
  };
  const roundIcon = (x, y) => (inCircle(x, y, 0.5, 0.5, 0.48) ? (foreground(x, y)[3] ? foreground(x, y) : [...hex(ANDROID_BG), 255]) : [0, 0, 0, 0]);
  // Notification icons must be a white silhouette; the face is cut out.
  const statusIcon = (x, y) =>
    inDrop(x, y, 0.5, 0.6, 0.31, 0.04) && !inCircle(x, y, 0.42, 0.62, 0.05) && !inCircle(x, y, 0.58, 0.62, 0.05) ? [255, 255, 255, 255] : [0, 0, 0, 0];

  for (const [density, k] of Object.entries(DENSITIES)) {
    write(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, Math.round(48 * k), appIcon);
    write(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, Math.round(48 * k), roundIcon);
    write(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, Math.round(108 * k), foreground);
    write(`android/app/src/main/res/drawable-${density}/ic_stat_aquamate.png`, Math.round(24 * k), statusIcon);
  }
  writeFileSync(
    resolve(res, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ANDROID_BG.toUpperCase()}</color>\n</resources>\n`,
  );

  // Splash screens: the app icon centred on the app background, every size the template uses.
  const bg = hex('#f3f6fa');
  const splash = (w, h) => {
    const side = Math.round(Math.min(w, h) * 0.32);
    const x0 = (w - side) / 2;
    const y0 = (h - side) / 2;
    const out = Buffer.alloc(w * h * 4);
    const ss = 2;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        let r = 0, g = 0, b = 0;
        const inside = px >= x0 - 1 && px <= x0 + side + 1 && py >= y0 - 1 && py <= y0 + side + 1;
        for (let sy = 0; sy < (inside ? ss : 1); sy++) {
          for (let sx = 0; sx < (inside ? ss : 1); sx++) {
            const [cr, cg, cb, ca] = inside ? appIcon((px + (sx + 0.5) / ss - x0) / side, (py + (sy + 0.5) / ss - y0) / side) : [0, 0, 0, 0];
            const a = ca / 255;
            r += cr * a + bg[0] * (1 - a);
            g += cg * a + bg[1] * (1 - a);
            b += cb * a + bg[2] * (1 - a);
          }
        }
        const n = inside ? ss * ss : 1;
        out[i] = Math.round(r / n);
        out[i + 1] = Math.round(g / n);
        out[i + 2] = Math.round(b / n);
        out[i + 3] = 255;
      }
    }
    return out;
  };
  const pngRect = (w, h, rgba) => {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  const writeSplash = (file, w, h) => {
    writeFileSync(resolve(root, file), pngRect(w, h, splash(w, h)));
    console.log('Wrote', file);
  };
  writeSplash('android/app/src/main/res/drawable/splash.png', 480, 320);
  for (const [density, [w, h]] of Object.entries(SPLASH)) {
    writeSplash(`android/app/src/main/res/drawable-port-${density}/splash.png`, w, h);
    writeSplash(`android/app/src/main/res/drawable-land-${density}/splash.png`, h, w);
  }
}

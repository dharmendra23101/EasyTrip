/**
 * Generate the PWA icons (`IMP-115`).
 *
 * **Why a generator rather than committed art.** The icons are derived from the design tokens —
 * `primary-600` is `#0277b4` because `IMP-084` measured it at 4.88:1 for WCAG AA — so hand-drawn
 * files would be a second, silent copy of a colour the project already decided once. Running this
 * regenerates them from the token.
 *
 * **Why no image library.** A PNG of a flat shape is a signature, three chunks and a CRC. Adding
 * sharp or jimp to draw a rounded square would be ~30 MB of dependency for ~60 lines of code, in a
 * project that pruned 15 unused packages in `IMP-068` and is still working through `IMP-119`'s
 * advisory backlog.
 *
 * > ⚠️ **These are functional placeholders, not final identity.** The mark is a simple geometric
 * > pin on the brand colour — enough for a real, installable icon, deliberately not a design
 * > decision made unilaterally. Final icon art belongs to `IMP-120`'s visual pass, and the
 * > limitation is recorded in `KNOWN_LIMITATIONS.md`.
 *
 *     node scripts/generate-pwa-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../frontend/public/icons');

/** `primary-600`. Single-sourced from the reasoning in tailwind.config.js — see IMP-084. */
const BRAND = [0x02, 0x77, 0xb4];
const WHITE = [0xff, 0xff, 0xff];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

/** Encode an RGBA pixel buffer as a PNG. */
const encodePng = (width, height, pixels) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12 are compression, filter and interlace methods; 0 for all three.

  // Each scanline is prefixed with its filter type. 0 (None) keeps this readable; the shapes are
  // flat colour, so the deflate stream is tiny either way.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

/**
 * Draw the mark: a map pin — a circle over a downward triangle — centred on the brand colour.
 *
 * `maskable` insets the artwork to 60% so it survives the circular and squircle crops Android and
 * iOS apply. Without that inset a maskable icon has its edges shaved off, which is the usual reason
 * an installed PWA looks broken on one platform and fine on another.
 */
const drawIcon = (size, { maskable = false } = {}) => {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.6 : 0.78;

  const cx = size / 2;
  const headY = size * 0.42;
  const headR = (size * scale) / 4;
  const tipY = headY + size * scale * 0.42;
  const halfWidth = headR * 0.92;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;

      const dx = x - cx;
      const dy = y - headY;
      const inHead = dx * dx + dy * dy <= headR * headR;

      // The triangle below the circle, narrowing linearly to the tip.
      let inTail = false;
      if (y >= headY && y <= tipY) {
        const t = (y - headY) / (tipY - headY);
        inTail = Math.abs(dx) <= halfWidth * (1 - t);
      }

      // A hole in the middle of the head, so the pin reads as a pin rather than a lollipop.
      const inHole = dx * dx + dy * dy <= headR * 0.38 * (headR * 0.38);

      const colour = (inHead || inTail) && !inHole ? WHITE : BRAND;
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = 0xff; // fully opaque — a transparent PWA icon renders on an unknown ground
    }
  }

  return encodePng(size, size, pixels);
};

mkdirSync(OUT_DIR, { recursive: true });

const written = [];
for (const [name, size, options] of [
  // 192 and 512 are the two sizes Chrome's installability check looks for.
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // Separate maskable variants: the same file cannot be both, because `purpose: "maskable"`
  // promises the safe-zone inset and `purpose: "any"` promises the artwork fills the frame.
  ['icon-192-maskable.png', 192, { maskable: true }],
  ['icon-512-maskable.png', 512, { maskable: true }],
  // iOS ignores the manifest's icons and reads `apple-touch-icon` instead, at 180.
  ['apple-touch-icon.png', 180, {}]
]) {
  const file = join(OUT_DIR, name);
  writeFileSync(file, drawIcon(size, options));
  written.push(`${name} (${size}x${size})`);
}

console.log(`Wrote ${written.length} icons to frontend/public/icons:`);
for (const line of written) console.log(`  ${line}`);

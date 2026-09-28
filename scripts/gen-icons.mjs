#!/usr/bin/env node
/**
 * Draws every app icon from scratch: the Nova "N", a road that climbs, crosses
 * and climbs again - a Kigali switchback - with its lane markings.
 *
 * The mark is geometry, not a picture: one centreline, a road width, and a
 * dashed lane down the middle. Each pixel is sampled sixteen times against
 * that shape, which gives clean anti-aliased edges at any size, and the PNGs
 * are written with Node's own zlib - no image library, no image generator.
 * Change a number here and every icon follows.
 *
 * Run from the repository root: node scripts/gen-icons.mjs
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---- the mark, in its own units: 500 wide, 560 tall ----------------------------
const ROAD = 150; // road width
const LANE = 14; // lane marking width
const DASH = 48;
const GAP = 38;
const INSET = 34; // lane markings stop short of the road's two ends
const TURN = 58; // and leave the two turns clear, so no dash bends round one
const W = 500;
const H = 560;
// Up the left, down the diagonal, up the right. The two turns are rounded by
// the road's own width; the two ends are cut square by the top and bottom.
const PATH = [
  [ROAD / 2, H],
  [ROAD / 2, ROAD / 2],
  [W - ROAD / 2, H - ROAD / 2],
  [W - ROAD / 2, 0],
];

const segs = [];
for (let i = 0; i < PATH.length - 1; i += 1) {
  const [ax, ay] = PATH[i];
  const [bx, by] = PATH[i + 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  // Each straight gets its own run of dashes, centred between its clear ends,
  // so both ends of every run look the same.
  const from = i === 0 ? INSET : TURN;
  const to = len - (i === PATH.length - 2 ? INSET : TURN);
  const n = Math.max(0, Math.floor((to - from + GAP) / (DASH + GAP)));
  const run = n * DASH + Math.max(0, n - 1) * GAP;
  segs.push({ ax, ay, dx, dy, len, first: from + (to - from - run) / 2, count: n });
}

/** 0 outside, 1 on the road, 2 on a lane marking. */
function sample(x, y, lanes) {
  if (y < 0 || y > H) return 0;
  let best = Infinity;
  let seg = segs[0];
  let along = 0;
  for (const s of segs) {
    let t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / (s.len * s.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (s.ax + t * s.dx), y - (s.ay + t * s.dy));
    if (d < best) {
      best = d;
      seg = s;
      along = t * s.len;
    }
  }
  if (best > ROAD / 2) return 0;
  if (lanes && best <= LANE / 2) {
    const u = along - seg.first;
    if (u >= 0 && u < seg.count * (DASH + GAP) - GAP && u % (DASH + GAP) < DASH) return 2;
  }
  return 1;
}

// ---- rendering --------------------------------------------------------------------
const SUB = 4;

/**
 * @param size canvas side in pixels
 * @param box where the mark sits: { top, height } in pixels, centred across
 * @param field background colour, or null for transparent
 * @param glyph the road's colour
 * @param lanes draw the lane markings (off at favicon size, where they would be mush)
 */
function render({ size, box, field, glyph, lanes = true }) {
  const k = box.height / H;
  const left = size / 2 - (W * k) / 2;
  const top = box.top;
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      // Skip the empty margin quickly.
      const mx0 = (px - left) / k;
      const my0 = (py - top) / k;
      if (mx0 > -2 / k && mx0 < W + 2 / k && my0 > -2 / k && my0 < H + 2 / k) {
        for (let j = 0; j < SUB; j += 1) {
          for (let i = 0; i < SUB; i += 1) {
            const mx = (px + (i + 0.5) / SUB - left) / k;
            const my = (py + (j + 0.5) / SUB - top) / k;
            if (sample(mx, my, lanes) === 1) hits += 1;
          }
        }
      }
      const cover = hits / (SUB * SUB);
      const o = (py * size + px) * 4;
      if (field) {
        for (let c = 0; c < 3; c += 1) data[o + c] = Math.round(field[c] + (glyph[c] - field[c]) * cover);
        data[o + 3] = 255;
      } else {
        for (let c = 0; c < 3; c += 1) data[o + c] = glyph[c];
        data[o + 3] = Math.round(255 * cover);
      }
    }
  }
  return png(size, size, data);
}

// ---- a minimal PNG writer: RGBA, 8 bits, no filtering -------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- the files --------------------------------------------------------------------------
const BLUE = [0x00, 0x57, 0xe7]; // packages/ui tokens: Nova blue
const WHITE = [0xff, 0xff, 0xff];

/**
 * The two apps keep inverse icons. A rider has both installed - they are a
 * passenger when they are not working - and two identical tiles on one
 * launcher is a support call every time they open the wrong one.
 */
const APPS = {
  passenger: { field: BLUE, glyph: WHITE },
  rider: { field: WHITE, glyph: BLUE },
};

// Where the mark sits in each file, matching the space the platform leaves for
// it: full bleed for the store icon, Android's safe zone for the adaptive
// layers, a comfortable margin for the splash.
const ICON = { top: 225, height: 572 };
const ADAPTIVE = { top: 307, height: 408 };
const SPLASH = { top: 246, height: 531 };
const FAVICON = { top: 12, height: 39 };

for (const [app, { field, glyph }] of Object.entries(APPS)) {
  const dir = `apps/${app}/assets`;
  const out = (name, buf) => {
    writeFileSync(`${dir}/${name}`, buf);
    console.log(`${dir}/${name}`);
  };
  out("icon.png", render({ size: 1024, box: ICON, field, glyph }));
  out("favicon.png", render({ size: 64, box: FAVICON, field, glyph, lanes: false }));
  // Android composites these layers itself; the lane markings are holes, so
  // the background layer shows through them.
  out("android-icon-foreground.png", render({ size: 1024, box: ADAPTIVE, field: null, glyph }));
  out("android-icon-monochrome.png", render({ size: 1024, box: ADAPTIVE, field: null, glyph: WHITE }));
  out("android-icon-background.png", render({ size: 1024, box: ADAPTIVE, field, glyph: field, lanes: false }));
  // The splash sits on the light page ground in both apps, so its mark is blue
  // in both - a white road on an off-white splash is an invisible splash.
  out("splash-icon.png", render({ size: 1024, box: SPLASH, field: null, glyph: BLUE }));
}

#!/usr/bin/env node
/**
 * Regenerates every app icon from the ones already on disk, recoloured.
 *
 * The mark itself - the Gera "G" - is not redrawn here. Each existing PNG is
 * one of two shapes: a glyph on transparency (an alpha mask), or a glyph on a
 * solid field (two opaque colours with anti-aliased pixels blended between
 * them). Both can be recoloured exactly, so a change of palette is a change of
 * four hex values rather than a round trip through an image generator.
 *
 * The anti-aliased pixels are the whole reason this is a script. Recolouring by
 * exact match leaves a fringe of the old colour one pixel wide around every
 * curve, which at launcher size reads as a halo. Projecting each pixel onto the
 * line between the two source colours recovers the coverage the renderer
 * originally computed, and re-blends it against the new pair.
 *
 * Run: node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

/** The palette, mirroring packages/ui/src/tokens.ts. */
const BLUE = [0x00, 0x57, 0xe7];
const WHITE = [0xff, 0xff, 0xff];

/** What is on disk today: an indigo glyph on an amber field, and its inverse. */
const OLD_INDIGO = [0x14, 0x1b, 0x34];
const OLD_AMBER = [0xf5, 0xa5, 0x24];

/**
 * The two apps keep inverse icons. A rider has both installed - they are a
 * passenger when they are not working - and two identical tiles on one
 * launcher is a support call every time they open the wrong one.
 */
const APPS = {
  passenger: { field: BLUE, glyph: WHITE },
  rider: { field: WHITE, glyph: BLUE },
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/**
 * Coverage of the glyph in a pixel of a two-tone image.
 *
 * Projects the pixel onto the vector from field to glyph and returns where it
 * falls, clamped. An exact field pixel gives 0, an exact glyph pixel gives 1,
 * and the anti-aliased pixels in between give back the fraction the renderer
 * used.
 */
function coverage(px, field, glyph) {
  let dot = 0;
  let len = 0;
  for (let c = 0; c < 3; c += 1) {
    const axis = glyph[c] - field[c];
    dot += (px[c] - field[c]) * axis;
    len += axis * axis;
  }
  if (len === 0) return 0;
  return Math.min(1, Math.max(0, dot / len));
}

/** A glyph on a solid field: recolour both, preserving the anti-aliasing. */
function recolourTwoTone(png, fromField, fromGlyph, toField, toGlyph) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = coverage([d[i], d[i + 1], d[i + 2]], fromField, fromGlyph);
    d[i] = lerp(toField[0], toGlyph[0], t);
    d[i + 1] = lerp(toField[1], toGlyph[1], t);
    d[i + 2] = lerp(toField[2], toGlyph[2], t);
  }
  return png;
}

/**
 * A glyph on transparency: the alpha channel already is the coverage, so only
 * the colour channels change. Fully transparent pixels get the new colour too -
 * leaving the old one there is invisible until something composites against a
 * different background and the halo reappears.
 */
function recolourMask(png, to) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = to[0];
    d[i + 1] = to[1];
    d[i + 2] = to[2];
  }
  return png;
}

/** A single flat colour, for the adaptive icon's background layer. */
function fill(png, to) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = to[0];
    d[i + 1] = to[1];
    d[i + 2] = to[2];
    d[i + 3] = 255;
  }
  return png;
}

const load = (p) => PNG.sync.read(readFileSync(p));
const save = (p, png) => writeFileSync(p, PNG.sync.write(png));

for (const [app, { field, glyph }] of Object.entries(APPS)) {
  const dir = `apps/${app}/assets`;

  // Which of the two old colours was this app's field. The passenger and rider
  // icons are inverses of each other, so the same source pair reads in both
  // directions and the answer cannot be hard-coded.
  const iconPng = load(`${dir}/icon.png`);
  const corner = [iconPng.data[0], iconPng.data[1], iconPng.data[2]];
  const cornerIsAmber =
    coverage(corner, OLD_INDIGO, OLD_AMBER) > 0.5;
  const oldField = cornerIsAmber ? OLD_AMBER : OLD_INDIGO;
  const oldGlyph = cornerIsAmber ? OLD_INDIGO : OLD_AMBER;

  save(`${dir}/icon.png`, recolourTwoTone(iconPng, oldField, oldGlyph, field, glyph));
  save(
    `${dir}/favicon.png`,
    recolourTwoTone(load(`${dir}/favicon.png`), oldField, oldGlyph, field, glyph),
  );

  // The adaptive icon's layers, which Android composites itself.
  save(`${dir}/android-icon-background.png`, fill(load(`${dir}/android-icon-background.png`), field));
  save(`${dir}/android-icon-foreground.png`, recolourMask(load(`${dir}/android-icon-foreground.png`), glyph));

  // The monochrome layer is the themed-icon mask. Android tints it itself, so
  // it stays white and is never recoloured here.

  // The splash sits on the light page ground in both apps, so its mark is blue
  // in both - a white glyph on an off-white splash is an invisible splash.
  save(`${dir}/splash-icon.png`, recolourMask(load(`${dir}/splash-icon.png`), BLUE));

  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  console.log(`${app}: field ${hex(field)}, glyph ${hex(glyph)}`);
}

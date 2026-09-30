# Illustration prompts

Everything inside the apps is drawn in code (SVG): the Imigongo band, the zigzag receipt edge, the hill scenes in empty states and the vehicle glyphs. Only the two welcome pictures are raster images, and the four service tiles on the passenger home screen can take one each. This page has prompts for all of them, and for a cab version later, in Gemini or any other image model.

## Where the files go

| Image | File | Size |
|---|---|---|
| Passenger welcome | `apps/passenger/assets/welcome-hero.jpg` | 1280 × 714 |
| Rider welcome | `apps/rider/assets/welcome-hero.jpg` | 1280 × 714 |
| Moto tile | `apps/passenger/assets/tiles/moto.png` | 288 × 288, transparent |
| Cab tile | `apps/passenger/assets/tiles/cab.png` | 288 × 288, transparent |
| Book ahead tile | `apps/passenger/assets/tiles/later.png` | 288 × 288, transparent |
| Regular trip tile | `apps/passenger/assets/tiles/regular.png` | 288 × 288, transparent |

Keep the 1280 × 714 proportion. Both welcome screens size the picture as `width × 714 / 1280`, so a different ratio gets stretched unless that line changes too. Export as JPEG at about 85% quality, under 250 KB.

## The shared style

Paste this block at the start of every prompt, so each new picture matches the existing ones:

```text
Flat vector illustration, clean and calm, in the style of a modern transport
brand. Thin, even dark-grey outlines (not black). Muted palette: sage and olive
greens for hills, cool greys for road and shadows. Exactly two brand colours:
a deep midnight blue (#0A2342) for the motorbike, and a bright yellow (#F4C20D)
used only on the rider's safety vest. Nothing else is saturated. The sky is a
flat, very light cool grey (#F5F7FA) with no gradient, clouds or sun, so the
picture blends into a page of the same colour.
No text, no logos, no watermark, no border. Wide landscape composition, 16:9.
Rwanda: steep green hills, terraced slopes, red-earth roadsides, eucalyptus
trees.
```

## Passenger welcome

The current picture was drawn for the old blue brand: the rider's jacket and the motorbike are cobalt. Redraw it with this prompt so the vest is yellow and the motorbike midnight.

```text
[shared style]
A small 125cc commuter motorcycle, the kind Kigali moto-taxis use, carrying a
rider and one passenger along a winding road through terraced hills, seen from
behind and slightly to the side. Both wear full-face helmets in dark grey. The
rider wears a bright yellow safety vest over a dark jacket; the motorbike is
midnight blue. The passenger holds a small bag. The road curves away into the
hills on the left third of the picture. The motorbike sits in the right third,
lower half. Calm, early-morning light, with no people other than these two.
```

## Rider welcome

The current rider picture shows a large touring motorbike in the old blue. Kigali's motos are small commuter bikes, and a rider will notice. This prompt corrects both:

```text
[shared style]
A moto-taxi rider standing beside a small 125cc commuter motorcycle on a
hilltop road, looking out over green hills and a distant town, seen from
behind and slightly to the side. They wear a full-face grey helmet and a
bright yellow safety vest with a large midnight-blue number 24 on the back. A
second, passenger helmet hangs from the handlebar. The motorbike is midnight
blue and grey, with a flat passenger seat. The rider and motorbike sit in the left
third of the picture. A thin road winds down into the valley on the right.
Quiet, steady mood, as if at the start of a shift.
```

If the vest number comes out garbled, ask for "a plain yellow vest with no number", then add the number yourself in any image editor in Montserrat ExtraBold, midnight blue (#0A2342).

## Service tiles

Until these exist, each tile shows a drawn glyph in a coloured square: yellow for Moto, midnight for Cab, pale green for Book ahead and pale amber for Regular trip. A picture replaces the glyph, so it has to read at 46 points, about the size of a thumbnail. One object, big, no scene.

Image models rarely give a true transparent background. Ask for plain white, then remove it with any background remover (Canva has one) and export a PNG with transparency, under 60 KB.

These use their own short style block instead of the shared one, because a tile is an icon, not a landscape:

```text
Flat vector icon illustration, three-quarter front view, centred, filling
about 80% of a square canvas. Thin, even dark-grey outlines (#1F2937). Flat
fills, at most one soft shade per surface, no gradients, no shadow under the
object. Plain white background. No text, no logos, no number plates.
```

Moto tile:

```text
[tile style]
A small 125cc commuter motorcycle, the kind Kigali moto-taxis use, with a
flat two-person seat and a grey passenger helmet hanging from the handlebar.
The body is midnight blue (#0A2342) with grey mechanical parts. Nobody on it.
```

Cab tile:

```text
[tile style]
A small white four-door sedan with one yellow stripe (#F4C20D) along its side
and a small yellow roof sign with no lettering. Grey windows, dark-grey tyres.
```

Book ahead tile:

```text
[tile style]
A desk calendar page with a small midnight-blue (#0A2342) alarm clock leaning
against it, the clock hands at half past seven. Calendar page white with a
green (#15803D) top band. No numbers or letters on the calendar.
```

Regular trip tile:

```text
[tile style]
Two curved arrows chasing each other in a circle around a tiny midnight-blue
(#0A2342) moto-taxi, like a repeat symbol. The arrows are amber (#B45309).
```

To use them, point the tile's `art` at the file in `apps/passenger/src/home/ServiceTiles.tsx`, for example `art: require("../../assets/tiles/moto.png")`. Check each on the tile's coloured square: the moto on yellow, the cab on midnight.

## A cab version, for when cabs launch

```text
[shared style]
A small white four-door sedan with one midnight blue stripe along its side,
driving up a hill road in Kigali past terraced slopes and a few low buildings
with red-earth verges. Seen from the front three-quarter view, in the right
third of the picture, headlights on. No visible number plate text. Calm, late
afternoon.
```

## Things to leave out

Add these to the prompt if a result drifts:

```text
Avoid: photorealism, 3D rendering, gradients, glossy highlights, lens flare,
drop shadows under the whole scene, text or lettering (other than the vest
number), flags, national symbols, crowds, wildlife, safari imagery, tourist
clichés, and any saturated colour other than the midnight blue and the yellow.
```

## Before you swap a file in

- Check the sky really is flat `#F5F7FA`. A slightly different grey shows as a box against the page.
- The subject must still read at 390 pixels wide, the size of a small phone.
- Keep the description in `welcome.tsx` (`accessibilityLabel`) true to the new picture.

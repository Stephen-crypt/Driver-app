# Illustration prompts

Most of what is inside the apps is drawn in code (SVG): the Imigongo band, the zigzag receipt edge, the hill scenes in empty states and the vehicle glyphs. Nine pictures are raster images, all made in Gemini from the prompts below: the two welcome pictures, the four service tiles and the book-ahead banner on the passenger home screen, the round cab scene on the passenger's empty Activity screen, and the night scene on the staff dashboard's sign-in. The prompts are here for redrawing any of them.

## Where the files go

| Image | File | Size |
|---|---|---|
| Passenger welcome | `apps/passenger/assets/welcome-hero.jpg` | 1280 × 714 |
| Rider welcome | `apps/rider/assets/welcome-hero.jpg` | 1280 × 714 |
| Moto tile | `apps/passenger/assets/tiles/moto.png` | 288 × 288, transparent |
| Cab tile | `apps/passenger/assets/tiles/cab.png` | 288 × 288, transparent |
| Book ahead tile | `apps/passenger/assets/tiles/later.png` | 288 × 288, transparent |
| Regular trip tile | `apps/passenger/assets/tiles/regular.png` | 288 × 288, transparent |
| No trips yet | `apps/passenger/assets/empty-trips.png` | 600 × 600, transparent outside the circle |
| Dashboard sign-in | `apps/dashboard/public/login-hero.jpg` | at least 1600 × 2000 (4:5, portrait) |
| Home banner | `apps/passenger/assets/banner-ahead.png` | 600 × 600, transparent outside the circle |

Keep the 1280 × 714 proportion. Both welcome screens size the picture as `width × 714 / 1280`, so a different ratio gets stretched unless that line changes too. Export as JPEG at about 85% quality, under 250 KB.

Gemini's output never lands exactly on these sizes or on a transparent background, so each picture was cropped, resized and cleaned up after it was made. The sky in both welcome pictures was pulled onto the page's exact grey, `#F5F7FA`. The tiles and the cab scene had their white backgrounds cut away, working in from the edges only, so white inside an outline stays: the cab's body, the calendar page. Each tile was then cropped to its subject.

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

The current picture came from this prompt: a rider in a yellow vest and a passenger with a bag, on a midnight motorbike.

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

The current picture came from this prompt. The rider sits on the motorbike rather than standing beside it, which reads just as well. Kigali's motos are small commuter bikes, and a rider will notice anything bigger, so keep "125cc commuter" in any redraw:

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

## Dashboard sign-in

The left half of the staff sign-in is this picture, edge to edge, with the logo and the headline set in white over the top of it. The top of the picture must be empty night sky in exactly the panel's midnight, or the white words disappear into it; the sky of the current one was pulled onto #0A2342 after it was made. Without the file, the panel falls back to the midnight and the diamond pattern on their own.

```text
Flat vector illustration, clean and calm, in the style of a modern transport
brand. Thin, even outlines in a dark blue-grey, not black. Night scene with a
limited palette: the sky is one flat, solid midnight blue (#0A2342) with no
gradient, no stars, no moon and no clouds. Hills in deep, muted blue-greens a
few shades lighter than the sky. The only bright colour is a warm yellow
(#F4C20D), used for lit windows, headlights and a rider's safety vest.

Kigali at night, seen from a hilltop road: terraced hills in the middle
distance, the city across the valley shown as small warm yellow window lights,
and a winding road coming down towards the viewer. In the lower third, on the
road, a small 125cc moto-taxi with a rider in a bright yellow safety vest and
a full-face helmet, carrying one passenger. Its headlight is a small yellow
dot, with no beam of light. Two or three more motos far away on other roads,
shown only as tiny yellow dots.

Portrait, 4:5. The top 40% of the picture is empty flat midnight sky and
nothing else, because text goes there. Keep the moto and the city in the lower
middle, with nothing important within 10% of the left or right edge. No text,
no logos, no watermark, no border, and no people other than the rider and the
passenger.
```

If a result drifts, add: "Avoid photorealism, 3D, gradients, glows, light beams, lens flare, stars, the moon, neon."

## Home banner

The yellow "Tomorrow's commute, sorted" banner on the passenger home screen borrows the calendar from the Book ahead tile, so the same picture shows twice on one screen. This gives the banner its own. It sits on yellow, so the scene is drawn inside a pale blue circle that keeps it apart from the banner.

```text
[tile style]
A small 125cc moto-taxi waiting at the gate of a house in the early morning.
The motorbike is midnight blue (#0A2342); its rider wears a yellow safety vest
and holds out a second helmet for the passenger. A small sun just above the
gate. The whole scene sits inside a pale blue (#E8EEF8) circle; the rest of
the canvas is plain white.
```

## Service tiles

Each tile shows its picture at 76 points on a light grey tile, with no coloured square behind it: the picture carries its own colour. It has to read at that size, so one object, big, no scene. If a picture is ever removed, the tile falls back to a drawn glyph in a coloured square.

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

Each tile's `art` in `apps/passenger/src/home/ServiceTiles.tsx` points at its file. To swap one, replace the PNG and keep the name.

## The cab scene

This prompt was meant for a wide cab welcome picture. Gemini drew it as a round scene instead, which suits an empty state better: it is the picture above "No trips yet" on the passenger's Activity screen.

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

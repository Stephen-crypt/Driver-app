# Illustration prompts

Everything inside the apps is drawn in code (SVG): the Imigongo band, the zigzag receipt edge, the hill scenes in empty states and the vehicle glyphs. Only the two welcome pictures are raster images. This page has prompts for redrawing them, or for adding a cab version later, in Gemini or any other image model.

## Where the files go

| Image | File | Size |
|---|---|---|
| Passenger welcome | `apps/passenger/assets/welcome-hero.jpg` | 1280 × 714 |
| Rider welcome | `apps/rider/assets/welcome-hero.jpg` | 1280 × 714 |

Keep the 1280 × 714 proportion. Both welcome screens size the picture as `width × 714 / 1280`, so a different ratio gets stretched unless that line changes too. Export as JPEG at about 85% quality, under 250 KB.

## The shared style

Paste this block at the start of every prompt, so each new picture matches the existing ones:

```text
Flat vector illustration, clean and calm, in the style of a modern transport
brand. Thin, even dark-grey outlines (not black). Muted palette: sage and olive
greens for hills, cool greys for road and shadows. Exactly one saturated
colour, a strong cobalt blue (#0057E7), used only on the rider's vest or jacket
and the motorbike. The sky is a flat, very light cool grey (#F2F3F7) with no
gradient, clouds or sun, so the picture blends into a page of the same colour.
No text, no logos, no watermark, no border. Wide landscape composition, 16:9.
Rwanda: steep green hills, terraced slopes, red-earth roadsides, eucalyptus
trees.
```

## Passenger welcome

The current picture is right and does not need redrawing. Use this for a variant, such as a seasonal one.

```text
[shared style]
A small 125cc commuter motorcycle, the kind Kigali moto-taxis use, carrying a
rider and one passenger along a winding road through terraced hills, seen from
behind and slightly to the side. Both wear full-face helmets: the rider's is
cobalt blue, the passenger's light grey. The rider wears a cobalt blue vest
over a jacket. The passenger holds a small bag. The road curves away into the
hills on the left third of the picture. The motorbike sits in the right third,
lower half. Calm, early-morning light, with no people other than these two.
```

## Rider welcome

The current rider picture shows a large touring motorbike. Kigali's motos are small commuter bikes, and a rider will notice. This prompt corrects it:

```text
[shared style]
A moto-taxi rider standing beside a small 125cc commuter motorcycle on a
hilltop road, looking out over green hills and a distant town, seen from
behind and slightly to the side. They wear a full-face grey helmet and a
cobalt blue safety vest with a large white number 24 on the back. A second,
passenger helmet hangs from the handlebar. The motorbike is cobalt blue and
grey, with a flat passenger seat. The rider and motorbike sit in the left
third of the picture. A thin road winds down into the valley on the right.
Quiet, steady mood, as if at the start of a shift.
```

If the vest number comes out garbled, ask for "a plain cobalt blue vest with no number", then add the number yourself in any image editor in white Barlow Condensed Bold.

## A cab version, for when cabs launch

```text
[shared style]
A small white four-door sedan with one cobalt blue stripe along its side,
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
clichés, and any colour other than blue as an accent.
```

## Before you swap a file in

- Check the sky really is flat `#F2F3F7`. A slightly different grey shows as a box against the page.
- The subject must still read at 390 pixels wide, the size of a small phone.
- Keep the description in `welcome.tsx` (`accessibilityLabel`) true to the new picture.

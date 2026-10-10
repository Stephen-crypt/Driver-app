# Dark mode — design

Date: 2026-10-10. Status: design approved in conversation; this document awaits review.

## 1. Intent

**What the owner said:** dark mode is an expected feature. By default each app follows
the phone (the dashboard follows the computer), and there is an Appearance choice:
Match phone / Light / Dark. In the phone apps a change takes effect by restarting
the app; the dashboard switches instantly.

**Assumptions the owner accepted:** all three surfaces (passenger app, rider app,
staff dashboard); the maps go dark too; the brand stays recognisable.

**Done looks like:** with the phone in dark mode, both apps open dark, including the
map; Account → Appearance switches theme in about a second; the dashboard has an
Appearance control that switches instantly and is remembered; every text/ground
pairing in the dark palette passes the same contrast bar as the light one.

## 2. The look: Nova at night

The light design is "Light on midnight": a pale page, white cards, midnight header
blocks, yellow for the one action. At night the page itself becomes the night.

| Role | Light | Dark | Note |
|---|---|---|---|
| Page (`surface`) | `#F5F7FA` | `#0A1220` | the midnight, deeper |
| Card (`surfaceRaised`) | `#FFFFFF` | `#131B2B` | |
| Nested card (`surfaceHigh`) | `#EEF1F5` | `#1C2537` | |
| Hairline (`border`) | `#E5E7EB` | `#2A3447` | |
| Text / strong / muted | `#4B5563` / `#1F2937` / `#5F6B7A` | `#C3C9D4` / `#FFFFFF` / `#9AA2B1` | |
| Working colour (`accent`) | midnight `#0A2342` | mist `#C9D4E6` | buttons, links, active tab, route origin |
| `onAccent` | white | midnight `#0A2342` | navy type on mist |
| `accentSoft` | `#E7E9EC` | `#1C2A44` | chips, icon wells |
| `accentDeep` | `#061A33` | `#DCE4F0` | a marker's ground |
| `highlight` / `highlightSoft` / `onHighlight` | `#F4C20D` / `#FDF3CF` / midnight | `#F4C20D` / `#2A2410` / midnight | yellow is the anchor; unchanged |
| success / soft | `#15803D` / `#DCFCE7` | `#4ADE80` / `#12281F` | lifted to read on night |
| danger / soft | `#B91C1C` / `#FEE2E2` | `#F87171` / `#2B1614` | |
| warning / soft | `#B45309` / `#FDF1E3` | `#FBBF24` / `#2A2010` | |
| info | `#1D4ED8` | `#93C5FD` | |
| origin / destination | midnight / green | mist / `#4ADE80` | route ends |
| Hero / raised | `#0A2342` / `#16345C` | `#142C4F` / `#1F3E6B` | a touch brighter than the page, so it still stands apart |
| onHero / onHeroMuted | white / `#B4C0D3` | white / `#B4C0D3` | |
| Tiles blue / yellow / green / amber | pale tints | `#162238` / `#2A2410` / `#12281F` / `#2A2010` | |

Rules:
- Yellow keeps every job it has: the forward action, the vest patch, the PIN, the
  ETA, being online, the key figure on a hero. Midnight type on it, as before.
- Everything that was midnight on a light page (primary buttons, links, the active
  tab's pill, the route origin dot) becomes mist with navy type. The hero blocks stay
  navy, one step brighter than the page.
- Contrast bar, enforced by test: body, muted and accent text AA (4.5) on the page
  and on a card; strong text (fares, PINs) AAA (7); type on the accent, on the
  highlight and on the hero AA; success and danger AA; the hero against the page at
  least 1.3:1 so the block has an edge.
- Shadows stay midnight-tinted; on a dark page they mostly vanish, which is fine.

## 3. Choosing the theme

`Appearance = "system" | "light" | "dark"`, default `"system"`.

**Phones.** The choice is stored on the phone in a one-line file in the app's
document directory (`appearance.txt`), read **synchronously** when the app starts
(`File.textSync()` from expo-file-system, which ships with this Expo version; on web,
`localStorage`). `"system"` resolves through `Appearance.getColorScheme()`. The
result picks `lightTheme` or `darkTheme` at the moment the kit's theme module is
evaluated, before any screen is built; every screen keeps reading `c` as it does
today, so no screen changes. Changing the choice writes the file and calls Expo's
`reloadAppAsync()`: the app restarts in about a second on the home screen (a live
trip comes straight back, as today). If the phone flips theme while the app is open,
it changes on the next open.

Both apps' `app.json` change `userInterfaceStyle` from `"light"` to
`"automatic"` (plus `expo-system-ui`, which Android needs for that setting), and the
splash screen gets a `dark` variant with the night background. The status bar's
resting style becomes light icons on dark and dark icons on light; screens that open
on a hero keep asking for light icons as they do now.

**Dashboard.** The choice is kept in `localStorage` (`nova.appearance`). `"system"`
follows `prefers-color-scheme` and reacts to it changing. The chosen theme is applied
as CSS custom properties (as `main.tsx` does today) plus `color-scheme`, so native
form controls follow. A small Appearance control sits in the sidebar footer next to
your name: three options, Match system / Light / Dark, applied instantly. The live
map restyles itself on change.

Shared pure code in `@nova/ui`: `resolveScheme(choice, systemScheme) → "light" |
"dark"` and `parseAppearance(raw) → Appearance` (anything unrecognised is `"system"`).

## 4. Maps

A dark paint set for the same Positron layers, applied by `brandMapStyle(style,
scheme)` on the dashboard and by the WebView page on the phones (the page is built
from the resolved theme at startup, like everything else):

- ground `#121A28`, residential `#151E2D`, park `#16281E`, wood `#142419`, water
  `#0F2238`, buildings `#1A2436` with `#22304A` outlines;
- minor roads `#2A3650`, major `#34435E` with `#1A2436` casing, motorway `#3E4F6E`;
  the minor-road casing becomes `#1F2A3E`;
- labels `#AEB9CC` with a `#0A1220` halo; village and town names `#E3EAF5`; water
  labels `#7FA3D1`; boundaries `#3A4A66`;
- the place icons keep their sprite; their text takes the label colours above.

Nova's own marks on a dark map: the route line is mist (`#DCE4F0`) with a night edge;
the straight-line guess stays dashed mist; the pickup dot is mist with a night ring;
the drop-off pin stays green; the rider marker stays yellow-on-navy. The dashboard's
`MIDNIGHT` constant comes from the theme instead.

## 5. What stays as it is

A pass over the hard-coded colours (22 in the apps and kit) with these decisions:
the Rwanda flag, the white tick on the green success mark, the white QR quiet zones
(a QR must stay scannable), the camera overlays on the inspector's scanner, the
vest stripe and the shimmer highlight all stay. The toast pill changes from charcoal
to the hero colour so its pastel icons read in both themes (in light this makes it
midnight rather than charcoal). Illustrations draw from the palette already and
follow it.

## 6. Testing

- Vitest in `@nova/ui`: the contrast cases in §2 run against `darkTheme` as well as
  the shipped light theme; `resolveScheme` and `parseAppearance`; the dark map paint
  names exactly the layers the light one does, and `brandMapStyle(style, "dark")`
  applies it.
- Typecheck for the kit and both apps; the dashboard build.
- Browser run-through of both apps and the dashboard in both themes, side by side,
  screen by screen (welcome, sign-in, home, search, ride sheet, live trip, receipt,
  Account, the rider's offer, trip panel and receipt; every dashboard page). Dark is
  driven by the stored choice and by an emulated `prefers-color-scheme: dark`.

## 7. Rollout

1. Dashboard: live as soon as it is built (static files).
2. Phones: APK v5 for both apps — the `app.json` change and the new native modules
   need a build. Until then phones stay light.

## 8. Not in this version

Live switching on the phones (no restart), per-screen overrides, a scheduled or
sunset-based switch, a dark variant of the printed vehicle sticker.

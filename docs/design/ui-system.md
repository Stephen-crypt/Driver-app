# Nova interface system: Signal & Hill

This is the reference for how the passenger app, the rider app and the control room look and move. It is written for whoever builds the next screen: every rule here has a component in `@nova/kit` (apps) or `apps/dashboard/src/styles.css` (web) that already does it.

## What the product is, and who it is for

Company-run motos and cabs in Kigali, with three audiences:

- **Passengers** book a few times a week. They need confidence (the price, the rider, the PIN) and speed.
- **Riders** use the app all shift, outdoors, in sun, on a mount, sometimes with gloves. It has to be readable at arm's length and hard to mis-tap.
- **The control room** watches the city all day. It needs to be calm, dense, and loud only when something is wrong.

## The direction

**Signal**: Nova reads like good transport wayfinding. Headlines and every figure that matters are set in Montserrat's heavy cuts; everything read at length is Inter. Important figures roll into place like an odometer rather than popping in.

**Hill**: Kigali's hills and Rwanda's Imigongo geometry (zigzags and diamonds, traditionally black, white and red soil) appear as quiet texture in exactly three places: the welcome screens, receipts, and empty states. They are drawn in midnight blue, never as decoration on working screens.

The colours and type come from the URUMURI brand book. Midnight blue is the working colour. Urumuri yellow is the accent, and it is kept for the few things a person has to find at a glance: the vest patch, the PIN, being online, the button that accepts an offer, the button that books. Green, red and amber are signals only (done, danger, warning) and are never used as backgrounds.

## Tokens

| Token | Value | Use |
|---|---|---|
| Ground (light grey) | `#F5F7FA` | Page |
| Card | `#FFFFFF` | Groups, sheets |
| Silver | `#E5E7EB` | Hairlines |
| Charcoal | `#1F2937` | Headings, figures |
| Slate | `#4B5563` | Body text |
| Midnight blue | `#0A2342` | Buttons, links, the active tab, the route origin |
| Urumuri yellow | `#F4C20D` | Vest patches, the PIN, the online slab, Accept and Book. Always with midnight type; never white |
| Success, error, warning | `#15803D`, `#B91C1C`, `#B45309` | As text and icons, on their own tints. The brand book's brighter `#16A34A` and `#DC2626` fail as text on the page ground, so these are the same hues one step deeper |
| Scrim | `rgba(11,13,18,0.48)` | Behind modal sheets |

**Type**: Montserrat for headlines and figures (SemiBold 18, Bold 22 to 28, ExtraBold 40 and 56 for the fare and the PIN), Inter for body (Regular 16/24), labels (Medium 14/20) and captions (Medium 12/18). The brand book's ramp starts at 48 for an H1, which is a poster size; on a phone the screen title takes the H3 step. Figures use tabular numerals so a ticking number never shuffles sideways.

**Corner radius** is a hierarchy, not one value everywhere. A sheet is 28, a card 20, a control 14, an icon well 12, a chip is a pill, and buttons are pills.

**Elevation**: cards sit flat on the ground with no shadow. Only things that float get a shadow: sheets over the map, map buttons, toasts, modals.

## Motion

From Emil Kowalski's design-engineering rules and Uber Base's sheet behaviour ([emil-design-eng](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md), [animate-expo](https://github.com/emilkowalski/skills/blob/main/skills/animate-expo/SKILL.md), [Base sheet](https://base.uber.com/6d2425e9f/p/033e0d-sheet)).

| Name | Curve / config | For |
|---|---|---|
| `ease.out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything appearing or leaving |
| `ease.inOut` | `cubic-bezier(0.77, 0, 0.175, 1)` | Something moving across the screen |
| `ease.sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets and drawers |
| `spring.drag` | duration 300, damping ratio 0.85, with finger velocity | Anything let go after a drag |

| Interaction | Duration |
|---|---|
| Press feedback (scale 0.97) | 120 ms |
| Chips, toggles, segments | 180 ms |
| Content entering | 260 ms, staggered 40 ms, at most 8 items |
| Sheets, modals | 320 ms in, 250 ms out (exits about 20% faster) |

Rules:

- Only `transform` and `opacity` animate. Never width, height, margin or top.
- Never animate from `scale(0)`; start at 0.95 with opacity 0.
- Nothing seen a hundred times a day animates. Switching tabs moves the lane marker and nothing else.
- Haptics fire in the same frame as the visual change, once per action, and never on their own.
- With reduced motion on, movement is dropped and fades stay.
- Time that runs out drains, linearly, at its real speed: the offer's Accept button and the free-waiting bar. An eased bar would lie about how much time is left.
- Clocks do not roll. A countdown digit that turned every second would be mid-turn more often than readable.

## Signature moments

1. **Odometer numerals**: the fare, ETA, earnings, PIN and vest number roll digit by digit.
2. **Route rail**: pickup (a ring) and drop-off (a square) joined by a line, like a transit diagram. It is the same everywhere: search, trip cards, receipts, history.
3. **Rider found**: the one orchestrated moment in the passenger flow. The vest patch rolls to the rider's number, then their name and plate follow.
4. **Receipts** end in an Imigongo zigzag edge.

## The pieces

Screens are built from these, so they behave the same everywhere. All live in `@nova/kit` unless marked.

| Piece | What it is for |
|---|---|
| `Screen` | A scrolling page with a large title that hands over to a compact bar. Children arrive in turn; `gap` spaces them. |
| `Paper`, `Swap` | The sheet on the map. Its height eases to its content; `Swap` crossfades one state into the next. |
| `ModalSheet`, `useOverlay()` | Bottom sheets, action sheets, confirmations and toasts. Replaces every native alert. |
| `Press` | The one pressable: sinks on press-in, settles on release, dims instead under reduced motion. |
| `Odometer` | Rolling figures. |
| `RouteRail` | Pickup ring, line, drop-off square. |
| `TripProgress`, `StepTrack` | Where a trip or a sign-up is, as segments. |
| `ChoiceRow`, `CheckMark`, `RadioMark` | Checklists and one-of-several choices. The box dips as it fills; with an icon the row takes a soft blue wash. |
| `Segmented` | Two to four options side by side. An option with a `tone` (OK, Fail) turns the pill that colour. |
| `QuickAction` | A round action with its name under it: call, message, navigate, cancel. A yellow dot on its corner marks something unread. |
| `ChatSheet` | The thread between passenger and rider, open only while the trip is on. Fixed replies sit above the composer, so the common answer is one tap. |
| `Timeline` | What happened, in order: a dot per step, a line between, the time on the right and an optional note (a cancellation's reason) under it. |
| `Ticket` (passenger app) | A booked-ahead ride: the time, a QR code carrying the trip's id, a short reference (`NV-` and six characters), the route and the locked price, with a torn edge. |
| `ServiceTiles` (passenger app) | The four things a passenger can ask for on the home screen: a moto or a cab now, a ride booked ahead, or a regular trip. A tile takes a drawn picture when one exists. |
| `SlideToConfirm` | Anything that must not happen by accident: going online, arriving, finishing a trip. |
| `SuccessMark`, `LiveDot`, `Skeleton`, `EmptyState` | Done, live, loading, and nothing yet. |
| `DrainBar` (rider app) | Time running out. |
| `UiProvider`, `Palette` (dashboard) | Toasts, confirm and prompt dialogs, and Ctrl+K to jump to a section or find a rider or trip. |

## Things this system does not do

- No middle-dot meta strings ("A · B · C"). Information goes on separate lines, or gets an icon or a tag.
- No ALL-CAPS labels above headings.
- No gradient washes, glass blur or emoji.
- No identical shadowed cards for every list item. Lists are rows on one surface.
- No "→" appended to button text.
- No native `Alert` for choices. It does nothing on the web and looks foreign on Android. Choices use the kit's action sheet, and confirmations use its confirm sheet. The dashboard has the same rule: no `window.alert`, `confirm` or `prompt`.

## Assets

Every illustration is drawn in code (SVG) so it stays sharp, themable and small. The app icons are drawn by `scripts/gen-icons.mjs`: the Nova "N" as a switchback road with its lane markings, yellow on midnight for passengers and the inverse for riders. [illustration-prompts.md](illustration-prompts.md) has prompts for the two raster welcome images, the four home-screen service tiles, and a cab version.

# Nova interface system: Signal & Hill

This is the reference for how the passenger app, the rider app and the control room look and move. It is written for whoever builds the next screen: every rule here has a component in `@nova/kit` (apps) or `apps/dashboard/src/styles.css` (web) that already does it.

## What the product is, and who it is for

Company-run motos and cabs in Kigali, with three audiences:

- **Passengers** book a few times a week. They need confidence (the price, the rider, the PIN) and speed.
- **Riders** use the app all shift, outdoors, in sun, on a mount, sometimes with gloves. It has to be readable at arm's length and hard to mis-tap.
- **The control room** watches the city all day. It needs to be calm, dense, and loud only when something is wrong.

## The direction

**Signal**: Nova reads like good transport wayfinding. Barlow comes from highway signage. Numbers are set in Barlow Condensed, the way vests, plates and departure boards are, and important figures roll into place like an odometer rather than popping in.

**Hill**: Kigali's hills and Rwanda's Imigongo geometry (zigzags and diamonds, traditionally black, white and red soil) appear as quiet texture in exactly three places: the welcome screens, receipts, and empty states. They are drawn in Nova blue, never as decoration on working screens.

There is one brand hue, blue. Green, red and amber are signals only (done, danger, warning) and are never used as backgrounds.

## Tokens

| Token | Value | Use |
|---|---|---|
| Ground | `#F2F3F7` | Page |
| Card | `#FFFFFF` | Groups, sheets |
| Ink | `#0B0D12` | Primary text |
| Nova blue | `#0057E7` | Actions, links, the one accent |
| Vest blue | `#0A3A9C` | Vest patches, the online slab |
| Scrim | `rgba(11,13,18,0.48)` | Behind modal sheets |

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
| `QuickAction` | A round action with its name under it: call, navigate, cancel. |
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

Every illustration is drawn in code (SVG) so it stays sharp, themable and small. The app icons are drawn by `scripts/gen-icons.mjs`: the Nova "N" as a switchback road with its lane markings, white on blue for passengers and the inverse for riders. [illustration-prompts.md](illustration-prompts.md) has prompts for the two raster welcome images, if they are ever redrawn, and for a cab version.

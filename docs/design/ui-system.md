# Nova interface system: Light on midnight

This is the reference for how the passenger app, the rider app and the control room look and move. It is written for whoever builds the next screen: every rule here has a component in `@nova/kit` (apps) or `apps/dashboard/src/styles.css` (web) that already does it.

## What the product is, and who it is for

Company-run motos and cabs in Kigali, with three audiences:

- **Passengers** book a few times a week. They need confidence (the price, the rider, the PIN) and speed.
- **Riders** use the app all shift, outdoors, in sun, on a mount, sometimes with gloves. It has to be readable at arm's length and hard to mis-tap.
- **The control room** watches the city all day. It needs to be calm, dense, and loud only when something is wrong.

## The direction

*Urumuri* means light. Every main screen opens on the night: a solid midnight block, the **hero**, holding who you are and the one thing the screen is for, with a faint Imigongo panel of nested diamonds drawn into it. Below the hero everything is lit: white cards on a pale ground, and the first card often rides up over the hero's rounded edge. The yellow is the light itself. It is the action that moves you forward (Book, Accept, Get started), the tab you are on, the radar looking for your rider, the ETA, and the one figure on a midnight card: the fare, the week's earnings.

Headlines and every figure that matters are set in Montserrat's heavy cuts; everything read at length is Inter. Important figures roll into place like an odometer rather than popping in.

Things are recognised by picture and by tint before they are read. Motos and cabs are drawn, not glyphs, on the home tiles, the vehicle choice, the rider card and the rider's own vehicle. Each kind of thing has its own pale ground: yellow for a moto, blue for a cab, green for booking ahead, amber for a regular trip, and the same four for earnings, trips and cash on the rider's stat tiles.

The colours and type come from the URUMURI brand book. Green, red and amber are signals (done, danger, warning); their pale tints are grounds, their full colours never are.

## Tokens

| Token | Value | Use |
|---|---|---|
| Ground (light grey) | `#F5F7FA` | Page |
| Card | `#FFFFFF` | Groups, sheets |
| Silver | `#E5E7EB` | Hairlines |
| Charcoal | `#1F2937` | Headings, figures |
| Slate | `#4B5563` | Body text |
| Midnight blue | `#0A2342` | The hero, the active tab's pill, secondary buttons, links, the route origin |
| Midnight lift | `#16345C` | The hero's pattern, and chips, tracks and buttons that sit on the hero |
| Mist | `#B4C0D3` | Secondary type on midnight (8.9:1) |
| Urumuri yellow | `#F4C20D` | The forward action, the vest patch, the PIN, the ETA, being online, and the key figure on midnight. Always with midnight type on it; as type itself only on midnight (9.4:1) |
| Tints | `#FEF6D9` yellow, `#E8EEF8` blue, `#E4F5EA` green, `#FDEEDD` amber | Tile grounds, one per kind of thing |
| Success, error, warning | `#15803D`, `#B91C1C`, `#B45309` | As text and icons, on their own tints. The brand book's brighter `#16A34A` and `#DC2626` fail as text on the page ground, so these are the same hues one step deeper |
| Scrim | `rgba(11,13,18,0.48)` | Behind modal sheets |

**Type**: Montserrat for headlines and figures (SemiBold 18, Bold 22 to 28, ExtraBold 40 and 56 for the fare and the PIN), Inter for body (Regular 16/24), labels (Medium 14/20) and captions (Medium 12/18). The brand book's ramp starts at 48 for an H1, which is a poster size; on a phone the screen title takes the H3 step. Figures use tabular numerals so a ticking number never shuffles sideways.

**Corner radius** is a hierarchy, not one value everywhere. The hero's bottom edge is 32, a sheet 28, a tile 24, a card 20, a control 14, an icon well 12, and chips, tabs and buttons are pills.

**Elevation**: shadows are tinted midnight, never black. A card on the ground has a soft one (18 blur, 7%). Things that float get a stronger one: sheets over the map, the tab dock, map buttons, toasts. The yellow action button and yellow cards glow a little in a darker yellow, like the light they are.

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
- Nothing seen a hundred times a day animates much. Switching tabs fades the new tab's name into its pill, and nothing else moves.
- Haptics fire in the same frame as the visual change, once per action, and never on their own.
- With reduced motion on, movement is dropped and fades stay.
- Time that runs out drains, linearly, at its real speed: the offer's Accept button and the free-waiting bar. An eased bar would lie about how much time is left.
- Clocks do not roll. A countdown digit that turned every second would be mid-turn more often than readable.

## Signature moments

1. **Odometer numerals**: the fare, ETA, earnings, PIN and vest number roll digit by digit.
2. **The radar**: while a rider is being found, yellow rings and a sweep go out from the pickup on the map, and a yellow bar runs along the sheet.
3. **Route rail**: pickup (a ring) and drop-off (a square) joined by a line, like a transit diagram. It is the same everywhere: search, trip cards, receipts, history.
4. **Rider found**: the one orchestrated moment in the passenger flow. The vest patch rolls to the rider's number, then their name and plate follow.
5. **Receipts** end in an Imigongo zigzag edge. What a passenger pays is set on midnight with a yellow Imigongo band, and the rider's offer puts the fare there too, beside the countdown.

## The pieces

Screens are built from these, so they behave the same everywhere. All live in `@nova/kit` unless marked.

| Piece | What it is for |
|---|---|
| `Screen` | A scrolling page with a large title that hands over to a compact bar. Children arrive in turn; `gap` spaces them. With `brand`, it opens on the hero: the title in white, whatever `hero` holds under it, and `overlap` lets the first card ride over the edge. |
| `Hero`, `HeroPattern` | The midnight block and its Imigongo diamonds, for screens that build their own header: home, search, the rider's offer. |
| `Card`, `SectionTitle` | A white card with the soft shadow (or `tone="hero"` midnight, `tone="yellow"` for the one thing to act on), and a section's name over its cards. `Group` is a titled card of rows. |
| `TabBar` | The white dock. The tab you are on is a midnight pill with a yellow icon and its name; the others are icons. |
| `VehicleArt` | The drawn moto and cab (Cab XL is the cab with an XL tag). |
| `StatTile` | One figure on a tinted tile with an icon: earned today, trips, cash to hand in. |
| `MoodRating` | Five faces from Awful to Great, in place of stars. The chosen face fills yellow. |
| `AuthScreen`, `StepDots`, `AuthSwitch` | Every sign-in and sign-up step: the night on top with the step's scene and yellow step dots (sign-up only), and a white sheet rising over it with the one question, the action pinned at the bottom, and the way across ("Already have an account? Log in"). |
| Scenes: `PhoneScene`, `CodeScene`, `NameScene`, `IdScene`, `DocsScene`, `ReviewScene`, `StaffScene` | Small arrangements of the product's own pieces floating on the night, each arriving on its own beat: the flag and the moto; the text message with its code; the rider-on-the-way card that fills in with the name being typed; an ID card and licence; documents and the camera; the "You're approved" message and the vest to come. |
| `AuthArt` | The icon badge the scenes replaced, kept for empty states in its light version. |
| `PhoneField`, `RwandaFlag` | The phone number with its country: the flag drawn in code, +250, digits grouped as they are typed ("788 123 456"), and a tick once it is long enough. |
| `OtpBoxes`, `ResendRow` | The code as six white boxes, the one waiting for a digit lit yellow; under it, a pill counting down to "Send a new code" and a way back for a wrong number. |
| `WelcomePager` | The first screen: the picture grown to fill the top and cropped around its subject, then the night with a few things to know, one per swipe, page dots, and two ways in - create an account (yellow) or log in (outlined) - with a small third link. |
| `AuthNote` | A reassurance under a form: an icon on a blue tint and one sentence. |
| `BellButton`, `NotificationList` | The bell with the unread count in yellow, and the inbox behind it: notifications by day, each on the tint of what it is about, unread ones marked with a yellow edge and a dot. |
| `ReasonSheet` | Cancelling with a reason: a radio list, "Something else" with room to write, a red confirm that waits for a reason, and "keep" as the easy way out. |
| `TripCard` (passenger app) | A past trip in Activity: the time, how it ended, the price, the route, and Receipt and Book again. |
| `SafetyCards` (passenger app) | A strip of four cards to swipe on the home screen: the PIN, the vest and plate, sharing a trip, the fixed price. |
| `Paper`, `Swap` | The sheet on the map. Its height eases to its content; `Swap` crossfades one state into the next. |
| `ModalSheet`, `useOverlay()` | Bottom sheets, action sheets, confirmations and toasts. Replaces every native alert. |
| `Press` | The one pressable: sinks on press-in, settles on release, dims instead under reduced motion. |
| `Odometer` | Rolling figures. |
| `RouteRail` | Pickup ring, line, drop-off square. |
| `TripProgress`, `StepTrack` | Where a trip or a sign-up is, as segments. |
| `ChoiceRow`, `CheckMark`, `RadioMark` | Checklists and one-of-several choices. The box dips as it fills; with an icon the row takes a soft blue wash. |
| `Segmented` | Two to four options side by side, as pill tabs: a midnight pill on the page, a yellow one with `onHero`. An option with a `tone` (OK, Fail) turns the pill that colour. |
| `QuickAction` | A round action with its name under it: call, message, navigate, cancel. A yellow dot on its corner marks something unread. |
| `ChatSheet` | The thread between passenger and rider, open only while the trip is on. Fixed replies sit above the composer, so the common answer is one tap. |
| `Timeline` | What happened, in order: a dot per step, a line between, the time on the right and an optional note (a cancellation's reason) under it. |
| `Ticket` (passenger app) | A booked-ahead ride: the time, a QR code carrying the trip's id, a short reference (`NV-` and six characters), the route and the locked price, with a torn edge. |
| `ServiceTiles` (passenger app) | The four things a passenger can ask for on the home screen: a moto or a cab now, a ride booked ahead, or a regular trip. Each tile shows a drawn picture of what it books. |
| `SlideToConfirm` | Anything that must not happen by accident: going online, arriving, finishing a trip. |
| `SuccessMark`, `LiveDot`, `Skeleton`, `EmptyState` | Done, live, loading, and nothing yet. An empty state carries the same drawn badge as the sign-in steps, in its light version. |
| `DrainBar` (rider app) | Time running out. |
| `UiProvider`, `Palette` (dashboard) | Toasts, confirm and prompt dialogs, and Ctrl+K to jump to a section or find a rider or trip. |
| Dashboard shell (`App.tsx`) | A midnight sidebar grouped into Operations, People, and Money and records, each section with its icon and a yellow marker on the open one; your initial in yellow at the foot; a top bar with the section, a live marker, the Kigali time and search. |
| Dashboard pages (`styles.css`) | Each page opens on a midnight band with the diamond panel, and its first cards ride over the band's edge. Side columns (Cases, Zones) carry the band without the overlap. |
| `Kpi`, `Sparkline`, `DayBars`, `Donut`, `Empty`, `Icon` (dashboard `components/kit.tsx`) | A figure card with a tinted icon, the change since the day before (green or red by which way is good) and a week as a line; seven days as stacked bars; parts of a whole as a ring; drawn empty states; two dozen stroke icons. |
| Dashboard sign-in | Split screen: the night-time Kigali illustration (`apps/dashboard/public/login-hero.jpg`) with the headline over its empty sky, beside a form with icons in the fields, a show-password toggle and a Caps Lock warning. |

## Things this system does not do

- No middle-dot meta strings ("A · B · C"). Information goes on separate lines, or gets an icon or a tag.
- No ALL-CAPS labels above headings.
- No gradient washes, glass blur or emoji.
- No identical shadowed cards for every list item. A list is rows inside one card.
- No "→" appended to button text.
- No native `Alert` for choices. It does nothing on the web and looks foreign on Android. Choices use the kit's action sheet, and confirmations use its confirm sheet. The dashboard has the same rule: no `window.alert`, `confirm` or `prompt`.

## Assets

Most illustration is drawn in code (SVG) so it stays sharp, themable and small. The exceptions are nine raster pictures: the two welcome pictures, the four service tiles, the book-ahead banner, the round cab scene on the empty Activity screen, and the dashboard's sign-in scene. The app icons are drawn by `scripts/gen-icons.mjs`: the Nova "N" as a switchback road with its lane markings, yellow on midnight for passengers and the inverse for riders. [illustration-prompts.md](illustration-prompts.md) has the prompts they came from, their sizes and where each file goes.

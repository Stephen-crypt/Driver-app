import { Platform } from "react-native";
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  cubicBezier,
} from "react-native-reanimated";

/**
 * Motion tokens. Every animation in both apps takes its curve and its length
 * from here, so the product moves one way.
 *
 * The values come from design-engineering practice rather than taste:
 * ease-out for anything entering or leaving (fast start, so the interface
 * feels like it answered), ease-in-out for something moving across the
 * screen, and the iOS sheet curve for sheets. Nothing uses ease-in - it starts
 * slow, and a slow start reads as lag. See docs/design/ui-system.md.
 */
export const ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
} as const;

/** The same curves for Reanimated's CSS transitions. */
export const cssEase = {
  out: cubicBezier(0.23, 1, 0.32, 1),
  inOut: cubicBezier(0.77, 0, 0.175, 1),
  sheet: cubicBezier(0.32, 0.72, 0, 1),
} as const;

/** Milliseconds. Mobile UI stays under 300 ms except sheets. */
export const dur = {
  press: 120,
  small: 180,
  enter: 260,
  sheet: 320,
  /** Exits run about a fifth faster than entrances. */
  sheetOut: 250,
  stagger: 40,
  /** An odometer digit rolling to its value. */
  roll: 620,
} as const;

/** Springs for anything a finger let go of: they carry its velocity. */
export const spring = {
  drag: { duration: 300, dampingRatio: 0.85 },
  settle: { duration: 420, dampingRatio: 1 },
} as const;

/** At most this many items stagger; the rest arrive with the last of them. */
const MAX_STAGGER = 8;

/**
 * On the web, Reanimated pins any element whose entrance has custom start
 * values to an absolute position once the animation ends - which collapses the
 * layout around it (a sheet shrinks to nothing, a list stops scrolling). The
 * web build therefore uses the stock presets, which it leaves alone; phones
 * get the gentler custom rise.
 */
const WEB = Platform.OS === "web";

/**
 * Content arriving on a screen: a short rise and a fade, staggered by index.
 * Layout animations follow the system's reduced-motion setting on their own.
 */
export function enter(index = 0, delay = 0) {
  const b = FadeInDown.duration(dur.enter).delay(delay + Math.min(index, MAX_STAGGER) * dur.stagger).easing(ease.out);
  return WEB ? b : b.withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] });
}

/** For things that should only fade: overlays, swapped text. */
export const fadeIn = FadeIn.duration(dur.small).easing(ease.out);
export const fadeOut = FadeOut.duration(dur.press).easing(ease.out);

/** A toast or a banner dropping in from the top edge, and leaving the same way. */
const dropBase = FadeInUp.duration(300).easing(ease.out);
export const dropIn = WEB ? dropBase : dropBase.withInitialValues({ opacity: 0, transform: [{ translateY: -14 }] });
export const dropOut = FadeOutUp.duration(240).easing(ease.out);

/** A panel swapping in a sheet: rises a little less than content does. */
const swapBase = FadeInDown.duration(dur.enter).easing(ease.out);
export const swapIn = WEB ? FadeIn.duration(dur.enter).easing(ease.out) : swapBase.withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] });
export const swapOut = FadeOutDown.duration(dur.press).easing(ease.out);

/** A container whose contents change size: its size change animates. */
export const settle = LinearTransition.duration(dur.enter).easing(ease.inOut);

/** A full-height panel rising into place: the offer, the receipt. */
export const sheetIn = SlideInDown.duration(dur.sheet).easing(ease.sheet);
export const sheetOut = SlideOutDown.duration(dur.sheetOut).easing(ease.out);

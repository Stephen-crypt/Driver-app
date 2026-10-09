import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ease, enter, swapIn, swapOut } from "./anim";
import { c, radius, shadow, space, tokens } from "./theme";
import { Txt, type Tone } from "./Txt";
import { IconButton, type IconName } from "./controls";
import { Press } from "./Press";
import { Odometer } from "./Odometer";
import { Hero } from "./brand";

// ---------------------------------------------------------------------------
// Rows. Lists are rows on one surface separated by hairlines - not a card per
// item. A wall of identical cards makes every item look equally important.
// ---------------------------------------------------------------------------

type WellTone = "accent" | "good" | "bad" | "warn" | "neutral";

const WELL: Record<WellTone, { bg: string; fg: string }> = {
  accent: { bg: c.accentSoft, fg: c.accent },
  good: { bg: c.successSoft, fg: c.success },
  bad: { bg: c.dangerSoft, fg: c.danger },
  warn: { bg: c.warningSoft, fg: c.warning },
  neutral: { bg: c.surfaceHigh, fg: c.textMuted },
};

export function Well({ icon, tone = "accent", size = 38 }: { readonly icon: IconName; readonly tone?: WellTone; readonly size?: number }) {
  return (
    <View style={[styles.well, { width: size, height: size, borderRadius: Math.round(size * 0.32), backgroundColor: WELL[tone].bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.47)} color={WELL[tone].fg} />
    </View>
  );
}

interface RowProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconName;
  readonly iconTone?: WellTone;
  readonly value?: string;
  readonly valueTone?: Tone;
  /** A small line under the value: "cash", "07:30". */
  readonly valueNote?: string;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly leading?: ReactNode;
  /** Show the whole subtitle - for advice that must be read, not skimmed. */
  readonly full?: boolean;
  readonly accessibilityLabel?: string;
}

export function Row({
  title,
  subtitle,
  icon,
  iconTone = "accent",
  value,
  valueTone = "strong",
  valueNote,
  onPress,
  trailing,
  leading,
  full,
  accessibilityLabel,
}: RowProps) {
  const body = (
    <>
      {leading ?? (icon ? <Well icon={icon} tone={iconTone} /> : null)}
      <View style={styles.rowText}>
        <Txt v="bodyStrong" lines={full ? undefined : 1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt v="label" tone="muted" lines={full ? undefined : 2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value || valueNote ? (
        <View style={styles.rowValueBox}>
          {value ? (
            <Txt v="figure" tone={valueTone} tabularNums style={styles.rowValue}>
              {value}
            </Txt>
          ) : null}
          {valueNote ? (
            <Txt v="caption" tone="muted">
              {valueNote}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {trailing}
      {onPress && !trailing ? <Ionicons name="chevron-forward" size={18} color={c.textMuted} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Press
      onPress={onPress}
      scaleTo={1}
      bg={c.surfaceRaised}
      pressedBg={c.surfaceHigh}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      style={styles.row}
    >
      {body}
    </Press>
  );
}

export function Divider({ inset = 0 }: { readonly inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A titled group of rows on one white card. */
export function Group({
  title,
  meta,
  action,
  children,
  style,
}: {
  readonly title?: string;
  /** A quiet summary at the right of the title: "3 trips, 6,900 RWF". */
  readonly meta?: string;
  /** A small link at the right of the title: "See all", "Edit". */
  readonly action?: { label: string; onPress: () => void };
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {title || action || meta ? (
        <View style={styles.groupHead}>
          {title ? (
            <Txt v="section" style={styles.flex}>
              {title}
            </Txt>
          ) : (
            <View style={styles.flex} />
          )}
          {meta ? (
            <Txt v="caption" tone="muted" tabularNums>
              {meta}
            </Txt>
          ) : null}
          {action ? (
            <Press onPress={action.onPress} scaleTo={0.95} hitSlop={10} accessibilityRole="button">
              <Txt v="label" tone="accent">
                {action.label}
              </Txt>
            </Press>
          ) : null}
        </View>
      ) : null}
      <View style={styles.groupShadow}>
        <View style={styles.group}>{children}</View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  unit,
  tone = "strong",
  big,
  roll,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly tone?: Tone;
  readonly big?: boolean;
  /** Roll the figure into place: for the one number a screen is about. */
  readonly roll?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statFigure}>
        {roll ? (
          <Odometer value={value} v={big ? "display" : "figure"} tone={tone} />
        ) : (
          <Txt v={big ? "display" : "figure"} tone={tone} tabularNums>
            {value}
          </Txt>
        )}
        {unit ? (
          <Txt v="label" tone="muted" style={styles.statUnit}>
            {unit}
          </Txt>
        ) : null}
      </View>
      <Txt v="label" tone="muted">
        {label}
      </Txt>
    </View>
  );
}

export function StatRow({ children }: { readonly children: ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Paper: the sheet that sits on the map. One per screen. When what is inside
// it changes - choosing, then searching, then a rider - its height eases to the
// new content instead of jumping.
// ---------------------------------------------------------------------------

/** How much of a folded sheet stays on screen: the handle and a line or two. */
export const PAPER_PEEK = 112;

export function Paper({
  children,
  style,
  padBottom = true,
  foldable = false,
  foldKey,
  onFold,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /** Off when a tab bar sits under the sheet and already clears the gesture bar. */
  readonly padBottom?: boolean;
  /**
   * The sheet can be pulled down to a strip, so the map behind it can be seen,
   * and pulled back up or tapped open again.
   */
  readonly foldable?: boolean;
  /** When this changes the sheet opens again: new content should be seen. */
  readonly foldKey?: string;
  /** Hears the sheet fold and open, to give the map the room. */
  readonly onFold?: (folded: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const h = useSharedValue(0);
  // 0 is open, 1 is folded; drag is the finger's travel on top of that.
  const fold = useSharedValue(0);
  const drag = useSharedValue(0);
  const [folded, setFolded] = useState(false);
  const onFoldRef = useRef(onFold);
  onFoldRef.current = onFold;

  const settle = useCallback((next: boolean) => {
    setFolded(next);
    onFoldRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!foldable) return;
    fold.set(reduce ? 0 : withTiming(0, { duration: 200, easing: ease.out }));
    drag.set(0);
    settle(false);
  }, [foldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull or tap to fold and open. Each detector gets its own instance: one
  // gesture shared by two detectors loses its handler when the folded strip
  // unmounts, and the handle then throws "No handler for tag" on web.
  const makeGesture = () =>
    Gesture.Exclusive(
      Gesture.Pan()
        .enabled(foldable)
        .activeOffsetY([-6, 6])
        .onUpdate((e) => {
          drag.set(e.translationY);
        })
        .onEnd((e) => {
          const range = Math.max(1, h.get() - PAPER_PEEK);
          const at = Math.min(range, Math.max(0, fold.get() * range + drag.get()));
          const next = e.velocityY > 500 ? 1 : e.velocityY < -500 ? 0 : at > range / 2 ? 1 : 0;
          fold.set(at / range);
          drag.set(0);
          fold.set(reduce ? next : withTiming(next, { duration: 220, easing: ease.out }));
          scheduleOnRN(settle, next === 1);
        }),
      Gesture.Tap()
        .enabled(foldable)
        .onEnd(() => {
          const next = fold.get() > 0.5 ? 0 : 1;
          fold.set(reduce ? next : withTiming(next, { duration: 220, easing: ease.out }));
          scheduleOnRN(settle, next === 1);
        }),
    );
  const handleGesture = useMemo(makeGesture, [foldable, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const stripGesture = useMemo(makeGesture, [foldable, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const moved = useAnimatedStyle(() => {
    if (!foldable) return {};
    const range = Math.max(0, h.get() - PAPER_PEEK);
    const y = fold.get() * range + drag.get();
    return { transform: [{ translateY: Math.min(range + 24, Math.max(-16, y)) }] };
  });

  return (
    <Animated.View
      onLayout={(e) => h.set(e.nativeEvent.layout.height)}
      style={[styles.paper, { paddingBottom: (padBottom ? insets.bottom : 0) + space.md }, style, moved]}
    >
      {foldable ? (
        <GestureDetector gesture={handleGesture}>
          <View
            style={styles.grabZone}
            hitSlop={{ top: 12, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={folded ? "Show the details" : "Show more of the map"}
          >
            <View style={[styles.grabber, styles.grabberInZone]} />
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.grabber} />
      )}
      <AutoHeight>{children}</AutoHeight>
      {/* Folded, what shows of the sheet opens it - by tap or by pulling up -
          rather than pressing a button half off the screen. */}
      {foldable && folded ? (
        <GestureDetector gesture={stripGesture}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Show the details" />
        </GestureDetector>
      ) : null}
    </Animated.View>
  );
}

/**
 * Eases to the height of whatever is inside it. Measured from an absolutely
 * placed inner view, so the content always lays out at its natural size and
 * only the frame around it moves. Height is animated here on purpose: it
 * happens once per state change, not per frame of a gesture, and it is the
 * only way the top edge of a sheet can travel smoothly on every platform.
 */
export function AutoHeight({ children }: { readonly children: ReactNode }) {
  const reduce = useReducedMotion();
  const h = useSharedValue(-1);
  const frame = useAnimatedStyle(() => (h.get() < 0 ? {} : { height: h.get() }));
  return (
    <Animated.View style={[styles.auto, frame]}>
      <View
        style={styles.autoInner}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.height;
          // Quick, and not at all for a few pixels: content that settles in
          // steps - prices arriving, a chip appearing - made a slow ease
          // chase itself and the sheet crept up and down on its own.
          if (h.get() < 0 || reduce || Math.abs(next - h.get()) < 12) h.set(next);
          else h.set(withTiming(next, { duration: 180, easing: ease.out }));
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The height of something that animates its own height, reported once it has
 * settled. A map that re-fits to a sheet on every frame of the sheet's
 * movement would stutter and burn the battery; it only needs the final size.
 */
export function useSettledHeight(initial = 300): [number, (e: LayoutChangeEvent) => void] {
  const [h, setH] = useState(initial);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const v = Math.round(e.nativeEvent.layout.height);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setH(v), 200);
  }, []);
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  return [h, onLayout];
}

/**
 * One state of a sheet or a card. Give it a new id and the old content fades
 * down and out while the new content rises in.
 */
export function Swap({ id, children, style }: { readonly id: string; readonly children: ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View key={id} entering={swapIn} exiting={swapOut} style={style}>
      {children}
    </Animated.View>
  );
}

/** Content arriving on a screen, in order. */
export function Enter({ i = 0, children, style }: { readonly i?: number; readonly children: ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={enter(i)} style={style}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Screen: a scrolling page with a large condensed title.
//
// The title scrolls away with the page, and as it goes a compact bar fades in
// at the top carrying the same title - so you always know where you are
// without the header taking a fifth of the screen. The back button lives in
// that bar and never scrolls away. Content arrives in order, once, on mount.
// ---------------------------------------------------------------------------

const BAR = 52;

export function Screen({
  title,
  subtitle,
  right,
  children,
  onBack,
  scroll = true,
  footer,
  stagger = true,
  gap = 0,
  brand,
  hero,
  overlap = 0,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly right?: ReactNode;
  readonly children: ReactNode;
  readonly onBack?: () => void;
  readonly scroll?: boolean;
  /** Pinned below the scroll area - where the one primary action goes. */
  readonly footer?: ReactNode;
  /** Off for screens whose content must not move on arrival (a keypad). */
  readonly stagger?: boolean;
  /** Space between the screen's direct children, each of which arrives in turn. */
  readonly gap?: number;
  /**
   * Open on the midnight hero: the title in white on the night, and whatever
   * `hero` holds under it - a figure, tabs, a profile.
   */
  readonly brand?: boolean;
  readonly hero?: ReactNode;
  /** How far the first card rides up over the hero's edge. */
  readonly overlap?: number;
}) {
  const insets = useSafeAreaInsets();
  const y = useSharedValue(0);
  const [titleEnd, setTitleEnd] = useState(90);
  const onScroll = useAnimatedScrollHandler((e) => {
    y.set(e.contentOffset.y);
  });

  const top = brand ? 0 : insets.top + (onBack ? BAR : space.sm);
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [titleEnd - top - 40, titleEnd - top - 8], [0, 1], Extrapolation.CLAMP),
  }));
  const compactTitle = useAnimatedStyle(() => {
    const t = interpolate(y.get(), [titleEnd - top - 30, titleEnd - top], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ translateY: (1 - t) * 6 }] };
  });

  const header = brand ? (
    <Animated.View
      entering={stagger ? enter(0) : undefined}
      style={styles.brandBleed}
      onLayout={(e: LayoutChangeEvent) => setTitleEnd(e.nativeEvent.layout.y + e.nativeEvent.layout.height - 40)}
    >
      <Hero overlap={overlap} style={onBack ? { paddingTop: insets.top + BAR } : null} safeTop={!onBack}>
        <View style={styles.brandHead}>
          <View style={styles.headerRow}>
            <View style={styles.flex}>
              {title ? (
                <Txt v="title" tone="onHero" accessibilityLabel={title}>
                  {title}
                </Txt>
              ) : null}
              {subtitle ? (
                <Txt v="body" tone="onHeroMuted">
                  {subtitle}
                </Txt>
              ) : null}
            </View>
            {right}
          </View>
          {hero}
        </View>
      </Hero>
    </Animated.View>
  ) : title || right ? (
      <Animated.View
        entering={stagger ? enter(0) : undefined}
        style={styles.header}
        onLayout={(e: LayoutChangeEvent) => setTitleEnd(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            {title ? (
              <Txt v="title" accessibilityLabel={title}>
                {title}
              </Txt>
            ) : null}
            {subtitle ? (
              <Txt v="body" tone="muted">
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {right}
        </View>
      </Animated.View>
    ) : null;

  const items = Children.toArray(children);
  const body = stagger
    ? items.map((child, i) => (
        <Animated.View key={isValidElement(child) && child.key != null ? String(child.key) : i} entering={enter(i + 1)}>
          {child}
        </Animated.View>
      ))
    : children;

  const bar =
    onBack || title ? (
      <View pointerEvents="box-none" style={[styles.bar, { height: insets.top + BAR, paddingTop: insets.top }]}>
        {scroll ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, brand ? styles.barBgBrand : styles.barBg, fade]} /> : null}
        <View style={styles.barRow} pointerEvents="box-none">
          {onBack ? (
            <View style={brand ? styles.backOnHero : styles.back}>
              <IconButton icon="arrow-back" label="Back" onPress={onBack} size={44} tone={brand ? "onDark" : "default"} />
            </View>
          ) : (
            <View style={styles.barSide} />
          )}
          {title && scroll ? (
            <Animated.View style={[styles.barTitle, compactTitle]} pointerEvents="none">
              <Txt v="bodyStrong" tone={brand ? "onHero" : "strong"} lines={1}>
                {title}
              </Txt>
            </Animated.View>
          ) : (
            <View style={styles.flex} />
          )}
          <View style={styles.barSide} />
        </View>
      </View>
    ) : null;

  const content = scroll ? (
    <Animated.ScrollView
      style={styles.flex}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: footer ? space.lg : insets.bottom + space.xl }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      <View style={[styles.stack, { gap }, brand ? { marginTop: overlap ? -overlap : space.lg } : null]}>{body}</View>
    </Animated.ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, { paddingTop: top }]}>
      {header}
      {children}
    </View>
  );

  return (
    <View style={styles.screen}>
      {content}
      {bar}
      {footer ? (
        <Animated.View entering={stagger ? enter(3) : undefined} style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          {footer}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: tokens.MIN_TOUCH_TARGET + 12,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
  },
  rowText: { flex: 1, gap: 1, minWidth: 0 },
  rowValueBox: { alignItems: "flex-end" },
  rowValue: { fontSize: 22, lineHeight: 26 },
  well: { alignItems: "center", justifyContent: "center" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
  groupShadow: { borderRadius: radius.lg, backgroundColor: c.surfaceRaised, ...shadow.card },
  group: {
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  groupHead: { flexDirection: "row", alignItems: "center", marginBottom: space.sm + 2, marginHorizontal: 2, gap: space.sm },
  stat: { flex: 1, gap: 2 },
  statFigure: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  statUnit: { marginBottom: 2 },
  statRow: { flexDirection: "row", gap: space.md },
  paper: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    ...shadow.paper,
  },
  auto: { overflow: "hidden" },
  // Held at the bottom of the frame: while a sheet grows, its buttons - at
  // the bottom - are on screen at once and the top is what is revealed.
  autoInner: { position: "absolute", bottom: 0, left: 0, right: 0 },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.border,
    marginBottom: space.md,
  },
  // A handle you can find with a thumb: the full width, taller than it looks.
  grabZone: { alignSelf: "stretch", alignItems: "center", marginTop: -space.sm, paddingTop: space.sm + 2, paddingBottom: space.md },
  grabberInZone: { marginBottom: 0, width: 44, backgroundColor: c.textMuted, opacity: 0.45 },
  screen: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: space.lg },
  stack: { gap: 0 },
  header: { paddingTop: space.sm, paddingBottom: space.lg, gap: space.sm },
  headerRow: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
  bar: { position: "absolute", top: 0, left: 0, right: 0 },
  barBg: { backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  barBgBrand: { backgroundColor: c.hero },
  // The back button sits in a white disc, so it is found at once on a map,
  // a photo or the page - and on the hero it is the hero's own lighter blue.
  back: { borderRadius: 22, backgroundColor: c.surfaceRaised, ...shadow.card },
  backOnHero: { borderRadius: 22, backgroundColor: c.heroRaised },
  brandBleed: { marginHorizontal: -space.lg },
  brandHead: { gap: space.lg },
  barRow: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm },
  barSide: { width: 44 },
  barTitle: { flex: 1, alignItems: "center" },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: c.surface,
  },
});

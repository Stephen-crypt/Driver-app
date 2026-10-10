import { useRef, useState, type ReactNode } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ImageSourcePropType,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { c, font, radius, shadow, space, tabular, tokens } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";
import { Button, IconButton, selection, type IconName } from "./controls";
import { Enter } from "./layout";
import { HeroPattern } from "./brand";

// ---------------------------------------------------------------------------
// Signing in and signing up.
//
// Every step has the same frame: the night at the top with a drawn badge of
// what the step is about, and a white sheet rising over it that holds the one
// question. The steps show as yellow dots, so the end is always in sight.
// ---------------------------------------------------------------------------

/**
 * A drawn badge: the step's subject in a white disc, a yellow token beside it,
 * and rings going out behind - the same rings as the radar that finds a rider.
 */
export function AuthArt({
  icon,
  accent,
  size = 156,
  light,
}: {
  readonly icon: IconName;
  readonly accent: IconName;
  readonly size?: number;
  /** On the page instead of the night: grey rings and a blue disc. */
  readonly light?: boolean;
}) {
  const ring = light ? c.border : c.heroRaised;
  const r = size / 2;
  const disc = Math.round(size * 0.6);
  const token = Math.round(size * 0.27);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={r} cy={r} r={r - 2} stroke={ring} strokeWidth={2} fill="none" />
        <Circle cx={r} cy={r} r={r * 0.78} stroke={ring} strokeWidth={2} strokeDasharray="4 7" fill="none" />
        <Circle cx={size * 0.1} cy={size * 0.3} r={3.5} fill={c.highlight} />
        <Circle cx={size * 0.2} cy={size * 0.86} r={2.5} fill={c.highlight} />
        <Circle cx={size * 0.93} cy={size * 0.66} r={3} fill={c.highlight} />
      </Svg>
      <View
        style={[
          styles.disc,
          { width: disc, height: disc, borderRadius: disc / 2, left: r - disc / 2, top: r - disc / 2 },
          light && { backgroundColor: c.tintBlue, shadowOpacity: 0 },
        ]}
      >
        <Ionicons name={icon} size={Math.round(disc * 0.46)} color={c.hero} />
      </View>
      <View style={[styles.token, { width: token, height: token, borderRadius: token / 2, right: size * 0.1, top: size * 0.12 }, light && { borderColor: c.surface }]}>
        <Ionicons name={accent} size={Math.round(token * 0.5)} color={c.onHighlight} />
      </View>
    </View>
  );
}

/** Where you are in a sign-up, as dots: done and current in yellow. */
export function StepDots({ count, step }: { readonly count: number; readonly step: number }) {
  return (
    <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${count}`}>
      <Txt v="caption" tone="onHeroMuted" style={styles.dotsLabel}>
        Step {step + 1} of {count}
      </Txt>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i < step && styles.dotDone, i === step && styles.dotOn]} />
      ))}
    </View>
  );
}

export function AuthScreen({
  art,
  accent,
  scene,
  title,
  subtitle,
  onBack,
  step,
  steps,
  children,
  footer,
}: {
  /** A drawn badge, when there is no scene. */
  readonly art?: IconName;
  readonly accent?: IconName;
  /** The step's picture: a small arrangement of the product's own pieces. */
  readonly scene?: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack?: () => void;
  readonly step?: number;
  readonly steps?: number;
  readonly children: ReactNode;
  /** Pinned at the bottom of the sheet: the one action. */
  readonly footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <HeroPattern />
          <View style={styles.topRow}>
            {onBack ? (
              <View style={styles.back}>
                <IconButton icon="arrow-back" label="Back" onPress={onBack} size={44} tone="onDark" />
              </View>
            ) : (
              <View style={styles.backSpace} />
            )}
            {steps ? <StepDots count={steps} step={step ?? 0} /> : null}
          </View>
          <View style={styles.art}>
            {scene ??
              (art && accent ? (
                <Enter i={0}>
                  <AuthArt icon={art} accent={accent} />
                </Enter>
              ) : null)}
          </View>
        </View>

        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            <Enter i={1} style={styles.heading}>
              <Txt v="title">{title}</Txt>
              {subtitle ? (
                <Txt v="body" tone="muted">
                  {subtitle}
                </Txt>
              ) : null}
            </Enter>
            <Enter i={2} style={styles.content}>
              {children}
            </Enter>
          </ScrollView>
          {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The phone number, with the country it belongs to.
// ---------------------------------------------------------------------------

/** Rwanda's flag: sky blue, yellow and green, with the sun in the corner. */
export function RwandaFlag({ width = 28 }: { readonly width?: number }) {
  const h = (width * 2) / 3;
  const rays: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = i % 2 === 0 ? 4.2 : 2.7;
    rays.push(`${i === 0 ? "M" : "L"}${(24 + Math.cos(a) * rr).toFixed(2)} ${(5.2 + Math.sin(a) * rr).toFixed(2)}`);
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={h} viewBox="0 0 30 20">
        <Rect x={0} y={0} width={30} height={10} fill="#00A1DE" />
        <Rect x={0} y={10} width={30} height={5} fill="#FAD201" />
        <Rect x={0} y={15} width={30} height={5} fill="#20603D" />
        <Path d={`${rays.join(" ")} Z`} fill="#E5BE01" />
        <Circle cx={24} cy={5.2} r={1.9} fill="#E5BE01" stroke="#00A1DE" strokeWidth={0.5} />
      </Svg>
    </View>
  );
}

/**
 * Digits as they are typed, grouped the way a Rwandan number is read aloud:
 * "788 123 456", or "0788 123 456" with the leading zero. Spaces are cosmetic;
 * the number is cleaned up before it is used.
 */
export function groupPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, raw.replace(/\D/g, "").startsWith("0") ? 10 : 9);
  const lead = d.startsWith("0") ? 4 : 3;
  return [d.slice(0, lead), d.slice(lead, lead + 3), d.slice(lead + 3)].filter(Boolean).join(" ");
}

export function PhoneField({
  value,
  onChangeText,
  onSubmitEditing,
  autoFocus = true,
}: {
  readonly value: string;
  readonly onChangeText: (v: string) => void;
  readonly onSubmitEditing?: () => void;
  readonly autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "");
  const complete = digits.length >= 9;
  return (
    <View style={[styles.phone, focused && styles.phoneFocused]}>
      <View style={styles.country} accessible accessibilityLabel="Rwanda, plus 250">
        <View style={styles.flag}>
          <RwandaFlag width={28} />
        </View>
        <Txt v="bodyStrong" style={styles.code}>
          +250
        </Txt>
      </View>
      <View style={styles.rule} />
      <TextInput
        value={value}
        onChangeText={(t) => onChangeText(groupPhone(t))}
        onSubmitEditing={onSubmitEditing}
        placeholder="788 123 456"
        placeholderTextColor={c.textMuted}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.phoneInput}
        accessibilityLabel="Phone number"
      />
      {complete ? <Ionicons name="checkmark-circle" size={22} color={c.success} /> : null}
    </View>
  );
}

/** "+250 788 123 456", from whatever was typed: 0788123456, 788123456, +250... */
export function prettyPhone(raw: string | undefined): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const local = d.startsWith("250") ? d.slice(3) : d.startsWith("0") ? d.slice(1) : d;
  if (local.length !== 9) return raw;
  const nb = "\u00A0";
  return `+250${nb}${local.slice(0, 3)}${nb}${local.slice(3, 6)}${nb}${local.slice(6)}`;
}

/**
 * Under the code boxes: how long until a new code can be sent, counting down
 * in a pill, then the way to ask for one - and the way back for a mistyped
 * number, which is the other reason a code never arrives.
 */
export function ResendRow({
  wait,
  onResend,
  onChangeNumber,
}: {
  readonly wait: number;
  readonly onResend: () => void;
  readonly onChangeNumber: () => void;
}) {
  return (
    <View style={styles.resendRow}>
      {wait > 0 ? (
        <View style={styles.resendPill} accessibilityLabel={`You can ask for a new code in ${wait} seconds`}>
          <Ionicons name="time-outline" size={15} color={c.textMuted} />
          <Txt v="label" tone="muted" tabularNums>
            New code in 0:{String(wait).padStart(2, "0")}
          </Txt>
        </View>
      ) : (
        <Press onPress={onResend} scaleTo={0.96} style={[styles.resendPill, styles.resendReady]} accessibilityRole="button">
          <Ionicons name="refresh" size={15} color={c.onHighlight} />
          <Txt v="label" tone="onHighlight" style={styles.resendText}>
            Send a new code
          </Txt>
        </Press>
      )}
      <Press onPress={onChangeNumber} scaleTo={0.96} hitSlop={8} accessibilityRole="button">
        <Txt v="label" tone="accent" style={styles.resendText}>
          Wrong number?
        </Txt>
      </Press>
    </View>
  );
}

/** "Already have an account? Log in": the way across to the other path. */
export function AuthSwitch({ question, action, onPress }: { readonly question: string; readonly action: string; readonly onPress: () => void }) {
  return (
    <View style={styles.switchRow}>
      <Txt v="label" tone="muted">
        {question}
      </Txt>
      <Press onPress={onPress} scaleTo={0.96} hitSlop={10} accessibilityRole="button">
        <Txt v="label" tone="accent" style={styles.switchAction}>
          {action}
        </Txt>
      </Press>
    </View>
  );
}

/** A reassurance under a form: an icon in a tint and a sentence. */
export function AuthNote({ icon, children }: { readonly icon: IconName; readonly children: ReactNode }) {
  return (
    <View style={styles.note}>
      <View style={styles.noteIcon}>
        <Ionicons name={icon} size={16} color={c.accent} />
      </View>
      <Txt v="label" tone="muted" style={styles.flex}>
        {children}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The welcome: the picture, then the night with three things to know, one at a
// time, and the way in.
// ---------------------------------------------------------------------------

/** How far the picture tucks under the panel's rounded top. */
const PANEL_TUCK = 30;

export interface WelcomeSlide {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  /** Something to see, not just read: the PIN as it will look, a vest. */
  readonly extra?: ReactNode;
}

export function WelcomePager({
  picture,
  pictureLabel,
  focus = 0.5,
  logo,
  name,
  slides,
  primary,
  secondary,
  tertiary,
}: {
  readonly picture: ImageSourcePropType;
  readonly pictureLabel: string;
  /** Where the subject sits across the picture, 0 to 1: the crop keeps it in view. */
  readonly focus?: number;
  readonly logo: ImageSourcePropType;
  readonly name: string;
  readonly slides: readonly WelcomeSlide[];
  readonly primary: { label: string; onPress: () => void };
  readonly secondary: { label: string; onPress: () => void };
  /** A small link under the two buttons. */
  readonly tertiary?: { label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [area, setArea] = useState(0);
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  // At its own proportions the picture is a strip with empty sky above it.
  // Grown - at most by half again - it fills the space, and the crop slides to
  // keep the moto or the rider in frame.
  const natural = (screenW * 714) / 1280;
  const imgH = Math.max(natural, Math.min(area + PANEL_TUCK, natural * 1.5));
  const imgW = (imgH * 1280) / 714;
  const left = Math.min(0, Math.max(screenW - imgW, screenW / 2 - focus * imgW));
  const pager = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w <= 0) return;
    const p = Math.round(e.nativeEvent.contentOffset.x / w);
    if (p !== page) {
      selection();
      setPage(p);
    }
  };
  const go = (p: number) => {
    pager.current?.scrollTo({ x: p * w, animated: true });
    setPage(p);
  };

  return (
    <View style={styles.welcome}>
      <View style={styles.picture} onLayout={(e) => setArea(e.nativeEvent.layout.height)}>
        <Image
          source={picture}
          style={{ position: "absolute", bottom: -PANEL_TUCK, left, width: imgW, height: imgH }}
          resizeMode="cover"
          accessible
          accessibilityLabel={pictureLabel}
        />
        <Enter i={0} style={[styles.brand, { paddingTop: insets.top + space.md }]}>
          <Image source={logo} style={styles.logo} accessibilityIgnoresInvertColors />
          <Txt v="h2" style={styles.brandName}>
            {name}
          </Txt>
        </Enter>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + space.md }]}>
        <HeroPattern />
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
            accessibilityRole="adjustable"
          >
            {slides.map((s) => (
              <View key={s.title} style={[styles.slide, { width: w || 1 }]}>
                <View style={styles.slideIcon}>
                  <Ionicons name={s.icon} size={22} color={c.onHighlight} />
                </View>
                <Txt v="title" tone="onHero" style={styles.slideTitle}>
                  {s.title}
                </Txt>
                <Txt v="body" tone="onHeroMuted">
                  {s.body}
                </Txt>
                {s.extra ? <View style={styles.extra}>{s.extra}</View> : null}
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.pages}>
          {slides.map((s, i) => (
            <Press key={s.title} onPress={() => go(i)} hitSlop={8} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={`${s.title}, ${i + 1} of ${slides.length}`}>
              <View style={[styles.page, i === page && styles.pageOn]} />
            </Press>
          ))}
        </View>

        <View style={styles.actions}>
          <Button label={primary.label} variant="highlight" onPress={primary.onPress} />
          <Press onPress={secondary.onPress} scaleTo={0.97} style={styles.secondary} accessibilityRole="button">
            <Txt v="bodyStrong" tone="onHero" style={styles.secondaryText}>
              {secondary.label}
            </Txt>
          </Press>
          {tertiary ? (
            <Press onPress={tertiary.onPress} scaleTo={0.97} hitSlop={8} style={styles.tertiary} accessibilityRole="button">
              <Txt v="label" tone="onHeroMuted">
                {tertiary.label}
              </Txt>
            </Press>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  root: { flex: 1, backgroundColor: c.hero },
  top: { paddingHorizontal: space.md, paddingBottom: space.xl + space.md, overflow: "hidden" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  back: { borderRadius: 22, backgroundColor: c.heroRaised },
  backSpace: { width: 44 },
  art: { alignItems: "center", marginTop: space.xs, minHeight: 156 },
  disc: { position: "absolute", backgroundColor: c.surfaceRaised, alignItems: "center", justifyContent: "center", ...shadow.float },
  token: {
    position: "absolute",
    backgroundColor: c.highlight,
    borderWidth: 3,
    borderColor: c.hero,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dotsLabel: { marginRight: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.heroRaised },
  dotDone: { backgroundColor: c.highlight },
  dotOn: { width: 26, backgroundColor: c.highlight },
  sheet: {
    flex: 1,
    marginTop: -space.xl,
    backgroundColor: c.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
  },
  sheetBody: { padding: space.lg, paddingTop: space.lg + 4, gap: space.lg },
  heading: { gap: space.xs },
  content: { gap: space.md },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xs, backgroundColor: c.surface },
  phone: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 64,
    paddingLeft: space.md,
    paddingRight: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.surfaceRaised,
    ...shadow.card,
  },
  phoneFocused: { borderColor: c.highlight },
  country: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flag: { borderRadius: 3, overflow: "hidden" },
  code: { fontFamily: font.num },
  rule: { width: 1.5, height: 28, backgroundColor: c.border, marginHorizontal: 2 },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.num,
    fontSize: 22,
    letterSpacing: 0.5,
    color: c.textStrong,
    paddingVertical: space.sm,
    ...tabular,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.tintBlue,
  },
  noteIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.surfaceRaised, alignItems: "center", justifyContent: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space.xs },
  switchAction: { fontFamily: font.bold },
  resendRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  resendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceHigh,
  },
  resendReady: { backgroundColor: c.highlight },
  resendText: { fontFamily: font.semibold },
  welcome: { flex: 1, backgroundColor: c.surface, overflow: "hidden" },
  // The picture's sky is pale in either theme, so the area behind it and the
  // name over it keep the day colours: at night a dark band and white type
  // would sit on that sky.
  picture: { flex: 1, minHeight: 200, backgroundColor: tokens.palette.ground },
  brandName: { color: tokens.palette.ink },
  brand: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  logo: { width: 38, height: 38, borderRadius: 11 },
  panel: {
    marginTop: -PANEL_TUCK,
    backgroundColor: c.hero,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
    overflow: "hidden",
  },
  slide: { gap: space.sm, paddingRight: 2 },
  slideIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  slideTitle: { fontSize: 28, lineHeight: 34 },
  extra: { marginTop: space.sm },
  pages: { flexDirection: "row", gap: 6, marginTop: space.lg, marginBottom: space.lg },
  page: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.heroRaised },
  pageOn: { width: 26, backgroundColor: c.highlight },
  actions: { gap: space.sm },
  // The second way in, drawn as a button on the night: an outline, so the
  // yellow one stays the first choice.
  secondary: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: c.onHeroMuted,
  },
  secondaryText: { fontFamily: font.bold, fontSize: 16 },
  tertiary: { alignItems: "center", paddingVertical: space.sm },
});

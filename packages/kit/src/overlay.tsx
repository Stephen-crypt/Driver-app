import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { dropIn, dropOut, dur, ease, spring } from "./anim";
import { c, radius, scrim, shadow, space } from "./theme";
import { Txt } from "./Txt";
import { Button, notify, type IconName } from "./controls";
import { Press } from "./Press";

// ---------------------------------------------------------------------------
// ModalSheet: a panel that rises from the bottom over a scrim.
//
// It follows Uber Base's sheet and the iOS drawer: the sheet curve on the way
// in, a faster ease-out on the way out, and a drag that carries the finger's
// velocity. Let go past a third of its height, or flick it, and it goes.
// ---------------------------------------------------------------------------

export interface ModalSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly title?: string;
  readonly subtitle?: string;
  /** Off for a sheet that must be answered: no scrim tap, no drag, no back. */
  readonly dismissible?: boolean;
  /** After the sheet has fully left the screen. */
  readonly onClosed?: () => void;
}

export function ModalSheet({ visible, onClose, children, title, subtitle, dismissible = true, onClosed }: ModalSheetProps) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const opened = useRef(false);
  const y = useSharedValue(winH);
  const h = useSharedValue(winH);
  const shown = useSharedValue(0);
  const start = useSharedValue(0);

  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const visibleRef = useRef(visible);
  const finish = useCallback(() => {
    opened.current = false;
    setMounted(false);
    closedRef.current?.();
  }, []);
  // The way out ended, finished or not. Cut short by a re-open, the sheet
  // stays; cut short by anything else, it still goes - a sheet that neither
  // finishes leaving nor comes back is an invisible wall over the app.
  const settle = useCallback(() => {
    if (!visibleRef.current) finish();
  }, [finish]);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      if (!mounted) {
        setMounted(true);
        return;
      }
      // Asked back while it was leaving: return from wherever it got to.
      if (opened.current) {
        shown.set(withTiming(1, { duration: dur.sheet, easing: ease.out }));
        y.set(reduce ? 0 : withTiming(0, { duration: dur.sheet, easing: ease.sheet }));
      }
      return;
    }
    if (!mounted) return;
    shown.set(withTiming(0, { duration: dur.sheetOut, easing: ease.out }));
    y.set(
      withTiming(reduce ? 0 : h.get() + 40, { duration: dur.sheetOut, easing: ease.out }, () => {
        scheduleOnRN(settle);
      }),
    );
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    h.set(height);
    if (!visible || opened.current) return;
    opened.current = true;
    if (reduce) {
      y.set(0);
    } else {
      y.set(height + 40);
      y.set(withTiming(0, { duration: dur.sheet, easing: ease.sheet }));
    }
    shown.set(withTiming(1, { duration: dur.sheet, easing: ease.out }));
  };

  // Off while leaving: a drag during the exit would take over the sheet's
  // position and the exit would never finish.
  const pan = Gesture.Pan()
    .enabled(dismissible && !reduce && visible)
    .activeOffsetY([-8, 8])
    .onStart(() => {
      start.set(y.get());
    })
    .onUpdate((e) => {
      const next = start.get() + e.translationY;
      // Up is resisted, not blocked: the sheet gives a little and comes back.
      y.set(next < 0 ? next * 0.2 : next);
    })
    .onEnd((e) => {
      if (y.get() > h.get() * 0.32 || e.velocityY > 900) {
        shown.set(withTiming(0, { duration: dur.sheetOut, easing: ease.out }));
        y.set(withSpring(h.get() + 40, { ...spring.drag, dampingRatio: 1, velocity: e.velocityY, overshootClamping: true }));
        scheduleOnRN(onClose);
      } else {
        y.set(withSpring(0, { ...spring.drag, velocity: e.velocityY }));
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reduce ? shown.get() : 1,
    transform: [{ translateY: y.get() }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => dismissible && onClose()}
    >
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }, scrimStyle]}>
          <Pressable
            style={styles.flex}
            onPress={() => dismissible && onClose()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            disabled={!dismissible || !visible}
          />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.dock}
          pointerEvents="box-none"
        >
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={onLayout}
              style={[styles.sheet, { paddingBottom: insets.bottom + space.md, maxHeight: winH * 0.92 }, sheetStyle]}
              // Nothing on a leaving sheet can be pressed: a second tap on an
              // option would run it twice - two alerts, two phone calls.
              pointerEvents={visible ? "auto" : "none"}
              accessibilityViewIsModal
            >
              <View style={styles.grabber} />
              {title ? (
                <View style={styles.head}>
                  <Txt v="h2" accessibilityLabel={title}>
                    {title}
                  </Txt>
                  {subtitle ? (
                    <Txt v="body" tone="muted">
                      {subtitle}
                    </Txt>
                  ) : null}
                </View>
              ) : null}
              {children}
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The overlay: action sheets, confirmations and toasts, from anywhere.
// ---------------------------------------------------------------------------

export interface SheetAction {
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconName;
  readonly tone?: "default" | "danger" | "accent";
  readonly onPress: () => void;
}

export interface ActionsRequest {
  readonly title: string;
  readonly message?: string;
  readonly options: readonly SheetAction[];
  readonly cancelLabel?: string;
}

export interface ConfirmRequest {
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: "danger" | "primary";
}

export interface ToastRequest {
  readonly message: string;
  readonly tone?: "good" | "bad" | "neutral";
  readonly icon?: IconName;
}

type Request =
  | { readonly kind: "actions"; readonly r: ActionsRequest }
  | { readonly kind: "confirm"; readonly r: ConfirmRequest; readonly resolve: (ok: boolean) => void };

export interface Overlay {
  /** A list of choices. Replaces Alert.alert with buttons, which does nothing on the web. */
  actions(r: ActionsRequest): void;
  /** Resolves true only when the person chose the confirming action. */
  confirm(r: ConfirmRequest): Promise<boolean>;
  toast(r: ToastRequest | string): void;
}

const OverlayContext = createContext<Overlay | null>(null);

/** Screens call this; the provider at the app root draws what they ask for. */
export function useOverlay(): Overlay {
  const o = useContext(OverlayContext);
  if (!o) throw new Error("useOverlay needs <OverlayProvider> at the app root");
  return o;
}

export function OverlayProvider({ children }: { readonly children: ReactNode }) {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  // What is on screen now, readable synchronously: a second request made while
  // one sheet is up waits its turn instead of replacing it.
  const currentRef = useRef<Request | null>(null);
  const queue = useRef<Request[]>([]);
  const [toast, setToast] = useState<(ToastRequest & { id: number }) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((req: Request) => {
    if (currentRef.current) {
      queue.current.push(req);
      return;
    }
    currentRef.current = req;
    setCurrent(req);
    setOpen(true);
  }, []);

  const overlay = useMemo<Overlay>(
    () => ({
      actions: (r) => show({ kind: "actions", r }),
      confirm: (r) => new Promise<boolean>((resolve) => show({ kind: "confirm", r, resolve })),
      toast: (r) => {
        const t = typeof r === "string" ? { message: r } : r;
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ ...t, id: Date.now() });
        if (t.tone === "bad") notify("error");
        // Android and the web read the live region; VoiceOver needs telling.
        if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(t.message);
        toastTimer.current = setTimeout(() => setToast(null), 2800);
      },
    }),
    [show],
  );

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // A confirmation dismissed by the scrim, a drag or the back button is a no.
  const answered = useRef(false);
  // An action runs once, however fast the second tap comes.
  const acted = useRef(false);
  const close = (ok?: boolean) => {
    if (current?.kind === "confirm" && !answered.current) {
      answered.current = true;
      current.resolve(!!ok);
    }
    setOpen(false);
  };

  const onClosed = () => {
    answered.current = false;
    acted.current = false;
    const next = queue.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
    if (next) setOpen(true);
  };

  return (
    <OverlayContext.Provider value={overlay}>
      {children}

      {toast ? (
        <View pointerEvents="box-none" style={[styles.toastDock, { top: insets.top + space.sm }]}>
          <Animated.View key={toast.id} entering={dropIn} exiting={dropOut} style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Ionicons
              name={toast.icon ?? (toast.tone === "bad" ? "alert-circle" : toast.tone === "good" ? "checkmark-circle" : "information-circle")}
              size={20}
              color={toast.tone === "bad" ? "#FF8A80" : toast.tone === "good" ? "#6EE7B7" : "#FFFFFF"}
            />
            <Txt v="label" tone="inverse" style={styles.flex}>
              {toast.message}
            </Txt>
          </Animated.View>
        </View>
      ) : null}

      <ModalSheet
        visible={open}
        onClose={() => close(false)}
        onClosed={onClosed}
        title={current?.r.title}
        subtitle={current?.r.message}
      >
        {current?.kind === "actions" ? (
          <View style={styles.options}>
            <View style={styles.optionGroup}>
              {current.r.options.map((o, i) => (
                <View key={o.label}>
                  {i > 0 ? <View style={styles.optionDivider} /> : null}
                  <Press
                    onPress={() => {
                      if (acted.current) return;
                      acted.current = true;
                      close();
                      o.onPress();
                    }}
                    scaleTo={1}
                    bg={c.surfaceRaised}
                    pressedBg={c.surfaceHigh}
                    style={styles.option}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                  >
                    {o.icon ? (
                      <View style={[styles.optionIcon, o.tone === "danger" ? styles.optionIconBad : null]}>
                        <Ionicons name={o.icon} size={19} color={o.tone === "danger" ? c.danger : c.accent} />
                      </View>
                    ) : null}
                    <View style={styles.flex}>
                      <Txt v="bodyStrong" tone={o.tone === "danger" ? "bad" : o.tone === "accent" ? "accent" : "strong"}>
                        {o.label}
                      </Txt>
                      {o.hint ? (
                        <Txt v="label" tone="muted">
                          {o.hint}
                        </Txt>
                      ) : null}
                    </View>
                  </Press>
                </View>
              ))}
            </View>
            <Button label={current.r.cancelLabel ?? "Close"} variant="secondary" onPress={() => close()} />
          </View>
        ) : current?.kind === "confirm" ? (
          <View style={styles.options}>
            <Button
              label={current.r.confirmLabel}
              variant={current.r.tone === "danger" ? "dangerSolid" : "primary"}
              onPress={() => {
                if (answered.current) return;
                answered.current = true;
                current.resolve(true);
                close(true);
              }}
            />
            <Button label={current.r.cancelLabel ?? "Keep it"} variant="secondary" onPress={() => close(false)} />
          </View>
        ) : null}
      </ModalSheet>
    </OverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    ...shadow.paper,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.border,
    marginBottom: space.md,
  },
  head: { gap: 4, marginBottom: space.lg },
  options: { gap: space.sm },
  optionGroup: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginBottom: space.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 58,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIconBad: { backgroundColor: c.dangerSoft },
  optionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: space.md },
  toastDock: { position: "absolute", left: space.md, right: space.md, zIndex: 1000, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    maxWidth: 520,
    alignSelf: "stretch",
    backgroundColor: c.textStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    ...shadow.float,
  },
});

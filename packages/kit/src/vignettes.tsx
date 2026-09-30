import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { enter } from "./anim";
import { c, font, radius, shadow, space, tabular } from "./theme";
import { Txt } from "./Txt";
import { VehicleArt } from "./brand";
import { VestPatch } from "./VestPatch";
import { RwandaFlag } from "./auth";
import { type IconName } from "./controls";

// ---------------------------------------------------------------------------
// Scenes for the sign-in steps.
//
// Not icons in circles: small arrangements of the product's own pieces - the
// text message with the code, the card a rider's arrival will show, an ID
// card - floating on the night, so each step shows what it is for before a
// word is read. Every piece arrives on its own beat.
// ---------------------------------------------------------------------------

const W = 320;
const H = 236;

/** A floating white card, tilted a little, arriving in turn. */
function Float({
  children,
  style,
  tilt = 0,
  i = 0,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly tilt?: number;
  readonly i?: number;
}) {
  return (
    <Animated.View entering={enter(i, 120)} style={[styles.float, { transform: [{ rotate: `${tilt}deg` }] }, style]}>
      {children}
    </Animated.View>
  );
}

function Token({ icon, style, i = 0 }: { readonly icon: IconName; readonly style?: StyleProp<ViewStyle>; readonly i?: number }) {
  return (
    <Animated.View entering={enter(i, 160)} style={[styles.token, style]}>
      <Ionicons name={icon} size={20} color={c.onHighlight} />
    </Animated.View>
  );
}

/** The stage: a disc of lifted blue behind everything, and yellow sparks. */
function Stage({ children }: { readonly children: ReactNode }) {
  return (
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.disc} />
      <View style={[styles.spark, { left: 18, top: 44 }]} />
      <View style={[styles.spark, styles.sparkSmall, { right: 26, top: 22 }]} />
      <View style={[styles.spark, styles.sparkSmall, { left: 48, bottom: 20 }]} />
      {children}
    </View>
  );
}

/** Nova's mark in miniature, for the sender of a message. */
function Mark() {
  return (
    <View style={styles.mark}>
      <Txt v="caption" tone="onHighlight" style={styles.markText}>
        N
      </Txt>
    </View>
  );
}

/** Your number, and the moto it brings. */
export function PhoneScene() {
  return (
    <Stage>
      <Animated.View entering={enter(0, 60)} style={styles.bike}>
        <VehicleArt kind="moto" size={176} />
      </Animated.View>
      <Float i={1} tilt={-6} style={{ left: 6, top: 30 }}>
        <View style={styles.row}>
          <RwandaFlag width={22} />
          <Txt v="bodyStrong" style={styles.num}>
            +250 78•
          </Txt>
        </View>
      </Float>
      <Float i={2} tilt={5} style={{ right: 4, top: 92 }}>
        <View style={styles.row}>
          <View style={styles.smallToken}>
            <Ionicons name="chatbubble-ellipses" size={13} color={c.onHighlight} />
          </View>
          <View>
            <Txt v="caption" tone="strong" style={styles.bold}>
              Code sent
            </Txt>
            <Txt v="caption" tone="muted">
              by SMS
            </Txt>
          </View>
        </View>
      </Float>
    </Stage>
  );
}

/** The text message itself, with its six digits. */
export function CodeScene() {
  return (
    <Stage>
      <Float i={0} tilt={-3} style={styles.sms}>
        <View style={styles.row}>
          <Mark />
          <Txt v="caption" tone="strong" style={[styles.bold, styles.flex]}>
            Nova
          </Txt>
          <Txt v="caption" tone="muted">
            now
          </Txt>
        </View>
        <Txt v="label" tone="muted" style={styles.smsLine}>
          Your sign-in code is
        </Txt>
        <Txt v="figure" style={styles.code}>
          482 193
        </Txt>
      </Float>
      <Token i={1} icon="shield-checkmark" style={{ right: 38, bottom: 26 }} />
      <Float i={2} tilt={4} style={{ left: 14, bottom: 14 }}>
        <View style={styles.row}>
          <Ionicons name="lock-closed" size={13} color={c.accent} />
          <Txt v="caption" tone="strong" style={styles.bold}>
            Never share it
          </Txt>
        </View>
      </Float>
    </Stage>
  );
}

/** What a rider's arrival will look like, with the name as it is typed. */
export function NameScene({ name }: { readonly name: string }) {
  const shown = name.trim() || "you";
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <Stage>
      <Float i={0} tilt={-2} style={styles.notice}>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Txt v="bodyStrong" tone="onHighlight" style={styles.avatarText}>
              {initial}
            </Txt>
          </View>
          <View style={styles.flex}>
            <Txt v="caption" tone="strong" style={styles.bold} lines={1}>
              Rider on the way
            </Txt>
            <Txt v="caption" tone="muted" lines={1}>
              Vianney is coming for {shown}
            </Txt>
          </View>
        </View>
      </Float>
      <Animated.View entering={enter(1, 160)} style={styles.vest}>
        <VestPatch value="214" size="sm" />
      </Animated.View>
      <Animated.View entering={enter(2, 160)} style={styles.bikeSmall}>
        <VehicleArt kind="moto" size={118} />
      </Animated.View>
    </Stage>
  );
}

/** An ID card, and a licence behind it - drawn, never a real document. */
export function IdScene() {
  return (
    <Stage>
      <Float i={0} tilt={7} style={[styles.card, { right: 36, top: 26, opacity: 0.9 }]}>
        <View style={[styles.cardBar, { backgroundColor: c.success }]} />
        <Txt v="caption" tone="muted" style={styles.bold}>
          National ID
        </Txt>
        <View style={[styles.line, { width: "70%" }]} />
        <View style={[styles.line, { width: "45%" }]} />
      </Float>
      <Float i={1} tilt={-5} style={[styles.card, { left: 30, top: 62 }]}>
        <View style={[styles.cardBar, { backgroundColor: c.highlight }]} />
        <View style={styles.row}>
          <View style={styles.photo}>
            <Ionicons name="person" size={26} color={c.accent} />
          </View>
          <View style={[styles.flex, { gap: 6 }]}>
            <Txt v="caption" tone="strong" style={styles.bold}>
              Driving licence
            </Txt>
            <View style={[styles.line, styles.lineDark, { width: "80%" }]} />
            <View style={[styles.line, { width: "60%" }]} />
          </View>
        </View>
      </Float>
      <Token i={2} icon="person" style={{ left: 22, bottom: 30 }} />
    </Stage>
  );
}

/** Two documents, one already checked, and the camera for the rest. */
export function DocsScene() {
  return (
    <Stage>
      <Float i={0} tilt={-7} style={[styles.doc, { left: 50, top: 34 }]}>
        <Ionicons name="document-text" size={28} color={c.accent} />
        <View style={[styles.line, styles.lineDark, { width: "70%" }]} />
        <View style={[styles.line, { width: "85%" }]} />
        <View style={[styles.line, { width: "55%" }]} />
        <View style={styles.check}>
          <Ionicons name="checkmark" size={14} color={c.onAccent} />
        </View>
      </Float>
      <Float i={1} tilt={6} style={[styles.doc, { right: 48, top: 54 }]}>
        <Ionicons name="card" size={28} color={c.accent} />
        <View style={[styles.line, styles.lineDark, { width: "60%" }]} />
        <View style={[styles.line, { width: "80%" }]} />
        <View style={[styles.line, { width: "40%" }]} />
      </Float>
      <Token i={2} icon="camera" style={{ right: 30, bottom: 24 }} />
    </Stage>
  );
}

/**
 * The last step: not the steps again (the page lists them) but what is coming
 * - the message that says they're approved, and the vest they'll wear. When a
 * document was turned down, the one to send again.
 */
export function ReviewScene({ rejected }: { readonly rejected?: boolean }) {
  if (rejected) {
    return (
      <Stage>
        <Float i={0} tilt={-6} style={[styles.doc, { left: 70, top: 30 }]}>
          <Ionicons name="document-text" size={28} color={c.accent} />
          <View style={[styles.line, styles.lineDark, { width: "70%" }]} />
          <View style={[styles.line, { width: "85%" }]} />
          <View style={[styles.line, { width: "55%" }]} />
          <View style={[styles.check, { backgroundColor: c.danger }]}>
            <Ionicons name="close" size={14} color={c.onAccent} />
          </View>
        </Float>
        <Float i={1} tilt={4} style={{ right: 20, bottom: 30 }}>
          <View style={styles.row}>
            <Ionicons name="camera" size={14} color={c.accent} />
            <Txt v="caption" tone="strong" style={styles.bold}>
              Send a clearer photo
            </Txt>
          </View>
        </Float>
      </Stage>
    );
  }
  return (
    <Stage>
      <Float i={0} tilt={-2} style={styles.notice}>
        <View style={styles.row}>
          <Mark />
          <View style={styles.flex}>
            <Txt v="caption" tone="strong" style={styles.bold} lines={1}>
              You're approved
            </Txt>
            <Txt v="caption" tone="muted" lines={1}>
              Your vehicle and vest are ready
            </Txt>
          </View>
        </View>
      </Float>
      <Animated.View entering={enter(1, 160)} style={[styles.vest, { right: 58, bottom: 30 }]}>
        <VestPatch value="214" size="md" />
      </Animated.View>
      <Token i={2} icon="hourglass" style={{ left: 40, bottom: 40 }} />
    </Stage>
  );
}

/** An inspector's badge. */
export function StaffScene() {
  return (
    <Stage>
      <Float i={0} tilt={-4} style={[styles.card, { left: 52, top: 40, width: 200 }]}>
        <View style={[styles.cardBar, { backgroundColor: c.hero }]} />
        <View style={styles.row}>
          <View style={styles.photo}>
            <Ionicons name="shield-checkmark" size={26} color={c.accent} />
          </View>
          <View style={[styles.flex, { gap: 4 }]}>
            <Txt v="caption" tone="strong" style={styles.bold}>
              Nova inspector
            </Txt>
            <View style={[styles.line, { width: "70%" }]} />
          </View>
        </View>
      </Float>
      <Token i={1} icon="qr-code" style={{ right: 44, bottom: 36 }} />
    </Stage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stage: { width: W, height: H, alignSelf: "center" },
  disc: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    left: W / 2 - 100,
    top: H / 2 - 100,
    backgroundColor: c.heroRaised,
  },
  spark: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: c.highlight },
  sparkSmall: { width: 5, height: 5, borderRadius: 3 },
  float: {
    position: "absolute",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: c.surfaceRaised,
    ...shadow.float,
  },
  token: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.highlight,
    borderWidth: 3,
    borderColor: c.hero,
    alignItems: "center",
    justifyContent: "center",
  },
  smallToken: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bold: { fontFamily: font.semibold },
  num: { fontFamily: font.num, letterSpacing: 0.5, ...tabular },
  bike: { position: "absolute", left: W / 2 - 88, top: H / 2 - 70 },
  bikeSmall: { position: "absolute", left: 36, bottom: 0 },
  mark: { width: 22, height: 22, borderRadius: 6, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  markText: { fontFamily: font.numBold, fontSize: 13, lineHeight: 16 },
  sms: { left: W / 2 - 115, top: 40, width: 230, paddingVertical: 12, gap: 2 },
  smsLine: { marginTop: 6 },
  code: { fontFamily: font.numBold, fontSize: 28, lineHeight: 34, letterSpacing: 2, ...tabular },
  notice: { left: W / 2 - 128, top: 36, width: 256, paddingVertical: 11 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.highlight, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: font.numBold },
  vest: { position: "absolute", right: 40, bottom: 34, transform: [{ rotate: "8deg" }] },
  card: { width: 190, gap: 6, paddingTop: 16, overflow: "hidden" },
  cardBar: { position: "absolute", left: 0, right: 0, top: 0, height: 6 },
  photo: { width: 48, height: 56, borderRadius: 8, backgroundColor: c.tintBlue, alignItems: "center", justifyContent: "center" },
  line: { height: 6, borderRadius: 3, backgroundColor: c.surfaceHigh },
  lineDark: { backgroundColor: c.border },
  doc: { width: 116, height: 142, gap: 8, paddingTop: 14 },
  check: {
    position: "absolute",
    right: -8,
    top: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.success,
    borderWidth: 2,
    borderColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
});

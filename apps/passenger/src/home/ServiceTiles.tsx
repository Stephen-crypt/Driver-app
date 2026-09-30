import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Press, Txt, VehicleGlyph, c, radius, space, type IconName } from "@nova/kit";

export type Service = "moto" | "cab" | "later" | "regular";

interface Tile {
  readonly key: Service;
  readonly title: string;
  readonly hint: string;
  readonly well: string;
  readonly ink: string;
  readonly vehicle?: "moto" | "cab";
  readonly icon?: IconName;
  /** A drawn vehicle, when one exists; the glyph stands in until then. */
  readonly art?: ImageSourcePropType;
}

const TILES: readonly Tile[] = [
  { key: "moto", title: "Moto", hint: "Fastest through traffic", well: c.highlight, ink: c.onHighlight, vehicle: "moto" },
  { key: "cab", title: "Cab", hint: "Up to four people", well: c.accent, ink: c.onAccent, vehicle: "cab" },
  { key: "later", title: "Book ahead", hint: "Pick a day and a time", well: c.successSoft, ink: c.success, icon: "calendar" },
  { key: "regular", title: "Regular trip", hint: "Same ride, every week", well: c.warningSoft, ink: c.warning, icon: "repeat" },
];

/**
 * What a passenger can ask for, as four tiles: the two vehicles now, or a ride
 * later, or the same ride every week. One tap sets the mode and opens the
 * search, so the common case - a moto, now - is two taps from the home screen
 * to a price.
 */
export function ServiceTiles({ onPick }: { readonly onPick: (service: Service) => void }) {
  return (
    <View>
      <Txt v="label" tone="muted" style={styles.title}>
        What do you need today?
      </Txt>
      <View style={styles.grid}>
        {TILES.map((t) => (
          <Press
            key={t.key}
            onPress={() => onPick(t.key)}
            scaleTo={0.97}
            style={styles.tile}
            accessibilityRole="button"
            accessibilityLabel={`${t.title}. ${t.hint}`}
          >
            <View style={[styles.well, { backgroundColor: t.well }]}>
              {t.art ? (
                <Image source={t.art} style={styles.art} resizeMode="contain" />
              ) : t.vehicle ? (
                <VehicleGlyph kind={t.vehicle} size={28} colour={t.ink} />
              ) : (
                <Ionicons name={t.icon ?? "ellipse"} size={24} color={t.ink} />
              )}
            </View>
            <View style={styles.text}>
              <Txt v="bodyStrong">{t.title}</Txt>
              <Txt v="caption" tone="muted" lines={1}>
                {t.hint}
              </Txt>
            </View>
            <Ionicons name="arrow-forward" size={16} color={c.textMuted} style={styles.arrow} />
          </Press>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: space.sm, paddingHorizontal: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    width: "48.4%",
    flexGrow: 1,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    gap: space.sm,
  },
  well: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  art: { width: 46, height: 46 },
  text: { gap: 1 },
  arrow: { position: "absolute", top: space.md, right: space.md },
});

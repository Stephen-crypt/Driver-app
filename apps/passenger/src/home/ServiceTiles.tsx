import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Press, Txt, VehicleArt, c, radius, shadow, space } from "@nova/kit";

export type Service = "moto" | "cab" | "later" | "regular";

interface Tile {
  readonly key: Service;
  readonly title: string;
  readonly hint: string;
  /** The tile's ground: one tint per kind of thing. */
  readonly ground: string;
  readonly art?: ImageSourcePropType;
}

const TILES: readonly Tile[] = [
  { key: "moto", title: "Moto", hint: "Fastest through traffic", ground: c.tintYellow },
  { key: "cab", title: "Cab", hint: "Up to four people", ground: c.tintBlue },
  { key: "later", title: "Book ahead", hint: "Pick a day and a time", ground: c.tintGreen, art: require("../../assets/tiles/later.png") },
  { key: "regular", title: "Regular trip", hint: "Same ride, every week", ground: c.tintAmber, art: require("../../assets/tiles/regular.png") },
];

/**
 * What a passenger can ask for, as four tiles: the two vehicles now, or a ride
 * later, or the same ride every week. One tap sets the mode and opens the
 * search, so the common case - a moto, now - is two taps from the home screen
 * to a price. Each tile is its own tint with its own drawing, so the four are
 * told apart before a word is read.
 */
export function ServiceTiles({ onPick }: { readonly onPick: (service: Service) => void }) {
  return (
    <View style={styles.grid}>
      {TILES.map((t) => (
        <Press
          key={t.key}
          onPress={() => onPick(t.key)}
          scaleTo={0.97}
          style={[styles.tile, { backgroundColor: t.ground }]}
          accessibilityRole="button"
          accessibilityLabel={`${t.title}. ${t.hint}`}
        >
          <View style={styles.artRow}>
            {t.art ? (
              <Image source={t.art} style={styles.art} resizeMode="contain" accessibilityIgnoresInvertColors />
            ) : (
              <VehicleArt kind={t.key} size={84} style={styles.vehicle} />
            )}
            <View style={styles.go}>
              <Ionicons name="arrow-forward" size={15} color={c.textStrong} />
            </View>
          </View>
          <View>
            <Txt v="section">{t.title}</Txt>
            <Txt v="caption" tone="default" lines={1}>
              {t.hint}
            </Txt>
          </View>
        </Press>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm + 4 },
  tile: {
    width: "47.5%",
    flexGrow: 1,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderRadius: radius.xl - 4,
    gap: 2,
  },
  artRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", height: 84, marginBottom: space.xs },
  // The drawings are cut out with a little air around them; the negative
  // margin lines the subject, not its box, up with the text below.
  art: { width: 78, height: 78, marginLeft: -6, marginTop: 4 },
  vehicle: { marginLeft: -8 },
  go: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginTop: space.xs,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
});

import { StyleSheet, View } from "react-native";
import {
  Button,
  Chip,
  PinPatches,
  Pulse,
  Txt,
  VestPatch,
  c,
  money,
  radius,
  space,
} from "@gera/kit";
import { Ionicons } from "@expo/vector-icons";
import { waitingChargeFor } from "@gera/core";
import type { RiderCard, RiderPosition, TripSnapshot, WaitStatus } from "@gera/data";

const CLASS_NAME: Record<string, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

function minutes(seconds: number | null | undefined): string {
  if (!seconds || seconds < 60) return "1";
  return String(Math.round(seconds / 60));
}

function clock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Searching({ onCancel, busy }: { readonly onCancel: () => void; readonly busy: boolean }) {
  return (
    <View style={styles.searching}>
      <Pulse size={120}>
        <Ionicons name="bicycle" size={28} color={c.onAccent} />
      </Pulse>
      <Txt v="title" align="center">
        Finding you a rider
      </Txt>
      <Txt v="body" tone="muted" align="center">
        Usually under a minute. We ask the closest riders one at a time.
      </Txt>
      <Button label="Cancel" variant="quiet" onPress={onCancel} disabled={busy} compact />
    </View>
  );
}

/**
 * Who is coming, how soon, and the PIN. The PIN is set in vest patches, the same
 * numerals the rider wears on their back: the two numbers that prove to each
 * of them that the other is the right person.
 */
export function Assigned({
  trip,
  rider,
  riderAt,
  pin,
  wait,
  now,
  busy,
  onCall,
  onShare,
  onSos,
  onCancel,
}: {
  readonly trip: TripSnapshot;
  readonly rider: RiderCard | null;
  readonly riderAt: RiderPosition | null;
  readonly pin: string | null;
  readonly wait: { status: WaitStatus; readAt: number } | null;
  readonly now: number;
  readonly busy: boolean;
  readonly onCall: () => void;
  readonly onShare: () => void;
  readonly onSos: () => void;
  readonly onCancel: () => void;
}) {
  const name = rider?.firstName ?? "Your rider";
  const arrived = trip.state === "arrived";
  const moving = trip.state === "in_progress";

  let headline: string;
  let sub: string | null = null;
  if (moving) {
    headline = `On the way to ${trip.dropoffLabel}`;
    sub = riderAt ? `About ${minutes(riderAt.etaSeconds)} min to go` : null;
  } else if (arrived) {
    headline = `${name} is here`;
    // Pickup labels are often "Near X" already; "At Near X" reads as a typo.
    sub = trip.pickupLabel.startsWith("Near ") ? trip.pickupLabel : `At ${trip.pickupLabel}`;
  } else {
    headline = `${name} is on the way`;
    // The minutes are shown big beside the headline once there is a fix, so
    // the line underneath says where they are going instead of repeating it.
    sub = "Heading to your pickup";
  }

  const s = wait?.status;
  const waited = s ? s.waitedSeconds + Math.floor((now - wait!.readAt) / 1000) : 0;
  const grace = s?.graceSeconds ?? 300;
  const freeLeft = Math.max(0, grace - waited);
  const charge = s ? waitingChargeFor(waited, grace, s.perMinuteRwf) : 0;

  return (
    <View style={styles.stack}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Txt v="title" lines={2}>
            {headline}
          </Txt>
          {sub ? (
            <Txt v="label" tone="muted">
              {sub}
            </Txt>
          ) : null}
        </View>
        {!moving && !arrived && riderAt ? (
          <View style={styles.eta}>
            <Txt v="display" tabularNums>
              {minutes(riderAt.etaSeconds)}
            </Txt>
            <Txt v="caption" tone="muted">
              min
            </Txt>
          </View>
        ) : null}
      </View>

      {rider ? (
        <View style={styles.rider}>
          {rider.vestNumber ? <VestPatch value={rider.vestNumber} size="md" label={`Vest ${rider.vestNumber}`} /> : null}
          <View style={styles.flex}>
            <Txt v="heading">{rider.firstName}</Txt>
            <Txt v="label" tone="muted">
              {CLASS_NAME[rider.vehicleClass] ?? "Vehicle"}
              {rider.rating ? ` · ★ ${rider.rating.toFixed(1)}` : ""}
            </Txt>
          </View>
          {rider.plate ? (
            <View style={styles.plate}>
              <Txt v="figure" tabularNums style={styles.plateText}>
                {rider.plate}
              </Txt>
            </View>
          ) : null}
        </View>
      ) : null}

      {pin && !moving ? (
        <View style={styles.pin}>
          <View style={styles.flex}>
            <Txt v="bodyStrong">Your PIN</Txt>
            <Txt v="label" tone="muted">
              {arrived ? `Tell ${name} these numbers to start` : "Tell your rider when they arrive"}
            </Txt>
          </View>
          <PinPatches pin={pin} size="sm" />
        </View>
      ) : null}

      {arrived && s ? (
        <View style={styles.waitRow}>
          <Ionicons name="time-outline" size={18} color={freeLeft > 0 ? c.textMuted : c.warning} />
          <Txt v="label" tone={freeLeft > 0 ? "muted" : "warn"} style={styles.flex}>
            {freeLeft > 0
              ? `${name} waits free for ${clock(freeLeft)} more`
              : `Waiting is now charged · +${money(charge)} RWF so far`}
          </Txt>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Action icon="call" label="Call" onPress={onCall} />
        <Action icon="share-social" label="Share trip" onPress={onShare} />
        <Action icon="shield" label="Safety" onPress={onSos} tone="bad" />
        {!moving ? <Action icon="close" label="Cancel" onPress={onCancel} disabled={busy} /> : null}
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  tone,
  disabled,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "bad";
  readonly disabled?: boolean;
}) {
  return (
    <View style={styles.action}>
      <Button
        label=""
        icon={icon}
        variant={tone === "bad" ? "danger" : "secondary"}
        compact
        onPress={onPress}
        disabled={disabled}
        style={styles.actionButton}
      />
      <Txt v="caption" tone="muted" align="center">
        {label}
      </Txt>
    </View>
  );
}

export function Ended({
  state,
  onAgain,
}: {
  readonly state: string;
  readonly onAgain: () => void;
}) {
  const copy: Record<string, { title: string; body: string }> = {
    no_riders: { title: "No riders free nearby", body: "Everyone close by is on a trip. Try again in a few minutes." },
    expired: { title: "That request timed out", body: "Nobody accepted in time. Try again - it's usually quicker the second time." },
    cancelled_by_rider: { title: "Your rider cancelled", body: "You haven't been charged. Book again and we'll find someone else." },
    cancelled_by_passenger: { title: "Trip cancelled", body: "You haven't been charged." },
    no_show: {
      title: "Your rider couldn't find you",
      body: "They waited at the pickup and have left. Book again when you're ready - adding a note helps them find you.",
    },
  };
  const t = copy[state] ?? { title: "Trip ended", body: "" };
  return (
    <View style={styles.stack}>
      <Chip label={state === "no_show" ? "No-show recorded" : "Not charged"} tone={state === "no_show" ? "warn" : "neutral"} />
      <Txt v="title">{t.title}</Txt>
      <Txt v="body" tone="muted">
        {t.body}
      </Txt>
      <Button label="Book again" onPress={onAgain} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  searching: { alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  eta: { alignItems: "center" },
  rider: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceHigh,
  },
  // The plate is what the passenger scans the kerb for, so it is set like one.
  plate: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: c.textStrong,
    backgroundColor: c.surfaceRaised,
  },
  plateText: { fontSize: 20, lineHeight: 24, letterSpacing: 1 },
  pin: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: c.accentSoft,
  },
  waitRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  action: { alignItems: "center", gap: 4, width: 76 },
  actionButton: { width: 56, paddingHorizontal: 0 },
});

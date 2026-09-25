import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Keypad, PinBoxes, Txt, c, notify, space } from "@gera/kit";
import { startTrip } from "@gera/data";
import { supabase } from "../lib/supabase";

/**
 * NOVA §18. The passenger reads four digits off their screen; the rider types
 * them. It proves the person on the back is the person who booked - which is
 * the whole of passenger verification in a cash-only city.
 *
 * Submits itself on the fourth digit. There is no "Start" button to find with a
 * glove on.
 */
export function PinSheet({
  tripId,
  passengerName,
  visible,
  onClose,
  onStarted,
}: {
  readonly tripId: string;
  readonly passengerName: string;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onStarted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPin("");
      setMessage(null);
    }
  }, [visible]);

  const submit = async (value: string) => {
    setChecking(true);
    try {
      const r = await startTrip(supabase, tripId, value);
      if (r.started) {
        notify("success");
        onStarted();
        return;
      }
      notify("error");
      setShake((n) => n + 1);
      setPin("");
      if (r.reason === "locked") {
        setLocked(true);
        setMessage({
          text: "Too many wrong tries. Call the passenger to check it's them, or cancel the trip.",
          bad: true,
        });
      } else {
        setMessage({
          text: `That's not it. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left.`,
          bad: true,
        });
      }
    } catch (e) {
      setPin("");
      setMessage({ text: e instanceof Error ? e.message : "Could not check the PIN.", bad: true });
    } finally {
      setChecking(false);
    }
  };

  const onDigit = (d: string) => {
    if (checking || locked || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setMessage(null);
    if (next.length === 4) void submit(next);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.close}>
          <Ionicons name="close" size={28} color={c.textStrong} />
        </Pressable>

        <View style={styles.top}>
          <Txt v="title">Enter the PIN</Txt>
          <Txt v="body" tone="muted">
            Ask {passengerName} for the four numbers on their screen.
          </Txt>
        </View>

        <View style={styles.middle}>
          <PinBoxes value={pin} shakeKey={shake} />
          <View style={styles.message}>
            {checking ? (
              <Txt v="label" tone="muted" align="center">
                Checking…
              </Txt>
            ) : message ? (
              <Txt v="label" tone={message.bad ? "bad" : "muted"} align="center">
                {message.text}
              </Txt>
            ) : null}
          </View>
        </View>

        <Keypad onDigit={onDigit} onDelete={() => setPin((p) => p.slice(0, -1))} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: space.lg },
  close: { alignSelf: "flex-start", marginBottom: space.md },
  top: { gap: space.xs },
  middle: { flex: 1, justifyContent: "center", gap: space.lg },
  message: { minHeight: 40, paddingHorizontal: space.md },
});

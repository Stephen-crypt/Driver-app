import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton, Keypad, PinBoxes, SuccessMark, Swap, Txt, c, notify, space } from "@nova/kit";
import { startTrip } from "@nova/data";
import { supabase } from "../lib/supabase";

/**
 * NOVA §18. The passenger reads four digits off their screen; the rider types
 * them. It proves the person on the back is the person who booked - which is
 * the whole of passenger verification in a cash-only city.
 *
 * Submits itself on the fourth digit. There is no "Start" button to find with a
 * glove on. A match is shown for a beat before the sheet closes, so the rider
 * sees it worked instead of guessing from the screen behind.
 */
export function PinSheet({
  tripId,
  passengerName,
  visible,
  onClose,
  onStarted,
  onCall,
}: {
  readonly tripId: string;
  readonly passengerName: string;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onStarted: () => void;
  /**
   * Offered when the PIN won't come right: the passenger may be someone else.
   * Returns what went wrong, if anything, to be shown here - a toast would be
   * hidden behind this sheet.
   */
  readonly onCall?: () => Promise<{ text: string; bad: boolean } | null>;
}) {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [matched, setMatched] = useState(false);
  const done = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setPin("");
      setMessage(null);
      setMatched(false);
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (done.current) clearTimeout(done.current);
    },
    [],
  );

  const submit = async (value: string) => {
    setChecking(true);
    try {
      const r = await startTrip(supabase, tripId, value);
      if (r.started) {
        notify("success");
        setMatched(true);
        done.current = setTimeout(onStarted, 900);
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
    if (checking || locked || matched || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setMessage(null);
    if (next.length === 4) void submit(next);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.bar}>
          <IconButton icon="close" label="Close" onPress={onClose} size={44} />
        </View>

        <Swap id={matched ? "matched" : "entry"} style={styles.flex}>
          {matched ? (
            <View style={styles.matched}>
              <SuccessMark size={84} />
              <Txt v="title" align="center">
                PIN matches
              </Txt>
              <Txt v="body" tone="muted" align="center">
                Trip started. Ride safe with {passengerName}.
              </Txt>
            </View>
          ) : (
            <View style={styles.flex}>
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
                {(locked || (message?.bad && shake > 1)) && onCall ? (
                  <Button
                    label={`Call ${passengerName}`}
                    icon="call"
                    variant="secondary"
                    compact
                    onPress={async () => {
                      const problem = await onCall();
                      if (problem) setMessage(problem);
                    }}
                  />
                ) : null}
              </View>

              <Keypad onDigit={onDigit} onDelete={() => setPin((p) => p.slice(0, -1))} />
            </View>
          )}
        </Swap>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: space.lg },
  bar: { flexDirection: "row", marginLeft: -space.sm, marginBottom: space.sm },
  top: { gap: space.xs },
  middle: { flex: 1, justifyContent: "center", gap: space.lg },
  message: { minHeight: 40, paddingHorizontal: space.md },
  matched: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingBottom: space.xxl },
});

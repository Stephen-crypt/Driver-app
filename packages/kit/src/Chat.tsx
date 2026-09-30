import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { c, font, radius, space } from "./theme";
import { Txt } from "./Txt";
import { Press } from "./Press";
import { Chip, tap } from "./controls";
import { ModalSheet } from "./overlay";
import { Enter } from "./layout";

export interface ChatLine {
  readonly id: number | string;
  readonly body: string;
  readonly mine: boolean;
  readonly at: string;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The thread between a passenger and a rider, as a sheet over the trip. Built
 * for one thumb and a short exchange: quick replies above the keyboard, the
 * other person's words on the left, yours on the right. It closes with the
 * trip, and says so, rather than pretending a finished trip can still talk.
 */
export function ChatSheet({
  visible,
  onClose,
  name,
  lines,
  quickReplies,
  onSend,
  sending,
  open,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The other person's first name. */
  readonly name: string;
  readonly lines: readonly ChatLine[];
  readonly quickReplies: readonly string[];
  readonly onSend: (text: string) => void;
  readonly sending?: boolean;
  /** False once the trip has ended. */
  readonly open: boolean;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }, [visible, lines.length]);

  const send = (t: string) => {
    const body = t.trim();
    if (!body || !open || sending) return;
    tap();
    onSend(body);
    setText("");
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title={name} subtitle={open ? "Only while your trip is on" : "This trip has ended"}>
      <View style={styles.thread}>
        <ScrollView ref={scroller} style={styles.list} contentContainerStyle={styles.listInner} keyboardShouldPersistTaps="handled">
          {lines.length === 0 ? (
            <Txt v="label" tone="muted" align="center" style={styles.empty}>
              Say where you are. Short and clear works best.
            </Txt>
          ) : null}
          {lines.map((l, i) => {
            const prev = lines[i - 1];
            const first = !prev || prev.mine !== l.mine;
            return (
              <Enter key={l.id} i={0} style={[styles.row, l.mine ? styles.rowMine : styles.rowTheirs, first ? styles.rowFirst : null]}>
                <View style={[styles.bubble, l.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Txt v="body" tone={l.mine ? "inverse" : "strong"}>
                    {l.body}
                  </Txt>
                </View>
                <Txt v="caption" tone="muted" style={styles.time}>
                  {clock(l.at)}
                </Txt>
              </Enter>
            );
          })}
        </ScrollView>

        {open ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quick} keyboardShouldPersistTaps="handled">
              {quickReplies.map((q) => (
                <Chip key={q} label={q} tone="accent" onPress={() => send(q)} />
              ))}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={`Message ${name}`}
                placeholderTextColor={c.textMuted}
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={() => send(text)}
                blurOnSubmit={false}
                accessibilityLabel="Message"
              />
              <Press
                onPress={() => send(text)}
                disabled={!text.trim() || !!sending}
                scaleTo={0.9}
                style={[styles.send, (!text.trim() || sending) && styles.sendOff]}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <Ionicons name="arrow-up" size={22} color={c.onAccent} />
              </Press>
            </View>
          </>
        ) : null}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  thread: { gap: space.sm },
  list: { maxHeight: 340 },
  listInner: { gap: 4, paddingVertical: space.xs },
  empty: { paddingVertical: space.lg },
  row: { maxWidth: "82%", gap: 2 },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  rowFirst: { marginTop: space.sm },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: c.accent, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: c.surfaceHigh, borderBottomLeftRadius: 6 },
  time: { paddingHorizontal: 4 },
  quick: { gap: space.sm, paddingVertical: space.xs },
  composer: { flexDirection: "row", alignItems: "center", gap: space.sm },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceHigh,
    color: c.textStrong,
    fontFamily: font.regular,
    fontSize: 16,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.35 },
});

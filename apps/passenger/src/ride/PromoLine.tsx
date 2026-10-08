import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Banner, Button, ChoiceRow, Divider, Field, ModalSheet, Press, Txt, c, font, money, space } from "@nova/kit";
import { addPromoCode, listMyPromos, promoLabel, promoMisfit, type MyPromo, type QuoteResult } from "@nova/data";
import { supabase } from "../lib/supabase";

/** "best" (the code saving most), "none", or one code by id. */
export type PromoChoice = string;

/**
 * The promo on the ride sheet, above Cash. With a code that fits it says what
 * comes off; tapping it lets the passenger pick another code, turn promos off
 * for this ride, or add one. Every change re-prices the options.
 */
export function PromoLine({
  quote,
  vehicleClass,
  choice,
  onChoose,
  regular,
}: {
  readonly quote: QuoteResult | undefined;
  readonly vehicleClass: string;
  readonly choice: PromoChoice;
  readonly onChoose: (choice: PromoChoice) => void;
  /** Regular trips never carry a promo. */
  readonly regular: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<MyPromo[] | null>(null);

  const load = useCallback(() => {
    listMyPromos(supabase)
      .then((all) => setSaved(all.filter((p) => p.status === "ready")))
      .catch(() => setSaved((s) => s ?? []));
  }, []);
  useEffect(load, [load]);

  if (regular) {
    return (
      <View style={styles.line}>
        <View style={[styles.icon, styles.iconOff]}>
          <Ionicons name="pricetag" size={16} color={c.textMuted} />
        </View>
        <View style={styles.flex}>
          <Txt v="bodyStrong" tone="muted">
            Promo codes
          </Txt>
          <Txt v="caption" tone="muted">
            Not used on regular trips
          </Txt>
        </View>
      </View>
    );
  }

  const promo = quote?.promo ?? null;
  // A saved code that does not fit this ride says why, so it does not look lost.
  const misfit =
    !promo && choice !== "none" && quote
      ? (saved ?? []).map((p) => promoMisfit(p, vehicleClass, quote.amountRwf)).find((m) => m !== null) ?? null
      : null;

  const title = promo ? promo.code : choice === "none" ? "No promo on this ride" : "Add a promo code";
  const caption = promo
    ? `${money(promo.discountRwf)} RWF off. Nova pays the difference.`
    : choice === "none"
      ? "Tap to use one of your codes"
      : misfit
        ? `Your code: ${misfit}`
        : "Make this ride cheaper";

  return (
    <>
      <Press
        onPress={() => {
          load();
          setOpen(true);
        }}
        scaleTo={0.985}
        style={styles.line}
        accessibilityRole="button"
        accessibilityLabel={promo ? `Promo ${promo.code}, ${promo.discountRwf} Rwandan francs off. Change` : title}
      >
        <View style={[styles.icon, !promo && styles.iconOff]}>
          <Ionicons name="pricetag" size={16} color={promo ? c.success : c.textMuted} />
        </View>
        <View style={styles.flex}>
          <Txt v="bodyStrong" lines={1}>
            {title}
          </Txt>
          <Txt v="caption" tone={promo ? "good" : "muted"} lines={1}>
            {caption}
          </Txt>
        </View>
        {promo ? (
          <Txt v="label" tone="accent" style={styles.change}>
            Change
          </Txt>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        )}
      </Press>
      <PromoPicker
        visible={open}
        onClose={() => setOpen(false)}
        saved={saved}
        current={promo?.id ?? (choice === "none" ? "none" : null)}
        quote={quote}
        vehicleClass={vehicleClass}
        onChoose={(next) => {
          setOpen(false);
          onChoose(next);
        }}
        onAdded={load}
      />
    </>
  );
}

function PromoPicker({
  visible,
  onClose,
  saved,
  current,
  quote,
  vehicleClass,
  onChoose,
  onAdded,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly saved: readonly MyPromo[] | null;
  readonly current: string | null;
  readonly quote: QuoteResult | undefined;
  readonly vehicleClass: string;
  readonly onChoose: (choice: PromoChoice) => void;
  readonly onAdded: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await addPromoCode(supabase, code);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setCode("");
      onAdded();
      onChoose(r.promo.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Promo codes" subtitle="One code per ride. The saving comes off before you book.">
      <View style={styles.sheet}>
        {(saved ?? []).map((p) => {
          const misfit = quote ? promoMisfit(p, vehicleClass, quote.amountRwf) : null;
          return (
            <View key={p.id}>
              <ChoiceRow
                kind="radio"
                icon="pricetag"
                on={current === p.id}
                disabled={misfit !== null}
                onPress={() => onChoose(p.id)}
                title={p.code}
                hint={misfit ?? promoLabel(p)}
              />
              <Divider inset={space.md + 38 + space.md} />
            </View>
          );
        })}
        <ChoiceRow
          kind="radio"
          icon="close-circle-outline"
          on={current === "none"}
          onPress={() => onChoose("none")}
          title="No promo on this ride"
          hint="Keep your codes for later"
        />
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <Field
              label="Add a code"
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase());
                setError(null);
              }}
              placeholder="e.g. NOVA50"
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => void add()}
              onPaper
              maxLength={24}
            />
          </View>
          <Button label="Add" compact onPress={() => void add()} loading={busy} disabled={code.trim().length < 3} />
        </View>
        {error ? (
          <Banner tone="bad" icon="alert-circle">
            {error}
          </Banner>
        ) : null}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.successSoft, alignItems: "center", justifyContent: "center" },
  iconOff: { backgroundColor: c.surfaceHigh },
  change: { fontFamily: font.semibold },
  sheet: { gap: space.xs },
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginTop: space.md },
});

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import {
  Banner,
  Button,
  Chip,
  Field,
  Group,
  Press,
  Screen,
  Segmented,
  Skeleton,
  SuccessMark,
  TextArea,
  Txt,
  VestPatch,
  c,
  notify,
  radius,
  space,
} from "@gera/kit";
import {
  INSPECTION_ITEMS,
  bestResultFor,
  inspectLookup,
  recordInspection,
  uploadInspectionPhoto,
  type AlcoholResult,
  type CheckValue,
  type InspectionItem,
  type InspectionResult,
  type LookupResult,
} from "@gera/data";
import { supabase } from "../../src/lib/supabase";
import { goBack } from "../../src/lib/nav";
import * as loc from "../../src/lib/location";

const CHECK_OPTIONS = [
  { value: "pass", label: "OK", tone: "good" },
  { value: "fail", label: "Fail", tone: "bad" },
  { value: "na", label: "N/A" },
] as const;

/** NOVA §47, §48, §50: one inspection, from who it is to what was found. */
export default function Check() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [found, setFound] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [kind, setKind] = useState<"routine" | "random">("routine");
  const [checks, setChecks] = useState<Partial<Record<InspectionItem, CheckValue>>>({});
  const [alcohol, setAlcohol] = useState<AlcoholResult | "not_done">("not_done");
  const [reading, setReading] = useState("");
  const [device, setDevice] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<{ uri: string; path: string }[]>([]);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ caseNumber: number | null } | null>(null);

  useEffect(() => {
    if (!code) return;
    inspectLookup(supabase, code)
      .then((r) => {
        setFound(r);
        // A cab has no helmets to check.
        if (r.vehicle && r.vehicle.class !== "moto") setChecks((x) => ({ ...x, helmets: "na" }));
        // Scanning a vehicle sticker alone skips the rider's own checks.
        if (!r.rider) setChecks((x) => ({ ...x, identity: "na", documents: "na", vest: "na", helmets: "na" }));
      })
      .catch((e: Error) => setLookupError(e.message));
  }, [code]);

  const alcoholResult = alcohol === "not_done" ? null : alcohol;
  const best = bestResultFor(checks, alcoholResult);
  // Never leave a result selected that the checks no longer allow.
  const chosen: InspectionResult | null = result === "pass" && best === "fail" ? null : result;
  const unanswered = INSPECTION_ITEMS.filter((i) => !checks[i.key]).length;

  const addPhoto = async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const picked = perm.granted
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (picked.canceled || !picked.assets[0]) return;
    const a = picked.assets[0];
    const mime = a.mimeType ?? "image/jpeg";
    setUploading(true);
    try {
      const { data } = await supabase.auth.getUser();
      const path = await uploadInspectionPhoto(supabase, data.user!.id, {
        uri: a.uri,
        mimeType: mime,
        extension: mime.includes("png") ? "png" : "jpg",
      });
      setPhotos((p) => [...p, { uri: a.uri, path }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the photo.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!found || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await recordInspection(supabase, {
        riderId: found.rider?.id ?? null,
        vehicleId: found.vehicle?.id ?? null,
        kind,
        checks,
        alcohol: alcoholResult
          ? { result: alcoholResult, reading: reading.trim() ? Number(reading.replace(",", ".")) : null, device: device.trim() }
          : null,
        result: chosen,
        notes: notes.trim(),
        photos: photos.map((p) => p.path),
        at: await loc.getCurrent(),
      });
      notify("success");
      setDone({ caseNumber: r.caseNumber });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the inspection.");
    } finally {
      setBusy(false);
    }
  };

  const who = useMemo(() => found?.rider?.name ?? found?.vehicle?.plate ?? "", [found]);

  if (done) {
    return (
      <Screen
        footer={
          <View style={styles.footer}>
            <Button label="Next inspection" icon="qr-code" onPress={() => router.replace("/inspect/scan")} />
            <Button label="Done" variant="secondary" onPress={() => router.replace("/inspect")} />
          </View>
        }
      >
        <View style={styles.doneBox}>
          <SuccessMark size={72} />
          <Txt v="title" align="center">
            Inspection saved
          </Txt>
          <Txt v="body" tone="muted" align="center">
            {done.caseNumber
              ? `Case #${done.caseNumber} is open for the safety desk. Nothing happens to ${who} automatically; a person reviews it.`
              : `Recorded against ${who}.`}
          </Txt>
        </View>
      </Screen>
    );
  }

  if (lookupError) {
    return (
      <Screen title="Not found" onBack={() => goBack(router)} footer={<Button label="Try again" onPress={() => router.replace("/inspect")} />}>
        <Banner tone="warn" icon="search">
          {lookupError}
        </Banner>
      </Screen>
    );
  }

  if (!found) {
    return (
      <Screen onBack={() => goBack(router)} stagger={false}>
        <View style={styles.loading}>
          <View style={styles.id}>
            <Skeleton width={60} height={74} r={14} />
            <View style={[styles.flex, styles.loadingText]}>
              <Skeleton width="70%" height={28} r={8} />
              <Skeleton width="45%" height={14} />
            </View>
          </View>
          <Skeleton height={220} r={radius.lg} />
        </View>
      </Screen>
    );
  }

  const unverified = found.rider && found.rider.verification !== "verified";

  return (
    <Screen
      onBack={() => goBack(router)}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Banner tone="bad" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          <Button
            label={unanswered > 0 ? `${unanswered} checks left` : chosen ? "Save inspection" : "Choose a result"}
            onPress={submit}
            loading={busy}
            disabled={!chosen || unanswered > 0 || uploading || (alcohol === "positive" && !reading.trim())}
          />
        </View>
      }
    >
      <View style={styles.stack}>
        {/* Who is standing in front of the inspector. */}
        <View style={styles.id}>
          {found.vehicle?.vest ? <VestPatch value={found.vehicle.vest} size="lg" /> : null}
          <View style={styles.flex}>
            <Txt v="title">{found.rider?.name ?? "No rider assigned"}</Txt>
            <Txt v="body" tone="muted">
              {found.vehicle ? `${found.vehicle.plate}, ${found.vehicle.class === "moto" ? "Moto" : found.vehicle.class === "cab" ? "Cab" : "Cab XL"}` : "No vehicle assigned"}
            </Txt>
            <View style={styles.chips}>
              {found.rider ? (
                <Chip label={found.rider.verification === "verified" ? "Approved" : `Not approved (${found.rider.verification})`} tone={unverified ? "bad" : "good"} dot />
              ) : null}
              {found.rider ? <Chip label={found.rider.onShift ? "On shift" : "Not on shift"} tone={found.rider.onShift ? "accent" : "neutral"} /> : null}
            </View>
          </View>
        </View>
        {unverified ? (
          <Banner tone="bad" icon="warning">
            This rider is not approved to ride for Gera. Record what you find and note where they were.
          </Banner>
        ) : null}
        {found.lastInspection ? (
          <Txt v="caption" tone="muted">
            Last inspected {new Date(found.lastInspection.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            {found.lastInspection.inspector ? ` by ${found.lastInspection.inspector}` : ""}: {found.lastInspection.result}
          </Txt>
        ) : null}

        <Segmented
          label="Kind of inspection"
          value={kind}
          onChange={setKind}
          options={[
            { value: "routine", label: "Routine" },
            { value: "random", label: "Random check" },
          ]}
        />

        {(["rider", "vehicle"] as const).map((g) => (
          <Group key={g} title={g === "rider" ? "The rider" : "The vehicle"}>
            {INSPECTION_ITEMS.filter((i) => i.group === g).map((i) => (
              <View key={i.key} style={styles.check}>
                <Txt v="body" style={styles.flex}>
                  {i.label}
                </Txt>
                <Segmented compact label={i.label} value={checks[i.key] ?? null} options={CHECK_OPTIONS} onChange={(v) => setChecks((x) => ({ ...x, [i.key]: v }))} />
              </View>
            ))}
          </Group>
        ))}

        <Group title="Alcohol test">
          <View style={styles.pad}>
            <Segmented
              label="Alcohol test"
              value={alcohol}
              onChange={setAlcohol}
              options={[
                { value: "not_done", label: "Not done" },
                { value: "negative", label: "Negative", tone: "good" },
                { value: "positive", label: "Positive", tone: "bad" },
                { value: "refused", label: "Refused", tone: "bad" },
              ]}
            />
            {alcohol === "positive" ? (
              <Field label="Reading (mg/L breath)" value={reading} onChangeText={setReading} keyboardType="decimal-pad" onPaper />
            ) : null}
            {alcohol !== "not_done" && alcohol !== "refused" ? (
              <Field label="Device" value={device} onChangeText={setDevice} placeholder="Make and serial" onPaper />
            ) : null}
          </View>
        </Group>

        <Group title="Photos and notes">
          <View style={styles.pad}>
            <View style={styles.photos}>
              {photos.map((p) => (
                <Image key={p.path} source={{ uri: p.uri }} style={styles.thumb} accessibilityLabel="Inspection photo" />
              ))}
              <Press onPress={addPhoto} scaleTo={0.94} style={styles.addPhoto} accessibilityRole="button" accessibilityLabel="Add a photo" disabled={uploading}>
                {uploading ? <ActivityIndicator color={c.accent} /> : <Ionicons name="camera" size={24} color={c.accent} />}
                {uploading ? null : (
                  <Txt v="caption" tone="accent">
                    Add
                  </Txt>
                )}
              </Press>
            </View>
            <TextArea value={notes} onChangeText={setNotes} placeholder="Anything else you saw" minHeight={96} onPaper accessibilityLabel="Notes" />
          </View>
        </Group>

        <View style={styles.pad}>
          <Txt v="heading">Result</Txt>
          <Segmented
            label="Result"
            value={chosen}
            onChange={setResult}
            options={[
              { value: "pass", label: "Pass", tone: "good", disabled: best === "fail" },
              { value: "advisory", label: "Advisory", tone: "warn", disabled: best === "fail" },
              { value: "fail", label: "Fail", tone: "bad" },
            ]}
          />
          {best === "fail" ? (
            <Txt v="caption" tone="muted">
              Something failed, so this goes to the safety desk as a case. You record; a person decides.
            </Txt>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space.lg, paddingBottom: space.lg },
  footer: { gap: space.sm },
  id: { flexDirection: "row", alignItems: "center", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs },
  check: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  pad: { padding: space.md, gap: space.md },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  addPhoto: { width: 72, height: 72, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: c.accent, alignItems: "center", justifyContent: "center", gap: 2 },
  doneBox: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
  loading: { gap: space.lg, paddingTop: space.md },
  loadingText: { gap: space.sm },
});

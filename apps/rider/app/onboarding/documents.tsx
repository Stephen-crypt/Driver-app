import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, tokens } from "@gera/ui";
import {
  listMyDocuments,
  uploadDocument,
  DOCUMENT_LABELS,
  type RiderDocument,
  type DocumentKind,
} from "@gera/data";
import { supabase } from "../../src/lib/supabase";

function extensionFor(uri: string, mime: string): string {
  const fromUri = uri.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (fromUri && fromUri.length <= 4) return fromUri;
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

export default function Documents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [riderId, setRiderId] = useState<string | null>(null);
  const [docs, setDocs] = useState<RiderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<DocumentKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listMyDocuments(supabase));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your documents.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setRiderId(data.user?.id ?? null);
      await refresh();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const pick = useCallback(
    async (kind: DocumentKind) => {
      if (!riderId) return;
      setError(null);

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission needed",
          "Gera Rider needs access to your photos to upload your documents.",
        );
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        // A photo of a licence is read, not admired. Compressing keeps the
        // upload inside a Kigali data bundle.
        allowsEditing: false,
      });
      if (picked.canceled || !picked.assets[0]) return;

      const asset = picked.assets[0];
      const mime = asset.mimeType ?? "image/jpeg";

      setBusyKind(kind);
      try {
        await uploadDocument(supabase, riderId, kind, {
          uri: asset.uri,
          mimeType: mime,
          extension: extensionFor(asset.uri, mime),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed. Try again.");
      } finally {
        setBusyKind(null);
      }
    },
    [riderId, refresh],
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const outstanding = docs.filter((d) => !d.uploaded).length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tokens.space.md, paddingBottom: insets.bottom + tokens.space.xl },
      ]}
    >
      <Text style={styles.title}>Your documents</Text>
      <Text style={styles.sub}>
        We check these before your first trip. Clear photos, all four corners visible.
      </Text>

      {docs.map((d) => {
        const busy = busyKind === d.kind;
        return (
          <Pressable
            key={d.kind}
            style={styles.row}
            onPress={() => pick(d.kind)}
            disabled={busy}
            accessibilityRole="button"
          >
            {/* The state of each document is carried by the mark as well as the
                words, so a rider can see at a glance which one is holding them
                up without reading four lines of status text. */}
            <View
              style={[
                styles.well,
                d.status === "approved" && styles.wellGood,
                d.status === "rejected" && styles.wellBad,
              ]}
            >
              <Ionicons
                name={
                  d.status === "approved"
                    ? "checkmark-circle"
                    : d.status === "rejected"
                      ? "alert-circle"
                      : d.uploaded
                        ? "hourglass-outline"
                        : "cloud-upload-outline"
                }
                size={20}
                color={
                  d.status === "approved"
                    ? theme.success
                    : d.status === "rejected"
                      ? theme.danger
                      : theme.textMuted
                }
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowLabel}>{DOCUMENT_LABELS[d.kind]}</Text>
              {d.uploaded ? (
                <Text
                  style={[
                    styles.rowStatus,
                    d.status === "approved" && styles.approved,
                    d.status === "rejected" && styles.rejected,
                  ]}
                >
                  {d.status === "approved"
                    ? "Approved"
                    : d.status === "rejected"
                      ? (d.note ?? "Rejected — please upload again")
                      : "Waiting for review"}
                </Text>
              ) : (
                <Text style={styles.rowStatus}>Not uploaded yet</Text>
              )}
            </View>
            {busy ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <View style={styles.actionPill}>
                <Text style={styles.action}>{d.uploaded ? "Replace" : "Upload"}</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.note}>
        {outstanding === 0
          ? "All four are in. We'll let you know as soon as they're checked."
          : `${outstanding} still to upload.`}
      </Text>

      <Pressable
        style={styles.cta}
        onPress={() => router.replace("/onboarding/pending")}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxl },
  flex: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  title: { fontSize: tokens.type.title.size, fontWeight: "700", color: theme.textStrong },
  sub: {
    marginTop: tokens.space.sm,
    marginBottom: tokens.space.lg,
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.leading,
    color: theme.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.MIN_TOUCH_TARGET + 12,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    marginBottom: tokens.space.sm,
    borderRadius: tokens.radius.md,
    backgroundColor: theme.surfaceRaised,
  },
  well: {
    width: 36,
    height: 36,
    borderRadius: tokens.radius.sm,
    backgroundColor: theme.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  wellGood: { backgroundColor: theme.successSoft },
  wellBad: { backgroundColor: theme.dangerSoft },
  actionPill: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs + 2,
    borderRadius: tokens.radius.pill,
    backgroundColor: theme.accentSoft,
  },
  rowLabel: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.textStrong },
  rowStatus: { fontSize: tokens.type.label.size, color: theme.textMuted },
  approved: { color: theme.success },
  rejected: { color: theme.danger },
  action: { fontSize: tokens.type.label.size, fontWeight: "700", color: theme.accent },
  error: { color: theme.danger, fontSize: tokens.type.body.size },
  note: {
    marginTop: tokens.space.md,
    fontSize: tokens.type.body.size,
    color: theme.textMuted,
  },
  cta: {
    marginTop: tokens.space.lg,
    minHeight: tokens.MIN_TOUCH_TARGET + 8,
    backgroundColor: theme.accent,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: tokens.type.body.size, fontWeight: "700", color: theme.onAccent },
});

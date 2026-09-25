import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Banner, Button, Chip, Divider, Group, Row, Screen, c, space } from "@gera/kit";
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
      <Screen title="Your documents">
        <ActivityIndicator color={c.accent} />
      </Screen>
    );
  }

  const outstanding = docs.filter((d) => !d.uploaded).length;

  return (
    <Screen
      title="Your documents"
      subtitle="We check these before your first shift. Clear photos, all four corners in view."
      footer={
        <Button
          label={outstanding === 0 ? "Send for review" : `${outstanding} still to upload`}
          onPress={() => router.replace("/onboarding/pending")}
          disabled={outstanding > 0}
        />
      }
    >
      <Group>
        {docs.map((d, i) => {
          const busy = busyKind === d.kind;
          const state =
            d.status === "approved" ? "good" : d.status === "rejected" ? "bad" : d.uploaded ? "warn" : "neutral";
          return (
            <View key={d.kind}>
              {i > 0 ? <Divider inset={70} /> : null}
              {/* The state of each document is carried by the mark as well as
                  the words, so a rider sees at a glance which one is holding
                  them up without reading four lines of status text. */}
              <Row
                title={DOCUMENT_LABELS[d.kind]}
                subtitle={
                  d.status === "approved"
                    ? "Approved"
                    : d.status === "rejected"
                      ? (d.note ?? "Not accepted - upload it again")
                      : d.uploaded
                        ? "Waiting for review"
                        : "Not uploaded yet"
                }
                icon={
                  d.status === "approved"
                    ? "checkmark-circle"
                    : d.status === "rejected"
                      ? "alert-circle"
                      : d.uploaded
                        ? "hourglass-outline"
                        : "cloud-upload-outline"
                }
                iconTone={state}
                onPress={busy ? undefined : () => void pick(d.kind)}
                trailing={
                  busy ? (
                    <ActivityIndicator color={c.accent} />
                  ) : (
                    <Chip label={d.uploaded ? "Replace" : "Upload"} tone="accent" />
                  )
                }
              />
            </View>
          );
        })}
      </Group>
      {error ? (
        <View style={styles.error}>
          <Banner tone="bad" icon="alert-circle">{error}</Banner>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: space.md },
});

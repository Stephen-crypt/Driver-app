import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Banner, Button, Chip, Divider, Group, Row, Screen, SkeletonRows, StepTrack, Txt, c, notify, space, useOverlay } from "@nova/kit";
import {
  listMyDocuments,
  uploadDocument,
  DOCUMENT_LABELS,
  type RiderDocument,
  type DocumentKind,
} from "@nova/data";
import { supabase } from "../../src/lib/supabase";
import { goBack } from "../../src/lib/nav";
import { SIGNUP_STEPS } from "../../src/onboarding/steps";

function extensionFor(uri: string, mime: string): string {
  const fromUri = uri.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (fromUri && fromUri.length <= 4) return fromUri;
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

export default function Documents() {
  const router = useRouter();
  const overlay = useOverlay();
  // Reached from Me as well as from sign-up. From Me it is a page to check,
  // not a step in a process, so the progress track is left off.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const signingUp = from !== "me";
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

  const upload = useCallback(
    async (kind: DocumentKind, source: "camera" | "library") => {
      if (!riderId) return;
      setError(null);

      const permission =
        source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        overlay.toast({
          message: source === "camera" ? "Allow the camera in Settings to take the photo." : "Allow access to your photos in Settings to upload.",
          tone: "bad",
        });
        return;
      }

      // A photo of a licence is read, not admired. Compressing keeps the upload
      // inside a Kigali data bundle.
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, allowsEditing: false };
      const picked = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
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
        notify("success");
        overlay.toast({ message: `${DOCUMENT_LABELS[kind]} uploaded`, tone: "good", icon: "cloud-done" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed. Try again.");
      } finally {
        setBusyKind(null);
      }
    },
    [riderId, refresh, overlay],
  );

  const choose = (kind: DocumentKind) =>
    overlay.actions({
      title: DOCUMENT_LABELS[kind],
      message: "Lay it flat in good light, with all four corners in view.",
      options: [
        { label: "Take a photo", icon: "camera", tone: "accent", onPress: () => void upload(kind, "camera") },
        { label: "Choose from your photos", icon: "images", onPress: () => void upload(kind, "library") },
      ],
    });

  if (loading) {
    return (
      <Screen title="Your documents" stagger={false}>
        <SkeletonRows count={4} />
      </Screen>
    );
  }

  const outstanding = docs.filter((d) => !d.uploaded).length;
  const uploaded = docs.length - outstanding;

  return (
    <Screen
      title="Your documents"
      subtitle="We check these before your first shift. Clear photos, all four corners in view."
      onBack={router.canGoBack() ? () => goBack(router) : undefined}
      gap={space.lg}
      footer={
        signingUp ? (
          <Button
            label={outstanding === 0 ? "Send for review" : `${outstanding} still to upload`}
            onPress={() => router.replace("/onboarding/pending")}
            disabled={outstanding > 0}
          />
        ) : undefined
      }
    >
      {signingUp ? <StepTrack key="steps" steps={SIGNUP_STEPS} current={3} /> : null}

      <Group key="docs" title="Documents" meta={`${uploaded} of ${docs.length} uploaded`}>
        {docs.map((d, i) => {
          const busy = busyKind === d.kind;
          const state = d.status === "approved" ? "good" : d.status === "rejected" ? "bad" : d.uploaded ? "warn" : "neutral";
          return (
            <View key={d.kind}>
              {i > 0 ? <Divider inset={space.md + 38 + space.md} /> : null}
              {/* The state of each document is carried by the mark as well as
                  the words, so a rider sees at a glance which one is holding
                  them up without reading four lines of status text. */}
              <Row
                title={DOCUMENT_LABELS[d.kind]}
                subtitle={
                  d.status === "approved"
                    ? "Approved"
                    : d.status === "rejected"
                      ? (d.note ?? "Not accepted. Upload it again.")
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
                        ? "hourglass"
                        : "cloud-upload"
                }
                iconTone={state}
                onPress={busy ? undefined : () => choose(d.kind)}
                trailing={busy ? <ActivityIndicator color={c.accent} /> : <Chip label={d.uploaded ? "Replace" : "Upload"} tone="accent" />}
              />
            </View>
          );
        })}
      </Group>

      {error ? (
        <Banner key="error" tone="bad" icon="alert-circle">
          {error}
        </Banner>
      ) : null}

      <Txt key="privacy" v="caption" tone="muted">
        Only the Nova fleet office sees your documents. They are never shown to passengers.
      </Txt>
    </Screen>
  );
}

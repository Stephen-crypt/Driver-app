import { createElement, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { c } from "./theme";
import { buildMapHtml, mapState, type NovaMapProps } from "./mapHtml";

export type { LatLng, MapMarker, MarkerKind } from "./mapHtml";

/**
 * The web build of NovaMap: the same Leaflet page in an iframe instead of a
 * native WebView, driven the same way - loaded once, updated by message. It
 * exists for the browser preview and for a future web dashboard; the phones
 * never load it.
 */
export function NovaMap(props: NovaMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  const html = useMemo(() => buildMapHtml(props.center, props.zoom ?? 15), []); // eslint-disable-line react-hooks/exhaustive-deps
  const state = mapState(props);
  const latest = useRef(state);
  latest.current = state;

  const push = (s: string) => {
    const win = frame.current?.contentWindow as (Window & { nova?: { update: (x: unknown) => void } }) | null;
    win?.nova?.update(JSON.parse(s));
  };

  useEffect(() => {
    if (ready.current) push(state);
  }, [state]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !props.onPressMap) return;
      try {
        const p = JSON.parse(String(e.data)) as { lat: number; lng: number };
        if (typeof p.lat === "number") props.onPressMap(p);
      } catch {
        // Not a coordinate.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.onPressMap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.root, props.style]}>
      {createElement("iframe", {
        ref: frame,
        srcDoc: html.split("window.ReactNativeWebView").join("window.parent"),
        style: { border: 0, width: "100%", height: "100%" },
        onLoad: () => {
          ready.current = true;
          push(latest.current);
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.surface },
});

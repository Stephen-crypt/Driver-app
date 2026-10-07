import { useEffect, useMemo, useRef } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { c } from "./theme";
import { buildMapHtml, mapState, type NovaMapProps, type LatLng } from "./mapHtml";

export type { LatLng, MapMarker, MarkerKind } from "./mapHtml";

/**
 * MapLibre on OpenStreetMap vector tiles in a WebView: no API key, real Kigali
 * streets, in Nova's colours (see mapHtml.ts and @nova/ui mapStyle).
 *
 * The page is loaded ONCE. Markers, the route and the camera move by messages
 * into the running page, never by rebuilding it. The version this replaces
 * rebuilt the whole document on every marker change, so a moving rider made
 * the map flash white and refetch every tile once a second.
 */
export function NovaMap({
  center,
  markers = [],
  route,
  routeIsRoad,
  fit,
  bottomInset = 0,
  topInset = 0,
  zoom = 15,
  onPressMap,
  style,
}: NovaMapProps) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);

  // Fixed for the life of the component: the initial view only.
  const html = useMemo(() => buildMapHtml(center, zoom), []); // eslint-disable-line react-hooks/exhaustive-deps

  const state = mapState({ center, markers, route, routeIsRoad, fit, bottomInset, topInset });
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!ready.current) return;
    web.current?.injectJavaScript(`window.nova && window.nova.update(${state}); true;`);
  }, [state]);

  return (
    <View style={[styles.root, style]}>
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        scrollEnabled={false}
        overScrollMode="never"
        // The page loads as about:blank; any http address is a link in the map's
        // credit, which belongs in the browser, not over the map.
        onShouldStartLoadWithRequest={(r) => {
          if (!r.url.startsWith("http")) return true;
          void Linking.openURL(r.url);
          return false;
        }}
        onOpenWindow={(e) => void Linking.openURL(e.nativeEvent.targetUrl)}
        onLoadEnd={() => {
          ready.current = true;
          web.current?.injectJavaScript(`window.nova && window.nova.update(${latest.current}); true;`);
        }}
        onMessage={(e) => {
          if (!onPressMap) return;
          try {
            const p = JSON.parse(e.nativeEvent.data) as LatLng;
            if (typeof p.lat === "number" && typeof p.lng === "number") onPressMap(p);
          } catch {
            // A message that is not a coordinate is not ours to act on.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.surface },
  web: { flex: 1, backgroundColor: c.surface },
});

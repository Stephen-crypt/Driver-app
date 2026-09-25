import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { theme } from "@gera/ui";

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface MapMarker {
  readonly id: string;
  readonly at: LatLng;
  readonly label: string;
  readonly kind: "pickup" | "dropoff" | "rider";
}

interface Props {
  readonly center: LatLng;
  readonly markers?: readonly MapMarker[];
  readonly onPressMap?: (at: LatLng) => void;
}

const PIN_COLOUR: Record<MapMarker["kind"], string> = {
  pickup: theme.origin,
  dropoff: theme.destination,
  rider: theme.accent,
};

/**
 * Spec 3.7 picks Google Maps for Rwandan road coverage, which needs an API key
 * this project does not have yet - and an unkeyed react-native-maps renders a
 * blank grey rectangle on Android, so the passenger would see nothing at all.
 * Leaflet on OpenStreetMap needs no key and draws real Kigali streets.
 * Everything Google would change lives behind this component's props, so the
 * swap later is one file, the same deferral as PaymentProvider and EtaProvider.
 */
function buildHtml(center: LatLng, markers: readonly MapMarker[]): string {
  const pins = markers
    .map(
      (m) => `L.circleMarker([${m.at.lat}, ${m.at.lng}], {
        radius: 9, weight: 3, color: '#fff',
        fillColor: '${PIN_COLOUR[m.kind]}', fillOpacity: 1
      }).addTo(map).bindTooltip(${JSON.stringify(m.label)});`,
    )
    .join("\n");

  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#m{height:100%;margin:0;background:${theme.surface}}
  /* Carto's dark basemap started returning an "API KEY REQUIRED" watermark on
     every tile, so the map is plain OpenStreetMap - which needs no key and is
     not going to start needing one - inverted to dark in the browser instead.
     hue-rotate puts the colours back the right way round after the invert, so
     water reads blue rather than orange. */
  .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.75)}
  .leaflet-container{background:${theme.surface}}
</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('m', {zoomControl:false, attributionControl:false})
              .setView([${center.lat}, ${center.lng}], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);
  // Markers live in the overlay pane, which the filter does not touch, so the
  // pins keep their real colours over the inverted tiles.
  ${pins}
  map.on('click', function(e){
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({lat:e.latlng.lat, lng:e.latlng.lng}));
    }
  });
</script></body></html>`;
}

export function TripMap({ center, markers = [], onPressMap }: Props) {
  // Callers pass an inline array, so depending on `markers` itself would change
  // identity every render, rebuild the document, and reload every tile. Depend
  // on its contents instead.
  const markerKey = markers
    .map((m) => `${m.id}:${m.at.lat}:${m.at.lng}:${m.kind}:${m.label}`)
    .join("|");

  const source = useMemo(
    () => ({ html: buildHtml(center, markers) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center.lat, center.lng, markerKey],
  );

  return (
    <View style={styles.root}>
      <WebView
        originWhitelist={["*"]}
        source={source}
        style={styles.web}
        onMessage={(e) => {
          if (!onPressMap) return;
          try {
            const p = JSON.parse(e.nativeEvent.data) as LatLng;
            if (typeof p.lat === "number" && typeof p.lng === "number") onPressMap(p);
          } catch {
            // A message we cannot parse is not worth crashing the map over.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surface,
  },
  web: { flex: 1, backgroundColor: theme.surface },
});

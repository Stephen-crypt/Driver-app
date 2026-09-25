import type { StyleProp, ViewStyle } from "react-native";
import { c } from "./theme";

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export type MarkerKind = "me" | "pickup" | "dropoff" | "rider";

export interface MapMarker {
  readonly id: string;
  readonly at: LatLng;
  readonly kind: MarkerKind;
  /** Short text on the marker's tag - a vest number, "Pickup". */
  readonly tag?: string;
}

export interface GeraMapProps {
  readonly center: LatLng;
  readonly markers?: readonly MapMarker[];
  /** Draws a line from the first point to the last. */
  readonly route?: readonly LatLng[];
  /** Zoom and pan so every marker is on screen, leaving room for the sheet. */
  readonly fit?: boolean;
  /** Pixels of the map covered by UI at the bottom, so fitting avoids them. */
  readonly bottomInset?: number;
  readonly topInset?: number;
  readonly zoom?: number;
  readonly onPressMap?: (at: LatLng) => void;
  readonly style?: StyleProp<ViewStyle>;
}


/** Everything the page needs on each update, serialised once. */
export function mapState(p: GeraMapProps): string {
  return JSON.stringify({
    markers: p.markers ?? [],
    route: p.route ?? null,
    fit: !!p.fit,
    center: p.center,
    pad: { top: (p.topInset ?? 0) + 24, bottom: (p.bottomInset ?? 0) + 24 },
  });
}

export function buildMapHtml(center: LatLng, zoom: number): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#m{height:100%;margin:0;background:${c.surface}}
  .leaflet-container{background:${c.surface};font-family:-apple-system,Roboto,sans-serif}
  /* Raw OSM is loud - every road class and park gets its own colour. Muted, the
     map reads as geography and the route and pins are the only saturated
     things on screen. */
  .leaflet-tile-pane{filter:saturate(.35) brightness(1.04) contrast(.9)}
  .g{position:relative}
  .me{width:18px;height:18px;border-radius:50%;background:${c.accent};border:3px solid #fff;
      box-shadow:0 0 0 8px rgba(0,87,231,.18),0 2px 6px rgba(0,0,0,.25)}
  .pin{width:16px;height:16px;border-radius:50%;border:4px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}
  .pickup{background:${c.textStrong}}
  .dropoff{background:${c.destination};border-radius:4px}
  .rider{width:34px;height:40px;border-radius:9px;background:${c.accentDeep};color:#fff;
         display:flex;align-items:center;justify-content:center;border:2px solid #fff;
         font:700 20px/1 'Barlow Condensed','Roboto Condensed',sans-serif;
         box-shadow:0 3px 10px rgba(0,0,0,.3)}
  .tag{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;
       background:#fff;color:${c.textStrong};font:600 12px/1 -apple-system,Roboto,sans-serif;
       padding:5px 8px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('m', {zoomControl:false, attributionControl:false})
             .setView([${center.lat}, ${center.lng}], ${zoom});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);
  var markers = {}, line = null, fitted = '', lastCentre = null;

  function icon(m){
    var inner = m.kind === 'me' ? '<div class="me"></div>'
      : m.kind === 'rider' ? '<div class="rider">' + (m.tag || '') + '</div>'
      : '<div class="pin ' + m.kind + '"></div>';
    var tag = (m.kind === 'pickup' || m.kind === 'dropoff') && m.tag ? '<div class="tag">' + m.tag + '</div>' : '';
    var size = m.kind === 'rider' ? [34,40] : m.kind === 'me' ? [18,18] : [16,16];
    return L.divIcon({className:'', html:'<div class="g">' + inner + tag + '</div>',
                      iconSize:size, iconAnchor:[size[0]/2, size[1]/2]});
  }

  window.gera = {
    update: function(s){
      var seen = {};
      (s.markers || []).forEach(function(m){
        seen[m.id] = true;
        var ll = [m.at.lat, m.at.lng];
        var key = m.kind + '|' + (m.tag || '');
        if (markers[m.id] && markers[m.id].key === key) {
          markers[m.id].marker.setLatLng(ll);
        } else {
          if (markers[m.id]) map.removeLayer(markers[m.id].marker);
          markers[m.id] = {key:key, marker:L.marker(ll, {icon:icon(m), interactive:false}).addTo(map)};
        }
      });
      Object.keys(markers).forEach(function(id){
        if (!seen[id]) { map.removeLayer(markers[id].marker); delete markers[id]; }
      });

      if (line) { map.removeLayer(line); line = null; }
      if (s.route && s.route.length > 1) {
        line = L.polyline(s.route.map(function(p){return [p.lat,p.lng];}),
          {color:'${c.accent}', weight:5, opacity:.9, dashArray:'1 10', lineCap:'round'}).addTo(map);
      }

      var pts = (s.markers || []).map(function(m){return [m.at.lat, m.at.lng];});
      // Refit only when the set of things on the map changes, not every time
      // the rider moves a metre - a camera that keeps jumping is unreadable.
      var sig = (s.markers || []).map(function(m){return m.id;}).join(',') + '|' + s.pad.bottom;
      if (s.fit && pts.length > 1 && sig !== fitted) {
        fitted = sig;
        map.fitBounds(L.latLngBounds(pts), {paddingTopLeft:[40, s.pad.top], paddingBottomRight:[40, s.pad.bottom], maxZoom:16});
      } else if (!s.fit && s.center) {
        // Follow the rider, but only when they have actually moved: re-centring
        // on every GPS jitter makes the map impossible to look around.
        var moved = !lastCentre || map.distance(lastCentre, [s.center.lat, s.center.lng]) > 25;
        if (sig !== fitted || moved) {
          fitted = sig;
          lastCentre = [s.center.lat, s.center.lng];
          map.setView(lastCentre, map.getZoom(), {animate: false});
          // Centre in the part of the map that is actually visible: the sheet
          // covers the bottom, so the true middle sits behind it.
          map.panBy([0, (s.pad.bottom - s.pad.top) / 2], {animate: false});
        }
      }
    }
  };

  map.on('click', function(e){
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat, lng:e.latlng.lng}));
    }
  });
</script></body></html>`;
}


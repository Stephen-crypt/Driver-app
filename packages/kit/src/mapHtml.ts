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

export interface NovaMapProps {
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
export function mapState(p: NovaMapProps): string {
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
  /* The map uses the same two marks as the route rail everywhere else: a ring
     where you are, a square where you are going. */
  .me{position:relative;width:18px;height:18px;border-radius:50%;background:${c.accent};border:3px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.25)}
  .me:after{content:'';position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
      background:rgba(10,35,66,.3);animation:halo 2.2s cubic-bezier(.23,1,.32,1) infinite}
  @keyframes halo{from{transform:scale(1);opacity:.9}to{transform:scale(3.4);opacity:0}}
  @media (prefers-reduced-motion: reduce){.me:after{animation:none;opacity:.25;transform:scale(2)}}
  .pin{width:18px;height:18px;box-shadow:0 2px 6px rgba(0,0,0,.28)}
  .pickup{border-radius:50%;background:#fff;border:5px solid ${c.textStrong};box-sizing:border-box}
  .dropoff{border-radius:5px;background:${c.destination};border:3px solid #fff;box-sizing:border-box}
  .rider{position:relative;width:100%;height:38px;padding:0 5px;border-radius:9px;background:${c.highlight};color:${c.onHighlight};
         display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-sizing:border-box;
         font:800 19px/1 Montserrat,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;
         box-shadow:0 3px 10px rgba(0,0,0,.3);overflow:hidden}
  .rider:before{content:'';position:absolute;left:0;right:0;top:56%;height:14%;background:rgba(255,255,255,.38)}
  .rider span{position:relative}
  .g{animation:drop .32s cubic-bezier(.23,1,.32,1) both}
  @keyframes drop{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
  @media (prefers-reduced-motion: reduce){.g{animation:none}}
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
      : m.kind === 'rider' ? '<div class="rider"><span>' + (m.tag || '') + '</span></div>'
      : '<div class="pin ' + m.kind + '"></div>';
    var tag = (m.kind === 'pickup' || m.kind === 'dropoff') && m.tag ? '<div class="tag">' + m.tag + '</div>' : '';
    // A vest number is one to four digits; the patch widens to fit it.
    var size = m.kind === 'rider' ? [Math.max(34, 14 + 14 * String(m.tag || '').length), 38] : [18,18];
    return L.divIcon({className:'', html:'<div class="g">' + inner + tag + '</div>',
                      iconSize:size, iconAnchor:[size[0]/2, size[1]/2]});
  }

  // A moving rider glides from one fix to the next over most of the gap
  // between updates, instead of jumping - the difference between a map that
  // looks live and one that looks like it is refreshing.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function glide(entry, to){
    var from = entry.marker.getLatLng();
    // Stop a glide still running first, or it would carry on after a jump and
    // pull the marker back towards where it was going.
    if (entry.raf) { cancelAnimationFrame(entry.raf); entry.raf = 0; }
    if (reduce || map.distance(from, to) < 1 || map.distance(from, to) > 800) { entry.marker.setLatLng(to); return; }
    var start = performance.now(), ms = 1600;
    function step(now){
      var t = Math.min(1, (now - start) / ms);
      var e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
      entry.marker.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]);
      if (t < 1) entry.raf = requestAnimationFrame(step);
    }
    entry.raf = requestAnimationFrame(step);
  }

  window.nova = {
    update: function(s){
      var seen = {};
      (s.markers || []).forEach(function(m){
        seen[m.id] = true;
        var ll = [m.at.lat, m.at.lng];
        var key = m.kind + '|' + (m.tag || '');
        if (markers[m.id] && markers[m.id].key === key) {
          glide(markers[m.id], ll);
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


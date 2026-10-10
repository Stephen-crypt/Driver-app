import type { StyleProp, ViewStyle } from "react-native";
import { MAP_STYLE_URL, mapTheme } from "@nova/ui";
import { c } from "./theme";
import { scheme } from "./appearance";

// The map in this run's scheme, and Nova's marks on it. At night the white
// edges and white pickup become night ones, and the route is mist.
const MT = mapTheme(scheme);
const night = scheme === "dark";
const ROUTE = { road: night ? c.accentDeep : c.accent, edge: night ? "#0A1220" : "#fff" };
const PICKUP = { fill: night ? c.accentDeep : "#fff", ring: night ? "#0A1220" : c.textStrong };
const ME_RING = night ? "#0A1220" : "#fff";

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** "radar" is the search in progress: yellow rings going out from the pickup. */
export type MarkerKind = "me" | "pickup" | "dropoff" | "rider" | "radar";

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
  /**
   * The way between two places. Two points draw a dotted guess from the first
   * to the last; more than two are the road itself and draw solid.
   */
  readonly route?: readonly LatLng[];
  /**
   * Draw the route solid whatever its length. A road that shortens behind a
   * moving rider is still a road when only its last two points are left.
   */
  readonly routeIsRoad?: boolean;
  /** Zoom and pan so every marker is on screen, leaving room for the sheet. */
  readonly fit?: boolean;
  /** Pixels of the map covered by UI at the bottom, so fitting avoids them. */
  readonly bottomInset?: number;
  readonly topInset?: number;
  /** Street-map zoom, where 15 shows a neighbourhood. */
  readonly zoom?: number;
  readonly onPressMap?: (at: LatLng) => void;
  /**
   * Choosing a place by moving the map: a pin stays in the middle of the part
   * of the map you can see, and the map slides under it. onPick hears where
   * the pin is each time the map comes to rest (and once on entering). The
   * camera starts at `center`.
   */
  readonly pick?: "pickup" | "dropoff" | null;
  readonly onPick?: (at: LatLng) => void;
  readonly style?: StyleProp<ViewStyle>;
}


/** Everything the page needs on each update, serialised once. */
export function mapState(p: NovaMapProps): string {
  return JSON.stringify({
    markers: p.markers ?? [],
    route: p.route ?? null,
    road: p.route ? p.routeIsRoad ?? p.route.length > 2 : false,
    fit: !!p.fit,
    center: p.center,
    pad: { top: (p.topInset ?? 0) + 24, bottom: (p.bottomInset ?? 0) + 24 },
    pick: p.pick ?? null,
  });
}

// Pinned to 5.x: 6.0 needs WebGL2 and loads its worker as a module from a URL,
// which a page with no origin and the cheaper Android phones may not manage.
const MAPLIBRE = "https://unpkg.com/maplibre-gl@5.24.0/dist";

export function buildMapHtml(center: LatLng, zoom: number): string {
  // MapLibre draws 512-pixel tiles, so its zoom runs one below the street-map
  // numbers the props use.
  const z = zoom - 1;
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css"/>
<style>
  html,body,#m{height:100%;margin:0;background:${MT.ground}}
  .maplibregl-map{font-family:-apple-system,Roboto,sans-serif}
  .maplibregl-ctrl-attrib{font-size:10px}
  .g{position:relative;width:100%;height:100%}
  /* The map uses the same two marks as the route rail everywhere else: a ring
     where you are, a square where you are going. */
  .me{position:relative;width:18px;height:18px;border-radius:50%;background:${c.accent};border:3px solid ${ME_RING};box-sizing:border-box;
      box-shadow:0 2px 6px rgba(0,0,0,.25)}
  .me:after{content:'';position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
      background:rgba(10,35,66,.3);animation:halo 2.2s cubic-bezier(.23,1,.32,1) infinite}
  @keyframes halo{from{transform:scale(1);opacity:.9}to{transform:scale(3.4);opacity:0}}
  @media (prefers-reduced-motion: reduce){.me:after{animation:none;opacity:.25;transform:scale(2)}}
  .pin{width:18px;height:18px;box-shadow:0 2px 6px rgba(0,0,0,.28)}
  .pickup{border-radius:50%;background:${PICKUP.fill};border:5px solid ${PICKUP.ring};box-sizing:border-box}
  .drop{position:relative;width:30px;height:40px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}
  .drop svg{display:block}
  /* Choosing a place: the pin stands in the middle of what you can see, lifts
     while the map moves and drops when it stops. Its tip is the point. */
  #pick{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;display:none;z-index:5}
  #pick.show{display:block}
  #pick .p{position:absolute;left:-17px;top:-46px;width:34px;height:46px;transition:transform .18s cubic-bezier(.23,1,.32,1);
           filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))}
  #pick.lift .p{transform:translateY(-12px)}
  #pick .s{position:absolute;left:-6px;top:-3px;width:12px;height:6px;border-radius:50%;background:rgba(10,35,66,.35);
           transition:transform .18s cubic-bezier(.23,1,.32,1)}
  #pick.lift .s{transform:scale(.6)}
  @media (prefers-reduced-motion: reduce){#pick .p,#pick .s{transition:none}}
  .rider{position:relative;width:100%;height:38px;padding:0 5px;border-radius:9px;background:${c.highlight};color:${c.onHighlight};
         display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-sizing:border-box;
         font:800 19px/1 Montserrat,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;
         box-shadow:0 3px 10px rgba(0,0,0,.3);overflow:hidden}
  .rider:before{content:'';position:absolute;left:0;right:0;top:56%;height:14%;background:rgba(255,255,255,.38)}
  .rider span{position:relative}
  /* Looking for a rider: a sweep and rings going out from the pickup, in the
     yellow - the light going out to find someone. */
  .radar{position:relative;width:240px;height:240px;pointer-events:none}
  .radar i{position:absolute;left:0;top:0;width:240px;height:240px;border-radius:50%;box-sizing:border-box;
           background:rgba(244,194,13,.14);border:2px solid rgba(244,194,13,.75);opacity:0;
           animation:ring 2.7s cubic-bezier(.23,1,.32,1) infinite}
  .radar i:nth-child(2){animation-delay:.9s}
  .radar i:nth-child(3){animation-delay:1.8s}
  .radar s{position:absolute;left:30px;top:30px;width:180px;height:180px;border-radius:50%;
           background:conic-gradient(from 0deg, rgba(244,194,13,.42), rgba(244,194,13,0) 28%, rgba(244,194,13,0));
           animation:sweep 2.4s linear infinite}
  .radar b{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
           background:${c.highlight};border:4px solid ${c.accent};box-sizing:border-box;box-shadow:0 2px 8px rgba(10,35,66,.35)}
  @keyframes ring{from{transform:scale(.08);opacity:1}to{transform:scale(1);opacity:0}}
  @keyframes sweep{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion: reduce){.radar i,.radar s{animation:none}.radar i:first-child{opacity:.5;transform:scale(.55)}}
  .g{animation:drop .32s cubic-bezier(.23,1,.32,1) both}
  @keyframes drop{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
  @media (prefers-reduced-motion: reduce){.g{animation:none}}
  .tag{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;
       background:${c.surfaceRaised};color:${c.textStrong};font:600 12px/1 -apple-system,Roboto,sans-serif;
       padding:5px 8px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
</style>
</head><body><div id="m"></div><div id="pick"><i class="s"></i><div class="p"></div></div>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script>
  var PAINT = ${JSON.stringify(MT.paint)};
  var LAYOUT = ${JSON.stringify(MT.layout)};
  var EDGES = ${JSON.stringify(MT.casings)};
  var PLACES_BEFORE = '${MT.placesBefore}';
  var PIN_SVG = '<svg width="__W__" height="__H__" viewBox="0 0 30 40"><path d="M15 39C15 39 28 24.8 28 15A13 13 0 0 0 2 15C2 24.8 15 39 15 39Z" fill="__F__" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';
  function pinSvg(fill, w, h){ return PIN_SVG.replace('__F__', fill).replace('__W__', w).replace('__H__', h); }
  var PICK_FILL = {pickup:'${c.accent}', dropoff:'${c.destination}'};
  var PLACES = ${JSON.stringify(MT.places)};
  var map = null, ready = false, pending = null;
  var markers = {}, fitted = '', fittedSpan = 0, lastCentre = null, touchedAt = 0, picking = null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The same spec as brandMapStyle in @nova/ui, which the dashboard uses:
  // colours and sizes by layer, an edge under side streets, named places.
  function brand(s){
    var out = [];
    s.layers.forEach(function(l){
      EDGES.forEach(function(e){
        if (e.of === l.id) {
          var edge = JSON.parse(JSON.stringify(l));
          edge.id = e.id;
          edge.paint = {'line-color': e.color, 'line-width': e.width, 'line-gap-width': (l.paint && l.paint['line-width']) || 1};
          out.push(edge);
        }
      });
      if (PAINT[l.id] || LAYOUT[l.id]) {
        out.push(Object.assign({}, l, {
          paint: Object.assign({}, l.paint, PAINT[l.id]),
          layout: Object.assign({}, l.layout, LAYOUT[l.id])
        }));
      } else out.push(l);
    });
    var at = out.map(function(l){return l.id;}).indexOf(PLACES_BEFORE);
    Array.prototype.splice.apply(out, [at < 0 ? out.length : at, 0].concat(PLACES));
    s.layers = out;
    return s;
  }

  function dist(a, b){
    var r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) * r / 2), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }

  function post(o){
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o));
  }

  function sendCentre(){
    var c = map.getCenter();
    post({kind:'center', lat:c.lat, lng:c.lng});
  }

  function create(style){
    map = new maplibregl.Map({container:'m', style:style, center:[${center.lng}, ${center.lat}], zoom:${z},
                              attributionControl:false, dragRotate:false, pitchWithRotate:false, touchPitch:false});
    map.touchZoomRotate.disableRotation();
    // The OSM credit, required on every map. Compact: it folds to an (i) the
    // first time the map moves, or after five seconds, as the OSMF's
    // attribution guideline allows.
    map.addControl(new maplibregl.AttributionControl({compact:true}), 'top-right');
    setTimeout(function(){
      var a = document.querySelector('.maplibregl-ctrl-attrib');
      if (a) a.classList.remove('maplibregl-compact-show');
    }, 5000);
    map.on('load', function(){
      map.addSource('route', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
      var round = {'line-cap':'round', 'line-join':'round'};
      // The road: solid midnight on a white edge, so it reads over any street.
      map.addLayer({id:'route-edge', type:'line', source:'route', filter:['==', ['get', 'road'], true], layout:round,
                    paint:{'line-color':'${ROUTE.edge}', 'line-width':9}});
      map.addLayer({id:'route-road', type:'line', source:'route', filter:['==', ['get', 'road'], true], layout:round,
                    paint:{'line-color':'${ROUTE.road}', 'line-width':5}});
      // No road yet: a dotted guess from one end to the other.
      map.addLayer({id:'route-guess', type:'line', source:'route', filter:['==', ['get', 'road'], false], layout:round,
                    paint:{'line-color':'${ROUTE.road}', 'line-width':5, 'line-opacity':.9, 'line-dasharray':[0.1, 2]}});
      ready = true;
      if (pending) apply(pending);
    });
    map.on('click', function(e){
      // Choosing a place: a tap moves the map so the pin lands where you tapped.
      if (picking) { map.easeTo({center: e.lngLat, duration: reduce ? 0 : 300}); return; }
      post({kind:'press', lat:e.lngLat.lat, lng:e.lngLat.lng});
    });
    map.on('movestart', function(){ if (picking) document.getElementById('pick').classList.add('lift'); });
    map.on('moveend', function(){
      if (!picking) return;
      document.getElementById('pick').classList.remove('lift');
      sendCentre();
    });
    // A camera move with a finger behind it is the passenger looking around;
    // the map leaves the camera to them for a while.
    map.on('movestart', function(e){ if (e.originalEvent) touchedAt = Date.now(); });
  }

  fetch('${MAP_STYLE_URL}')
    .then(function(r){ return r.json(); })
    .then(function(s){ create(brand(s)); })
    .catch(function(){ create('${MAP_STYLE_URL}'); });

  function element(m){
    var inner = m.kind === 'me' ? '<div class="me"></div>'
      : m.kind === 'rider' ? '<div class="rider"><span>' + (m.tag || '') + '</span></div>'
      : m.kind === 'radar' ? '<div class="radar"><s></s><i></i><i></i><i></i><b></b></div>'
      : m.kind === 'dropoff' ? '<div class="drop">' + pinSvg('${c.destination}', 30, 40) + '</div>'
      : '<div class="pin ' + m.kind + '"></div>';
    var tag = (m.kind === 'pickup' || m.kind === 'dropoff') && m.tag ? '<div class="tag">' + m.tag + '</div>' : '';
    // A vest number is one to four digits; the patch widens to fit it.
    var size = m.kind === 'rider' ? [Math.max(34, 14 + 14 * String(m.tag || '').length), 38]
      : m.kind === 'radar' ? [240,240] : m.kind === 'dropoff' ? [30,40] : [18,18];
    var el = document.createElement('div');
    el.style.width = size[0] + 'px';
    el.style.height = size[1] + 'px';
    // Taps go through to the map, and the radar sits under everything else.
    el.style.pointerEvents = 'none';
    el.style.zIndex = m.kind === 'radar' ? '0' : '1';
    el.innerHTML = '<div class="g">' + inner + tag + '</div>';
    return el;
  }

  // A moving rider glides from one fix to the next over most of the gap
  // between updates, instead of jumping - the difference between a map that
  // looks live and one that looks like it is refreshing.
  function glide(entry, to){
    var from = entry.marker.getLngLat();
    // Stop a glide still running first, or it would carry on after a jump and
    // pull the marker back towards where it was going.
    if (entry.raf) { cancelAnimationFrame(entry.raf); entry.raf = 0; }
    var d = dist(from, to);
    if (reduce || d < 1 || d > 800) { entry.marker.setLngLat([to.lng, to.lat]); return; }
    var start = performance.now(), ms = 1600;
    function step(now){
      var t = Math.min(1, (now - start) / ms);
      var e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
      entry.marker.setLngLat([from.lng + (to.lng - from.lng) * e, from.lat + (to.lat - from.lat) * e]);
      if (t < 1) entry.raf = requestAnimationFrame(step);
    }
    entry.raf = requestAnimationFrame(step);
  }

  function apply(s){
    var seen = {};
    (s.markers || []).forEach(function(m){
      seen[m.id] = true;
      var key = m.kind + '|' + (m.tag || '');
      if (markers[m.id] && markers[m.id].key === key) {
        glide(markers[m.id], m.at);
      } else {
        if (markers[m.id]) markers[m.id].marker.remove();
        markers[m.id] = {key:key, marker:new maplibregl.Marker({element:element(m), anchor: m.kind === 'dropoff' ? 'bottom' : 'center'}).setLngLat([m.at.lng, m.at.lat]).addTo(map)};
      }
    });
    Object.keys(markers).forEach(function(id){
      if (!seen[id]) { markers[id].marker.remove(); delete markers[id]; }
    });

    var line = s.route && s.route.length > 1 ? [{type:'Feature', properties:{road: s.road},
      geometry:{type:'LineString', coordinates:s.route.map(function(p){return [p.lng, p.lat];})}}] : [];
    map.getSource('route').setData({type:'FeatureCollection', features:line});

    // Keep the credit clear of whatever covers the top of the map.
    var corner = document.querySelector('.maplibregl-ctrl-top-right');
    if (corner) corner.style.top = Math.max(0, s.pad.top - 16) + 'px';

    // The road can bulge well outside its two ends, so it is framed too.
    // Choosing a place: the camera is the passenger's. Padding puts the
    // map's centre in the middle of the part not under the sheet, and the
    // pin stands there.
    var pickEl = document.getElementById('pick');
    if (s.pick) {
      map.setPadding({top: s.pad.top, bottom: s.pad.bottom, left: 0, right: 0});
      var h = map.getContainer().clientHeight;
      pickEl.style.top = (s.pad.top + Math.max(0, h - s.pad.top - s.pad.bottom) / 2) + 'px';
      if (picking !== s.pick) {
        pickEl.querySelector('.p').innerHTML = pinSvg(PICK_FILL[s.pick], 34, 46);
        pickEl.classList.add('show');
        var entering = !picking;
        picking = s.pick;
        if (entering) map.jumpTo({center: [s.center.lng, s.center.lat], zoom: Math.max(map.getZoom(), 15.5)});
        sendCentre();
      }
      return;
    }
    if (picking) {
      picking = null;
      pickEl.classList.remove('show');
      map.setPadding({top: 0, bottom: 0, left: 0, right: 0});
      fitted = '';
    }

    var pts = (s.markers || []).map(function(m){return [m.at.lng, m.at.lat];})
      .concat((s.route || []).map(function(p){return [p.lng, p.lat];}));
    // Refit only when the set of things on the map changes - a road arriving
    // counts, the road shortening behind the rider does not - not every time
    // the rider moves a metre: a camera that keeps jumping is unreadable.
    var sig = (s.markers || []).map(function(m){return m.id;}).join(',') + '|' + s.pad.bottom + '|' + (s.route ? (s.road ? 'road' : 'line') : '');
    if (s.fit && pts.length > 1) {
      var b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach(function(p){ b.extend(p); });
      var sw = b.getSouthWest(), ne = b.getNorthEast();
      var span = dist({lat:sw.lat, lng:sw.lng}, {lat:ne.lat, lng:ne.lng});
      // Also refit as a rider closes in - everything now fits in half the
      // frame - or when something has left the part of the map not under the
      // sheet. Never within ten seconds of the passenger moving it themselves.
      var h = map.getContainer().clientHeight, w = map.getContainer().clientWidth;
      // With the sheet pulled up there may be no room to frame anything; then
      // nothing counts as hidden, or every update would move the camera.
      var room = h - s.pad.top - s.pad.bottom > 80;
      var hidden = room && pts.some(function(p){
        var q = map.project(p);
        return q.x < 0 || q.x > w || q.y < s.pad.top - 24 || q.y > h - s.pad.bottom + 24;
      });
      var settled = Date.now() - touchedAt > 10000;
      if (sig !== fitted || (settled && (span < fittedSpan / 2 || hidden))) {
        fitted = sig;
        fittedSpan = span;
        map.fitBounds(b, {padding:{top:s.pad.top, bottom:s.pad.bottom, left:40, right:40}, maxZoom:15, duration: reduce ? 0 : 500});
      }
    } else if (!s.fit && s.center) {
      // Follow the rider, but only when they have actually moved: re-centring
      // on every GPS jitter makes the map impossible to look around.
      var moved = !lastCentre || dist(lastCentre, s.center) > 25;
      if (sig !== fitted || moved) {
        fitted = sig;
        lastCentre = s.center;
        map.jumpTo({center:[s.center.lng, s.center.lat]});
        // Centre in the part of the map that is actually visible: the sheet
        // covers the bottom, so the true middle sits behind it.
        map.panBy([0, (s.pad.bottom - s.pad.top) / 2], {duration:0});
      }
    }
  }

  window.nova = {
    // Updates can arrive before the tiles' style has loaded; the newest one
    // waits and is applied the moment the map is ready.
    update: function(s){ pending = s; if (ready) apply(s); }
  };
</script></body></html>`;
}

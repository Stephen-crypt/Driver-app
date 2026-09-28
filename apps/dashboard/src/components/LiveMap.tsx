import { useEffect, useRef } from "react";
import L from "leaflet";

export interface MapPoint {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly html: string;
  readonly size: [number, number];
  readonly title: string;
  readonly onClick?: () => void;
}

export interface MapLine {
  readonly id: string;
  readonly from: { lat: number; lng: number };
  readonly to: { lat: number; lng: number };
  readonly color: string;
}

export interface MapZone {
  readonly id: string;
  /** Outer ring as [lat, lng] corners. */
  readonly ring: readonly [number, number][];
  readonly color: string;
  readonly label: string;
  readonly muted?: boolean;
  readonly onClick?: () => void;
}

const KIGALI: [number, number] = [-1.9441, 30.0619];

/**
 * Leaflet on OpenStreetMap, the same muted tiles as the phones. The map is
 * created once; points and lines are reconciled by id on every update, so a
 * rider moving does not redraw the city.
 */
export function LiveMap({
  points,
  lines = [],
  focus,
  zones = [],
  draft = null,
  onMapClick,
}: {
  readonly points: readonly MapPoint[];
  readonly lines?: readonly MapLine[];
  readonly focus?: { lat: number; lng: number; key: string } | null;
  readonly zones?: readonly MapZone[];
  /** A shape being drawn, corner by corner. */
  readonly draft?: readonly [number, number][] | null;
  readonly onMapClick?: (lat: number, lng: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; html: string }>());
  const paths = useRef(new Map<string, L.Polyline>());
  const fitted = useRef(false);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, { zoomControl: false, attributionControl: true }).setView(KIGALI, 13);
    // Bottom right: the top left belongs to the legend.
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
      className: "nova-tiles",
    }).addTo(m);
    zoneLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
      paths.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const existing = markers.current.get(p.id);
      if (existing && existing.html === p.html) {
        existing.marker.setLatLng([p.lat, p.lng]);
        continue;
      }
      existing?.marker.remove();
      const marker = L.marker([p.lat, p.lng], {
        // Sized by its content and centred on the point, so a four-digit vest
        // number widens the patch instead of spilling out of it.
        icon: L.divIcon({ className: "", html: `<div class="m-centre">${p.html}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
        title: p.title,
        keyboard: true,
      }).addTo(m);
      if (p.onClick) marker.on("click", p.onClick);
      markers.current.set(p.id, { marker, html: p.html });
    }
    for (const [id, v] of markers.current) {
      if (!seen.has(id)) {
        v.marker.remove();
        markers.current.delete(id);
      }
    }

    const seenLines = new Set<string>();
    for (const l of lines) {
      seenLines.add(l.id);
      const ll: L.LatLngExpression[] = [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]];
      const existing = paths.current.get(l.id);
      if (existing) existing.setLatLngs(ll);
      else paths.current.set(l.id, L.polyline(ll, { color: l.color, weight: 3, opacity: 0.7, dashArray: "2 8" }).addTo(m));
    }
    for (const [id, pl] of paths.current) {
      if (!seenLines.has(id)) {
        pl.remove();
        paths.current.delete(id);
      }
    }

    // Frame everything once, on first data; after that the operator owns the
    // camera - a map that re-zooms every five seconds cannot be read.
    if (!fitted.current && points.length > 0) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [60, 60], maxZoom: 15 });
    }
  }, [points, lines]);

  // Zones sit under everything, drawn faintly: they are context, not news.
  useEffect(() => {
    const g = zoneLayer.current;
    if (!g) return;
    g.clearLayers();
    for (const z of zones) {
      const poly = L.polygon(z.ring as [number, number][], {
        color: z.color,
        weight: 2,
        opacity: z.muted ? 0.35 : 0.9,
        fillOpacity: z.muted ? 0.03 : 0.1,
        dashArray: z.muted ? "4 6" : undefined,
        bubblingMouseEvents: false,
      }).bindTooltip(z.label, { sticky: true });
      if (z.onClick) poly.on("click", z.onClick);
      poly.addTo(g);
    }
  }, [zones]);

  useEffect(() => {
    const g = draftLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!draft || draft.length === 0) return;
    const pts = draft as [number, number][];
    (pts.length >= 3 ? L.polygon(pts, { color: "#0057e7", weight: 2, dashArray: "6 4", fillOpacity: 0.12 }) : L.polyline(pts, { color: "#0057e7", weight: 2, dashArray: "6 4" })).addTo(g);
    for (const p of pts) L.circleMarker(p, { radius: 5, color: "#0057e7", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(g);
  }, [draft]);

  useEffect(() => {
    if (focus && map.current) map.current.setView([focus.lat, focus.lng], 16, { animate: true });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}

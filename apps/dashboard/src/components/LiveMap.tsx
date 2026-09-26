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
}: {
  readonly points: readonly MapPoint[];
  readonly lines?: readonly MapLine[];
  readonly focus?: { lat: number; lng: number; key: string } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; html: string }>());
  const paths = useRef(new Map<string, L.Polyline>());
  const fitted = useRef(false);

  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, { zoomControl: false, attributionControl: true }).setView(KIGALI, 13);
    // Bottom right: the top left belongs to the legend.
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
      className: "gera-tiles",
    }).addTo(m);
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

  useEffect(() => {
    if (focus && map.current) map.current.setView([focus.lat, focus.lng], 16, { animate: true });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}

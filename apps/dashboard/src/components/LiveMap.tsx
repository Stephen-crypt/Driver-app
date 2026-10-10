import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { brandMapStyle, MAP_STYLE_URL, type MapStyleSpec } from "@nova/ui";
import { useScheme, type Scheme } from "../lib/appearance";

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

const KIGALI: [number, number] = [30.0619, -1.9441];
const MIDNIGHT = "#0a2342";
/** The working colour now drawn: midnight by day, mist at night. */
const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || MIDNIGHT;
/** Midnight lines and zones vanish on the night map; they take the accent instead. */
const ink = (colour: string, scheme: Scheme) => (scheme === "dark" && colour.toLowerCase() === MIDNIGHT ? accentNow() : colour);
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** The brand style in each look, fetched once for every map on the page. */
const styleOnce: Partial<Record<Scheme, Promise<StyleSpecification | string>>> = {};
function brandStyle(scheme: Scheme): Promise<StyleSpecification | string> {
  styleOnce[scheme] ??= fetch(MAP_STYLE_URL)
    .then((r) => r.json() as Promise<MapStyleSpec>)
    .then((s) => brandMapStyle(s, scheme) as unknown as StyleSpecification)
    // Unbranded beats no map.
    .catch(() => MAP_STYLE_URL);
  return styleOnce[scheme]!;
}

const closed = (ring: readonly [number, number][]): [number, number][] => {
  const pts = ring.map(([lat, lng]) => [lng, lat] as [number, number]);
  return pts.length > 0 ? [...pts, pts[0]!] : pts;
};

/**
 * MapLibre on OpenStreetMap vector tiles, in the same colours as the phones
 * (@nova/ui mapStyle). The map is created once; points and lines are
 * reconciled by id on every update, so a rider moving does not redraw the city.
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
  const map = useRef<maplibregl.Map | null>(null);
  const scheme = useScheme();
  // Where the operator was looking, so a change of look rebuilds the map in place.
  const camera = useRef<{ center: maplibregl.LngLatLike; zoom: number } | null>(null);
  // Sources and layers can only be added once the style is in; until then the
  // effects below wait on this.
  const [loaded, setLoaded] = useState(false);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; html: string }>());
  const fitted = useRef(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    let gone = false;
    void brandStyle(scheme).then((style) => {
      if (gone || !host.current) return;
      const accent = accentNow();
      const m = new maplibregl.Map({
        container: host.current,
        style,
        center: camera.current?.center ?? KIGALI,
        zoom: camera.current?.zoom ?? 12,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      m.touchZoomRotate.disableRotation();
      // Bottom right: the top left belongs to the legend. The credit is the
      // OSM licence's, and stays on.
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

      m.on("load", () => {
        // Zones sit under everything, drawn faintly: they are context, not news.
        m.addSource("zones", { type: "geojson", data: EMPTY });
        m.addLayer({
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "muted"], true], 0.03, 0.1] },
        });
        m.addLayer({
          id: "zones-edge",
          type: "line",
          source: "zones",
          filter: ["!=", ["get", "muted"], true],
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 },
        });
        m.addLayer({
          id: "zones-edge-muted",
          type: "line",
          source: "zones",
          filter: ["==", ["get", "muted"], true],
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.35, "line-dasharray": [2, 3] },
        });

        m.addSource("lines", { type: "geojson", data: EMPTY });
        m.addLayer({
          id: "lines",
          type: "line",
          source: "lines",
          layout: { "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.7, "line-dasharray": [0.7, 2.7] },
        });

        m.addSource("draft", { type: "geojson", data: EMPTY });
        m.addLayer({
          id: "draft-fill",
          type: "fill",
          source: "draft",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": accent, "fill-opacity": 0.12 },
        });
        m.addLayer({
          id: "draft-edge",
          type: "line",
          source: "draft",
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "line-color": accent, "line-width": 2, "line-dasharray": [3, 2] },
        });
        m.addLayer({
          id: "draft-corners",
          type: "circle",
          source: "draft",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": accent, "circle-stroke-width": 2 },
        });

        // A zone's name follows the pointer while it is over the zone.
        const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
        m.on("mousemove", "zones-fill", (e) => {
          const label = e.features?.[0]?.properties?.label;
          if (typeof label === "string") tip.setLngLat(e.lngLat).setText(label).addTo(m);
        });
        m.on("mouseleave", "zones-fill", () => tip.remove());
        setLoaded(true);
      });

      // Remembered only once the map has framed its first data, so an early
      // move as the map loads cannot stand in for that framing.
      m.on("moveend", () => {
        if (fitted.current) camera.current = { center: m.getCenter(), zoom: m.getZoom() };
      });

      m.on("click", (e) => {
        // A zone under the click takes it; drawing a new zone only gets clicks
        // that land outside the existing ones.
        const hit = m.getLayer("zones-fill") ? m.queryRenderedFeatures(e.point, { layers: ["zones-fill"] })[0] : undefined;
        const zone = hit ? zonesRef.current.find((z) => z.id === hit.properties?.id) : undefined;
        if (zone?.onClick) zone.onClick();
        else clickRef.current?.(e.lngLat.lat, e.lngLat.lng);
      });
      map.current = m;
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      setLoaded(false);
    };
  }, [scheme]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const existing = markers.current.get(p.id);
      if (existing && existing.html === p.html) {
        existing.marker.setLngLat([p.lng, p.lat]);
        continue;
      }
      existing?.marker.remove();
      // Sized by its content and centred on the point, so a four-digit vest
      // number widens the patch instead of spilling out of it.
      const el = document.createElement("div");
      el.innerHTML = `<div class="m-centre">${p.html}</div>`;
      el.title = p.title;
      if (p.onClick) {
        const go = p.onClick;
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          go();
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") go();
        });
      }
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(m);
      markers.current.set(p.id, { marker, html: p.html });
    }
    for (const [id, v] of markers.current) {
      if (!seen.has(id)) {
        v.marker.remove();
        markers.current.delete(id);
      }
    }

    (m.getSource("lines") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lines.map((l) => ({
        type: "Feature",
        properties: { id: l.id, color: ink(l.color, scheme) },
        geometry: { type: "LineString", coordinates: [[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]] },
      })),
    });

    // Frame everything once, on first data; after that the operator owns the
    // camera - a map that re-zooms every five seconds cannot be read.
    if (!fitted.current && points.length > 0) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds([points[0]!.lng, points[0]!.lat], [points[0]!.lng, points[0]!.lat]);
      for (const p of points) b.extend([p.lng, p.lat]);
      m.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
    }
  }, [points, lines, loaded, scheme]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("zones") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature",
        properties: { id: z.id, color: ink(z.color, scheme), label: z.label, muted: !!z.muted },
        geometry: { type: "Polygon", coordinates: [closed(z.ring)] },
      })),
    });
  }, [zones, loaded, scheme]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const pts = draft ?? [];
    const corners: Feature[] = pts.map(([lat, lng]) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    }));
    const shape: Feature[] =
      pts.length >= 3
        ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [closed(pts)] } }]
        : pts.length === 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map(([lat, lng]) => [lng, lat]) } }]
          : [];
    (m.getSource("draft") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [...shape, ...corners] });
  }, [draft, loaded]);

  useEffect(() => {
    if (focus && map.current) map.current.flyTo({ center: [focus.lng, focus.lat], zoom: 15 });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}

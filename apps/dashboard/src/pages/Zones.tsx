import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveMap, type MapZone } from "../components/LiveMap";
import { ZonePlacePicker } from "../components/ZonePlacePicker";
import { Flash, useUi } from "../components/ui";
import { can, kigaliDateTime, rpc, type Staff } from "../lib/supabase";
import { metres, placeShape, roadStrip, ROAD_WIDTH, SIZE, suggestName, type FoundPlace, type LatLng, type SizeRange } from "../lib/zonePlaces";

type Kind = "service" | "operating" | "restricted" | "parking" | "pickup";

interface Zone {
  id: string;
  name: string;
  kind: Kind;
  area: { type: "Polygon"; coordinates: [number, number][][] };
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  active: boolean;
  area_km2: number;
  updated_at: string;
}

// What each kind is for, and which crossing is worth an alert by default.
const KINDS: Record<Kind, { label: string; help: string; color: string; enter: boolean; exit: boolean }> = {
  restricted: { label: "Restricted", help: "Riders should not go in: road works, closed roads, secure sites.", color: "#c42419", enter: true, exit: false },
  service: { label: "Service area", help: "Where Nova operates. Leaving it is worth knowing about.", color: "#0a2342", enter: false, exit: true },
  operating: { label: "Operating", help: "A smaller area a team or shift works in.", color: "#1d4ed8", enter: false, exit: true },
  parking: { label: "Parking", help: "Where riders wait between trips.", color: "#5e6676", enter: false, exit: false },
  pickup: { label: "Pickup", help: "A marked pickup point: a mall, the airport, a bus park.", color: "#0e7c4a", enter: false, exit: false },
};

/** The three ways to make a zone's shape. */
type Way = "place" | "road" | "hand";
const WAYS: readonly { way: Way; label: string }[] = [
  { way: "place", label: "Pick a place" },
  { way: "road", label: "Close a road" },
  { way: "hand", label: "Draw by hand" },
];

interface Draft {
  readonly id: string | null;
  readonly name: string;
  /** Staff typed the name, so a new shape no longer renames the zone. */
  readonly nameTouched: boolean;
  readonly kind: Kind;
  readonly enter: boolean;
  readonly exit: boolean;
  readonly active: boolean;
  /** The shape to save, as [lat, lng] corners; null keeps an existing zone's shape. */
  readonly corners: LatLng[] | null;
  readonly way: Way;
  /** Pick a place: the place, and its margin or circle size in metres (null for a border). */
  readonly place: FoundPlace | null;
  readonly size: number | null;
  /** Close a road: the clicks, snapped onto their roads, and the strip's width in metres. */
  readonly clicks: LatLng[];
  readonly width: number;
}

const ringOf = (z: Zone): [number, number][] => z.area.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [lat, lng]);

/** A shape not started yet, whichever way. */
const BLANK = { corners: [] as LatLng[], place: null, size: null, clicks: [] as LatLng[] };

/** Fill in the name from the shape, unless staff have typed their own. */
const named = (d: Draft, name: string | null): Draft => (d.nameTouched || !name ? d : { ...d, name: name.slice(0, 60) });

export function Zones({ staff }: { staff: Staff }) {
  const { confirm } = useUi();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Why the last road click was not added, said on the map and in the form.
  const [roadNote, setRoadNote] = useState<string | null>(null);
  // A road strip is being worked out; clicks wait for it.
  const [busy, setBusy] = useState(false);
  // Where the map looks: set once per picked place, so moving a slider keeps the view.
  const [frame, setFrame] = useState<{ key: string; ring: LatLng[] } | null>(null);
  const editor = can(staff.role, "operations", "safety");

  const load = useCallback(() => {
    rpc<Zone[]>("staff_zones").then(setZones).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const startNew = () => {
    setDone(null);
    setError(null);
    setRoadNote(null);
    setDraft({ id: null, name: "", nameTouched: false, kind: "restricted", enter: true, exit: false, active: true, way: "place", width: ROAD_WIDTH.start, ...BLANK });
    setDrawing(true);
  };

  const edit = (z: Zone) => {
    setDone(null);
    setError(null);
    setRoadNote(null);
    setDrawing(false);
    setDraft({
      id: z.id, name: z.name, nameTouched: true, kind: z.kind, enter: z.alert_on_enter, exit: z.alert_on_exit, active: z.active,
      way: "place", width: ROAD_WIDTH.start, ...BLANK, corners: null,
    });
  };

  const redraw = () => {
    setRoadNote(null);
    setDraft((d) => (d ? { ...d, way: "place", ...BLANK } : d));
    setDrawing(true);
  };

  const cancel = () => {
    setDraft(null);
    setDrawing(false);
    setRoadNote(null);
  };

  const switchWay = async (way: Way) => {
    if (!draft || way === draft.way) return;
    const made = (draft.corners?.length ?? 0) > 0 || draft.clicks.length > 0;
    const label = WAYS.find((w) => w.way === way)!.label;
    if (made && !(await confirm({ title: `Start again with “${label}”?`, body: "The shape you have will be cleared.", confirmLabel: "Start again" }))) return;
    setRoadNote(null);
    setDraft((d) => (d ? { ...d, way, ...BLANK } : d));
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      await rpc("staff_save_zone", {
        p_id: draft.id,
        p_name: draft.name,
        p_kind: draft.kind,
        p_points: draft.corners ? draft.corners.map(([lat, lng]) => [lng, lat]) : null,
        p_alert_on_enter: draft.enter,
        p_alert_on_exit: draft.exit,
        p_active: draft.active,
      });
      setDone(`${draft.name} ${draft.id ? "saved" : "added"}.`);
      cancel();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  // ---- Pick a place ----------------------------------------------------------
  const pick = (p: FoundPlace) => setDraft((d) => (d ? named({ ...d, place: p, size: SIZE[p.kind]?.start ?? null, corners: [] }, p.name) : d));

  const placeRef = draft?.way === "place" ? (draft.place?.ref ?? null) : null;
  const placeSize = draft?.size ?? null;
  useEffect(() => {
    if (!placeRef) return;
    let live = true;
    const t = setTimeout(() => {
      placeShape(placeRef, placeSize)
        .then((corners) => {
          if (!live) return;
          // Only if this is still the place picked: a slow answer for the last one is dropped.
          setDraft((d) => (d && d.place?.ref === placeRef && d.size === placeSize ? { ...d, corners } : d));
          setFrame((f) => (f?.key === placeRef ? f : { key: placeRef, ring: corners }));
        })
        .catch((e: Error) => {
          if (live) setError(e.message);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [placeRef, placeSize]);

  // ---- Close a road -------------------------------------------------------------
  const strip = async (clicks: LatLng[], width: number) => {
    setRoadNote(null);
    if (clicks.length === 0) {
      setDraft((d) => (d ? { ...d, clicks: [], corners: [] } : d));
      return;
    }
    setBusy(true);
    try {
      const r = await roadStrip(clicks, width);
      setDraft((d) => (d ? named({ ...d, clicks: r.clicks, corners: r.corners }, r.corners.length > 0 ? r.name : null) : d));
    } catch (e) {
      setRoadNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const roadWidth = draft?.way === "road" ? draft.width : null;
  useEffect(() => {
    if (roadWidth === null || !draft || draft.clicks.length < 2) return;
    const t = setTimeout(() => void strip(draft.clicks, roadWidth), 250);
    return () => clearTimeout(t);
  }, [roadWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Draw by hand ---------------------------------------------------------------
  const addCorner = (lat: number, lng: number) => setDraft((d) => (d ? { ...d, corners: [...(d.corners ?? []), [lat, lng]] } : d));
  const moveCorner = (i: number, lat: number, lng: number) =>
    setDraft((d) => (d?.corners ? { ...d, corners: d.corners.map((c, j): LatLng => (j === i ? [lat, lng] : c)) } : d));

  // Each settled shape asks for a name, until staff type one.
  const handKey = draft?.way === "hand" && !draft.nameTouched && (draft.corners?.length ?? 0) >= 3 ? JSON.stringify(draft.corners) : null;
  useEffect(() => {
    if (!handKey) return;
    let live = true;
    const corners = JSON.parse(handKey) as LatLng[];
    const t = setTimeout(() => {
      suggestName(corners)
        .then((name) => {
          if (live) setDraft((d) => (d ? named(d, name) : d));
        })
        // A shape that crosses itself mid-drag has no name; saving says why.
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [handKey]);

  const mapZones: MapZone[] = useMemo(
    () =>
      (zones ?? [])
        // The zone being reshaped is drawn by the draft layer instead.
        .filter((z) => !(draft?.id === z.id && draft.corners))
        .map((z) => ({
          id: z.id,
          ring: ringOf(z),
          color: KINDS[z.kind].color,
          label: `${z.name}, ${KINDS[z.kind].label.toLowerCase()}${z.active ? "" : " (off)"}`,
          muted: !z.active || (draft !== null && draft.id !== z.id),
          onClick: drawing ? undefined : () => edit(z),
        })),
    [zones, draft, drawing],
  );

  const way = draft?.way ?? "place";
  const placed = draft?.corners?.length ?? 0;
  const clicks = draft?.clicks.length ?? 0;
  // What the zone still lacks, said next to the button so a grey button explains itself.
  const short = way === "hand" ? Math.max(0, 3 - placed) : way === "road" ? Math.max(0, 2 - clicks) : 0;
  const shapeMissing =
    !draft || draft.corners === null
      ? null
      : way === "place"
        ? placed === 0
          ? "a place"
          : null
        : short === 0
          ? null
          : way === "road"
            ? `${short} more ${short === 1 ? "click" : "clicks"} on the road`
            : `${short} more ${short === 1 ? "corner" : "corners"}`;
  const missing = draft ? [draft.name.trim().length < 2 ? "a name" : null, shapeMissing].filter((m): m is string => m !== null) : [];

  const onMapClick =
    !drawing || !draft
      ? undefined
      : draft.way === "hand"
        ? addCorner
        : draft.way === "road" && !busy
          ? (lat: number, lng: number) => void strip([...draft.clicks, [lat, lng]], draft.width)
          : undefined;
  const dots = !drawing || !draft ? [] : draft.way === "hand" ? (draft.corners ?? []) : draft.way === "road" ? draft.clicks : [];

  const active = (zones ?? []).filter((z) => z.active);
  const off = (zones ?? []).filter((z) => !z.active);

  return (
    <div className="control">
      <div className={`control-map${onMapClick ? " drawing" : ""}`}>
        <LiveMap
          points={[]}
          zones={mapZones}
          draft={draft?.corners ?? null}
          draftDots={dots}
          onCornerMove={drawing && draft?.way === "hand" ? moveCorner : undefined}
          onMapClick={onMapClick}
          frame={frame}
        />
        {drawing && way === "hand" ? (
          <div className="map-hint">
            <strong>Click the map to place each corner</strong>
            <span className="small muted">{placed} placed, at least 3 needed. Drag a corner to move it.</span>
          </div>
        ) : null}
        {drawing && way === "road" ? (
          <div className="map-hint">
            <strong>Click where the closure starts and where it ends</strong>
            {roadNote ? <span className="small hint-bad">{roadNote}</span> : <span className="small muted">Add a click at each junction.</span>}
          </div>
        ) : null}
      </div>

      <aside className="control-rail">
        <div className="row rail-head" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: "var(--num)", fontSize: 30 }}>Zones</h1>
            <p className="sub">Alerts when a rider on shift crosses an edge.</p>
          </div>
          {editor && !draft ? (
            <button className="btn" onClick={startNew}>
              New zone
            </button>
          ) : null}
        </div>

        {error ? <div className="notice bad">{error}</div> : null}
        <Flash message={done} onShown={() => setDone(null)} />

        {draft ? (
          <section className="card stack">
            <h2 style={{ margin: 0 }}>{draft.id ? "Edit zone" : "New zone"}</h2>

            {editor && drawing ? (
              <div className="tabs ways" role="tablist" aria-label="How to make the shape">
                {WAYS.map((w) => (
                  <button key={w.way} role="tab" aria-selected={draft.way === w.way} className={draft.way === w.way ? "on" : ""} onClick={() => void switchWay(w.way)}>
                    {w.label}
                  </button>
                ))}
              </div>
            ) : null}

            {editor && drawing && draft.way === "place" ? (
              <>
                <ZonePlacePicker picked={draft.place} onPick={pick} />
                {draft.place && SIZE[draft.place.kind] ? (
                  <SizeSlider range={SIZE[draft.place.kind]!} value={draft.size ?? SIZE[draft.place.kind]!.start} onChange={(v) => setDraft({ ...draft, size: v })} />
                ) : null}
              </>
            ) : null}

            {editor && drawing && draft.way === "road" ? (
              <>
                <div className="draw-hint" role="status">
                  <strong>{clicks === 0 ? "Click where the closure starts and where it ends." : `${clicks} ${clicks === 1 ? "click" : "clicks"} on the road.`}</strong>
                  <span>{roadNote ?? (clicks < 2 ? "Each click snaps onto the nearest road." : "Add a click at each junction, or add the zone.")}</span>
                </div>
                <SizeSlider range={{ label: "Width", ...ROAD_WIDTH }} value={draft.width} onChange={(v) => setDraft({ ...draft, width: v })} />
                <div className="row">
                  <button className="btn secondary small" disabled={clicks === 0 || busy} onClick={() => void strip(draft.clicks.slice(0, -1), draft.width)}>
                    Undo click
                  </button>
                </div>
              </>
            ) : null}

            {editor && drawing && draft.way === "hand" ? (
              <>
                <div className="draw-hint" role="status">
                  <strong>{placed === 0 ? "Click the map to place each corner." : `${placed} ${placed === 1 ? "corner" : "corners"} placed.`}</strong>
                  <span>{placed === 0 ? "At least 3 corners make a zone." : short > 0 ? `Click the map for ${short} more.` : "Click the map to add more, or add the zone."}</span>
                </div>
                <div className="row">
                  <button className="btn secondary small" disabled={placed === 0} onClick={() => setDraft({ ...draft, corners: draft.corners!.slice(0, -1) })}>
                    Undo corner
                  </button>
                </div>
              </>
            ) : null}

            <div className="field">
              <label htmlFor="zname">Name</label>
              <input
                id="zname"
                className="input"
                value={draft.name}
                disabled={!editor}
                placeholder="e.g. Nyabugogo road works"
                onChange={(e) => setDraft({ ...draft, name: e.target.value, nameTouched: true })}
              />
            </div>
            <div className="field">
              <label htmlFor="zkind">Kind</label>
              <select
                id="zkind"
                className="select"
                value={draft.kind}
                disabled={!editor}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  setDraft({ ...draft, kind: k, enter: KINDS[k].enter, exit: KINDS[k].exit });
                }}
              >
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="small muted">{KINDS[draft.kind].help}</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label className="switch">
                <input type="checkbox" checked={draft.enter} disabled={!editor} onChange={(e) => setDraft({ ...draft, enter: e.target.checked })} />
                <span>Alert when a rider goes in</span>
              </label>
              <label className="switch">
                <input type="checkbox" checked={draft.exit} disabled={!editor} onChange={(e) => setDraft({ ...draft, exit: e.target.checked })} />
                <span>Alert when a rider leaves</span>
              </label>
              {draft.id ? (
                <label className="switch">
                  <input type="checkbox" checked={draft.active} disabled={!editor} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  <span>Zone is on</span>
                </label>
              ) : null}
            </div>

            {editor && !drawing && draft.id ? (
              <div className="row">
                <button className="btn secondary small" onClick={redraw}>
                  Redraw the shape
                </button>
              </div>
            ) : null}

            <div className="row">
              {editor ? (
                <button className="btn" disabled={missing.length > 0} onClick={() => void save()}>
                  {draft.id ? "Save" : "Add zone"}
                </button>
              ) : null}
              <button className="link-button" onClick={cancel}>
                {editor ? "Cancel" : "Close"}
              </button>
            </div>
            {editor && missing.length > 0 ? <span className="small muted">Needs {missing.join(" and ")}.</span> : null}
          </section>
        ) : null}

        <section className="card">
          <h2>On</h2>
          <ZoneList zones={active} onPick={edit} empty="No zones yet. Start with the service area, then add closed roads as they happen." />
        </section>
        {off.length > 0 ? (
          <section className="card">
            <h2>Off</h2>
            <ZoneList zones={off} onPick={edit} empty="" />
          </section>
        ) : null}
        <p className="small muted" style={{ margin: 0 }}>
          Sector and cell borders: geoBoundaries, Open Data Rwanda (CC BY 4.0).
        </p>
      </aside>
    </div>
  );
}

/** A margin, a circle's size or a strip's width, in metres. */
function SizeSlider({ range, value, onChange }: { range: SizeRange; value: number; onChange: (v: number) => void }) {
  const id = `size-${range.label.toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {range.label}: {metres(value)}
      </label>
      <input id={id} className="range" type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function ZoneList({ zones, onPick, empty }: { zones: Zone[]; onPick: (z: Zone) => void; empty: string }) {
  if (zones.length === 0) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="list">
      {zones.map((z) => (
        <div key={z.id} className="list-item" onClick={() => onPick(z)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: KINDS[z.kind].color }} />
              <strong>{z.name}</strong>
            </span>
            <span className="small muted">{z.area_km2} km²</span>
          </div>
          <div className="small muted">
            {KINDS[z.kind].label}
            {", "}
            {z.alert_on_enter && z.alert_on_exit ? "alerts both ways" : z.alert_on_enter ? "alerts on entry" : z.alert_on_exit ? "alerts on leaving" : "no alerts"}
            {", "}
            {kigaliDateTime(z.updated_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

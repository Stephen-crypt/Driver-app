import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveMap, type MapZone } from "../components/LiveMap";
import { can, kigaliDateTime, rpc, type Staff } from "../lib/supabase";
import { Flash } from "../components/ui";

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

type Draft = { id: string | null; name: string; kind: Kind; enter: boolean; exit: boolean; active: boolean; corners: [number, number][] | null };

const ringOf = (z: Zone): [number, number][] => z.area.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [lat, lng]);

export function Zones({ staff }: { staff: Staff }) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const editor = can(staff.role, "operations", "safety");

  const load = useCallback(() => {
    rpc<Zone[]>("staff_zones").then(setZones).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const startNew = () => {
    setDone(null);
    setError(null);
    setDraft({ id: null, name: "", kind: "restricted", enter: true, exit: false, active: true, corners: [] });
    setDrawing(true);
  };

  const edit = (z: Zone) => {
    setDone(null);
    setError(null);
    setDrawing(false);
    setDraft({ id: z.id, name: z.name, kind: z.kind, enter: z.alert_on_enter, exit: z.alert_on_exit, active: z.active, corners: null });
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
      setDraft(null);
      setDrawing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

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

  const active = (zones ?? []).filter((z) => z.active);
  const off = (zones ?? []).filter((z) => !z.active);

  return (
    <div className="control">
      <div className={`control-map${drawing ? " drawing" : ""}`}>
        <LiveMap
          points={[]}
          zones={mapZones}
          draft={draft?.corners ?? null}
          onMapClick={drawing ? (lat, lng) => setDraft((d) => (d ? { ...d, corners: [...(d.corners ?? []), [lat, lng]] } : d)) : undefined}
        />
        {drawing ? (
          <div className="map-legend">
            <strong>Click the map to place each corner.</strong>
            <div className="small muted">{draft?.corners?.length ?? 0} placed, at least 3 needed</div>
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
              Draw a zone
            </button>
          ) : null}
        </div>

        {error ? <div className="notice bad">{error}</div> : null}
        <Flash message={done} onShown={() => setDone(null)} />

        {draft ? (
          <section className="card stack">
            <h2 style={{ margin: 0 }}>{draft.id ? "Edit zone" : "New zone"}</h2>
            <div className="field">
              <label htmlFor="zname">Name</label>
              <input id="zname" className="input" value={draft.name} disabled={!editor} placeholder="e.g. Nyabugogo road works" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
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

            {editor ? (
              <div className="row">
                {drawing ? (
                  <button className="btn secondary small" disabled={!draft.corners?.length} onClick={() => setDraft({ ...draft, corners: draft.corners!.slice(0, -1) })}>
                    Undo corner
                  </button>
                ) : draft.id ? (
                  <button className="btn secondary small" onClick={() => { setDraft({ ...draft, corners: [] }); setDrawing(true); }}>
                    Redraw the shape
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="row">
              {editor ? (
                <button className="btn" disabled={draft.name.trim().length < 2 || (draft.corners !== null && draft.corners.length < 3)} onClick={() => void save()}>
                  {draft.id ? "Save" : "Add zone"}
                </button>
              ) : null}
              <button className="link-button" onClick={() => { setDraft(null); setDrawing(false); }}>
                {editor ? "Cancel" : "Close"}
              </button>
            </div>
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
      </aside>
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

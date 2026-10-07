import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LiveMap, type MapLine, type MapPoint, type MapZone } from "../components/LiveMap";
import { ago, can, kigaliTime, money, rpc, supabase, type Staff } from "../lib/supabase";
import { Odometer, useUi } from "../components/ui";
import { Icon } from "../components/kit";

interface Rider {
  rider_id: string;
  name: string;
  phone: string | null;
  vest: string | null;
  plate: string | null;
  status: string;
  lng: number | null;
  lat: number | null;
  heartbeat_at: string | null;
  stale: boolean;
  on_shift: boolean;
  trip_id: string | null;
  trip_state: string | null;
  cash_held_rwf: number;
}

interface Trip {
  trip_id: string;
  state: string;
  created_at: string;
  scheduled_for: string | null;
  waiting_seconds: number;
  fare_rwf: number | null;
  passenger_name: string;
  passenger_phone: string | null;
  rider_name: string | null;
  vest: string | null;
  pickup_label: string;
  dropoff_label: string;
  pickup_lng: number;
  pickup_lat: number;
  dropoff_lng: number;
  dropoff_lat: number;
  rider_lng: number | null;
  rider_lat: number | null;
  recurring: boolean;
  needs_attention: boolean;
}

interface Alert {
  id: string;
  created_at: string;
  source: string;
  note: string | null;
  person_name: string;
  person_phone: string | null;
  person_role: string;
  lng: number | null;
  lat: number | null;
  trip_id: string | null;
  trip_state: string | null;
  pickup_label: string | null;
  dropoff_label: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  plate: string | null;
  vest: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
}

interface Event {
  kind: string;
  at: string;
  title: string;
  detail: string | null;
  trip_id: string | null;
  ref_id: string;
}

const STATE: Record<string, string> = {
  scheduled: "Booked",
  requested: "Finding rider",
  offered: "Offered",
  accepted: "Rider on the way",
  arrived: "Rider waiting",
  in_progress: "On trip",
};

// A short two-tone chime, made in the browser: no audio file to load, and it
// plays even when the tab is in the background.
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.22);
      o.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
  } catch {
    // No audio device, or the browser has not been interacted with yet.
  }
}

export function ControlRoom({ staff }: { staff: Staff }) {
  const navigate = useNavigate();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [zones, setZones] = useState<MapZone[]>([]);

  // Zones change rarely; read once, drawn faintly under the riders.
  useEffect(() => {
    rpc<{ id: string; name: string; kind: string; active: boolean; area: { coordinates: [number, number][][] } }[]>("staff_zones")
      .then((zs) =>
        setZones(
          zs
            .filter((z) => z.active)
            .map((z) => ({
              id: z.id,
              ring: z.area.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number]),
              color: z.kind === "restricted" ? "#b91c1c" : "#0a2342",
              label: z.name,
              muted: z.kind !== "restricted",
            })),
        ),
      )
      .catch(() => setZones([]));
  }, []);
  const [error, setError] = useState<string | null>(null);
  const ui = useUi();
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t, a, e] = await Promise.all([
        rpc<Rider[]>("staff_live_riders"),
        rpc<Trip[]>("staff_live_trips"),
        rpc<Alert[]>("staff_open_alerts"),
        rpc<Event[]>("staff_recent_events", { p_hours: 12 }),
      ]);
      setRiders(r);
      setTrips(t);
      setAlerts(a);
      setEvents(e);
      setError(null);
      setNow(Date.now());
      // Sound for alerts this screen has not seen before - not on first load,
      // which would chime for every alert already on the board.
      const ids = new Set(a.map((x) => x.id));
      if (known.current && a.some((x) => !known.current!.has(x.id))) chime();
      known.current = ids;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the control room.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 5000);
    // Realtime brings an SOS in within a second; the five-second poll is the
    // backstop for a connection that dropped.
    const channel = supabase
      .channel("control-sos")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => void load())
      .subscribe();
    return () => {
      clearInterval(id);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Title flashes while an alert is unacknowledged, so it is seen from another tab.
  const unacked = alerts.filter((a) => !a.acknowledged_at).length;
  useEffect(() => {
    document.title = unacked > 0 ? `(${unacked}) SOS - Nova Control` : "Nova Control";
    return () => {
      document.title = "Nova Control";
    };
  }, [unacked]);

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    for (const r of riders) {
      if (r.lat === null || r.lng === null) continue;
      const cls = r.stale ? "stale" : r.trip_id ? "busy" : "";
      out.push({
        id: `r-${r.rider_id}`,
        lat: r.lat,
        lng: r.lng,
        html: `<div class="m-rider ${cls}">${escapeHtml(r.vest ?? "·")}</div>`,
        size: [30, 34],
        title: `${r.name}${r.plate ? `, ${r.plate}` : ""}`,
        onClick: () => navigate(`/riders/${r.rider_id}`),
      });
    }
    for (const t of trips) {
      if (t.state === "in_progress") continue;
      out.push({
        id: `p-${t.trip_id}`,
        lat: t.pickup_lat,
        lng: t.pickup_lng,
        html: `<div class="m-pin ${t.needs_attention ? "late" : ""}"></div>`,
        size: [14, 14],
        title: `${t.passenger_name}, ${(STATE[t.state] ?? t.state).toLowerCase()}`,
        onClick: () => navigate(`/trips/${t.trip_id}`),
      });
    }
    for (const a of alerts) {
      if (a.lat === null || a.lng === null) continue;
      out.push({
        id: `s-${a.id}`,
        lat: a.lat,
        lng: a.lng,
        html: `<div class="m-sos"></div>`,
        size: [26, 26],
        title: `SOS from ${a.person_name}`,
      });
    }
    return out;
  }, [riders, trips, alerts, navigate]);

  const lines = useMemo<MapLine[]>(
    () =>
      trips
        .filter((t) => t.rider_lat !== null && t.rider_lng !== null)
        .map((t) => ({
          id: t.trip_id,
          from: { lat: t.rider_lat!, lng: t.rider_lng! },
          to: t.state === "in_progress" ? { lat: t.dropoff_lat, lng: t.dropoff_lng } : { lat: t.pickup_lat, lng: t.pickup_lng },
          color: t.state === "in_progress" ? "#15803D" : "#0A2342",
        })),
    [trips],
  );

  const online = riders.filter((r) => r.status !== "offline" && !r.stale);
  const busy = riders.filter((r) => r.trip_id);
  const attention = trips.filter((t) => t.needs_attention);
  const live = trips.filter((t) => t.state !== "scheduled");

  return (
    <div className="control">
      <div className="control-map">
        <LiveMap points={points} lines={lines} focus={focus} zones={zones} />
        <div className="glance" aria-label="The city right now">
          <div className={`glance-card${alerts.length > 0 ? " hot" : ""}`}>
            <span className={`kpi-icon ${alerts.length > 0 ? "" : "tint-green"}`}>
              <Icon name={alerts.length > 0 ? "alert" : "shield"} size={18} />
            </span>
            <div>
              <strong className="g-num">
                <Odometer value={alerts.length} />
              </strong>
              <span className="g-label">{alerts.length === 1 ? "Open emergency" : "Open emergencies"}</span>
            </div>
          </div>
          <div className="glance-card">
            <span className="kpi-icon tint-yellow">
              <Icon name="riders" size={18} />
            </span>
            <div>
              <strong className="g-num">
                <Odometer value={online.length} />
              </strong>
              <span className="g-label">Riders online</span>
            </div>
          </div>
          <div className="glance-card">
            <span className="kpi-icon tint-green">
              <Icon name="navigate" size={18} />
            </span>
            <div>
              <strong className="g-num">
                <Odometer value={live.length} />
              </strong>
              <span className="g-label">Trips live now</span>
            </div>
          </div>
          <div className="glance-card">
            <span className={`kpi-icon ${attention.length > 0 ? "tint-amber" : "tint-blue"}`}>
              <Icon name="clock" size={18} />
            </span>
            <div>
              <strong className="g-num">
                <Odometer value={attention.length} />
              </strong>
              <span className="g-label">Waiting too long</span>
            </div>
          </div>
          <div className="glance-card">
            <span className="kpi-icon tint-blue">
              <Icon name="cash" size={18} />
            </span>
            <div>
              <strong className="g-num">
                <Odometer value={money(riders.reduce((t, r) => t + (r.cash_held_rwf ?? 0), 0))} />
              </strong>
              <span className="g-label">RWF with riders</span>
            </div>
          </div>
        </div>
        <div className="map-legend">
          <span className="chip accent">
            <span className="dot" /> {online.length - busy.length} available
          </span>
          <span className="chip good">
            <span className="dot" /> {busy.length} on a trip
          </span>
          <span className="chip">{riders.filter((r) => r.on_shift && (r.stale || r.status === "offline")).length} on shift, not live</span>
          {attention.length > 0 ? <span className="chip warn">{attention.length} waiting too long</span> : null}
        </div>
      </div>

      <aside className="control-rail" aria-label="Alerts and trips">
        {error ? <div className="notice bad">{error}</div> : null}

        {alerts.length > 0 ? (
          <section className="stack" aria-label="Emergency alerts">
            {alerts.map((a) => (
              <SosCard
                key={a.id}
                alert={a}
                now={now}
                canAct={can(staff.role, "control_room", "safety", "operations")}
                onFocus={() => a.lat !== null && a.lng !== null && setFocus({ lat: a.lat, lng: a.lng, key: `${a.id}-${Date.now()}` })}
                onChanged={load}
              />
            ))}
          </section>
        ) : (
          <div className="all-clear">
            <span className="kpi-icon">
              <Icon name="shield" size={18} />
            </span>
            <div>
              No open emergencies
              <small>An SOS from a rider or passenger appears here, with a chime.</small>
            </div>
          </div>
        )}

        {attention.length > 0 ? (
          <section className="card" aria-label="Needs attention">
            <h2>
              <Icon name="clock" size={18} style={{ color: "var(--warn)" }} /> Needs attention
            </h2>
            <div className="list">
              {attention.map((t) => (
                <div key={t.trip_id} className="list-item" onClick={() => navigate(`/trips/${t.trip_id}`)}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{t.passenger_name}</strong>
                    <span className="chip warn">
                      {t.state === "scheduled" ? `Booked ${kigaliTime(t.scheduled_for)}` : `Waiting ${Math.floor(t.waiting_seconds / 60)} min`}
                    </span>
                  </div>
                  <div className="small muted">
                    {t.pickup_label} to {t.dropoff_label}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="card" aria-label="Live trips">
          <h2>
            <Icon name="navigate" size={18} style={{ color: "var(--good)" }} /> Live trips <span className="count-inline"><Odometer value={live.length} /></span>
          </h2>
          {live.length === 0 ? (
            <div className="muted small">Nothing moving right now.</div>
          ) : (
            <div className="list">
              {live.map((t) => (
                <div
                  key={t.trip_id}
                  className="list-item"
                  onClick={() =>
                    t.rider_lat !== null && t.rider_lng !== null
                      ? setFocus({ lat: t.rider_lat, lng: t.rider_lng, key: `${t.trip_id}-${Date.now()}` })
                      : navigate(`/trips/${t.trip_id}`)
                  }
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div className="row" style={{ gap: 8 }}>
                      {t.vest ? <span className="vest">{t.vest}</span> : null}
                      <div>
                        <strong>{t.rider_name ?? "No rider yet"}</strong>
                        <div className="small muted">with {t.passenger_name}</div>
                      </div>
                    </div>
                    <span className={`chip ${t.state === "in_progress" ? "good" : t.state === "arrived" ? "warn" : "accent"}`}>
                      {STATE[t.state] ?? t.state}
                    </span>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {t.pickup_label} to {t.dropoff_label}
                    {t.fare_rwf ? `, ${money(t.fare_rwf)} RWF` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {events.length > 0 ? (
          <section className="card" aria-label="Recent events">
            <h2>
              <Icon name="clock" size={18} style={{ color: "var(--accent)" }} /> Last 12 hours
            </h2>
            <div className="list">
              {events.slice(0, 15).map((e) => (
                <div
                  key={`${e.kind}-${e.ref_id}`}
                  className={`list-item${e.kind === "speed" || e.kind.startsWith("geo:") || e.kind === "case:incident" ? " flagged" : ""}`}
                  onClick={() => (e.kind.startsWith("case:") ? navigate(`/cases/${e.ref_id}`) : e.trip_id && navigate(`/trips/${e.trip_id}`))}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{e.title}</strong>
                    <span className="small muted">{ago(e.at, now)}</span>
                  </div>
                  {e.detail ? <div className="small muted">{e.detail}</div> : null}
                  {e.kind === "speed" || e.kind.startsWith("geo:") ? (
                    <button
                      className="link-button small"
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        const note = await ui.prompt({
                          title: "Mark as reviewed",
                          body: e.title,
                          label: "What was done? (optional)",
                          placeholder: "Called the rider. A road was closed, so they went round.",
                          confirmLabel: "Mark reviewed",
                          optional: true,
                        });
                        if (note === null) return;
                        void rpc(e.kind === "speed" ? "staff_review_speed_alert" : "staff_review_geo_alert", { p_alert_id: e.ref_id, p_note: note })
                          .then(() => {
                            setEvents((all) => all.filter((x) => x.ref_id !== e.ref_id));
                            ui.toast("Marked as reviewed");
                          })
                          .catch((err: Error) => ui.toast(err.message, "bad"));
                      }}
                    >
                      Mark reviewed
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function SosCard({
  alert: a,
  now,
  canAct,
  onFocus,
  onChanged,
}: {
  alert: Alert;
  now: number;
  canAct: boolean;
  onFocus: () => void;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  return (
    <div className={`alert ${a.acknowledged_at ? "" : "fresh"}`} role="alert">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{a.person_role === "rider" ? "Rider" : "Passenger"} emergency</h3>
        <span className="small muted">{ago(a.created_at, now)}</span>
      </div>
      <div className="who" style={{ marginTop: 6 }}>
        {a.person_name}
        {a.person_phone ? (
          <>
            {", "}
            <a href={`tel:${a.person_phone}`}>{a.person_phone}</a>
          </>
        ) : null}
      </div>
      {a.trip_id ? (
        <div className="small" style={{ marginTop: 4 }}>
          {a.pickup_label} to {a.dropoff_label} <span className="muted">({(a.trip_state && STATE[a.trip_state]) ?? a.trip_state})</span>
          <br />
          {a.rider_name ? (
            <>
              Rider {a.rider_name}
              {a.rider_phone ? (
                <>
                  {", "}
                  <a href={`tel:${a.rider_phone}`}>{a.rider_phone}</a>
                </>
              ) : null}
              {a.plate ? <>{", "}<span className="plate">{a.plate}</span></> : null}
              {a.vest ? <>, vest {a.vest}</> : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="small muted">Not on a trip.</div>
      )}
      {a.note ? <div className="small" style={{ marginTop: 4 }}>“{a.note}”</div> : null}
      <div className="small muted" style={{ marginTop: 4 }}>
        {a.lat !== null ? `${a.lat.toFixed(5)}, ${a.lng?.toFixed(5)}` : "No location recorded"}
        {a.acknowledged_at ? `. Acknowledged by ${a.acknowledged_by_name ?? "staff"} ${ago(a.acknowledged_at, now)}` : ""}
      </div>

      {error ? <div className="notice bad small" style={{ marginTop: 8 }}>{error}</div> : null}

      {canAct ? (
        resolving ? (
          <div className="stack" style={{ marginTop: 10 }}>
            <textarea
              className="textarea"
              placeholder="What happened, and what did you do?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <div className="row">
              <button className="btn dark small" onClick={() => void act(() => rpc("staff_resolve_sos", { p_alert_id: a.id, p_resolution: text }))}>
                Close alert
              </button>
              <button className="btn secondary small" onClick={() => setResolving(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            {!a.acknowledged_at ? (
              <button className="btn small" onClick={() => void act(() => rpc("staff_ack_sos", { p_alert_id: a.id }))}>
                I'm on it
              </button>
            ) : null}
            {a.lat !== null ? (
              <button className="btn secondary small" onClick={onFocus}>
                Show on map
              </button>
            ) : null}
            <button className="btn secondary small" onClick={() => setResolving(true)}>
              Resolve
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

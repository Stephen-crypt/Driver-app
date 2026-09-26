import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LiveMap, type MapLine, type MapPoint } from "../components/LiveMap";
import { ago, can, kigaliTime, money, rpc, supabase, type Staff } from "../lib/supabase";

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
  const [error, setError] = useState<string | null>(null);
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
    document.title = unacked > 0 ? `(${unacked}) SOS - Gera Control` : "Gera Control";
    return () => {
      document.title = "Gera Control";
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
        title: `${r.name}${r.plate ? ` · ${r.plate}` : ""}`,
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
        title: `${t.passenger_name} · ${STATE[t.state] ?? t.state}`,
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
        title: `SOS · ${a.person_name}`,
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
          color: t.state === "in_progress" ? "#0E7C4A" : "#0057E7",
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
        <LiveMap points={points} lines={lines} focus={focus} />
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
          <div className="notice good">No open emergencies.</div>
        )}

        {attention.length > 0 ? (
          <section className="card" aria-label="Needs attention">
            <h2>Needs attention</h2>
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
                    {t.pickup_label} → {t.dropoff_label}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="card" aria-label="Live trips">
          <h2>Live trips · {live.length}</h2>
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
                    {t.pickup_label} → {t.dropoff_label}
                    {t.fare_rwf ? ` · ${money(t.fare_rwf)} RWF` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {events.length > 0 ? (
          <section className="card" aria-label="Recent events">
            <h2>Last 12 hours</h2>
            <div className="list">
              {events.slice(0, 15).map((e) => (
                <div
                  key={`${e.kind}-${e.ref_id}`}
                  className={`list-item${e.kind === "speed" || e.kind === "case:incident" ? " flagged" : ""}`}
                  onClick={() => (e.kind.startsWith("case:") ? navigate(`/cases/${e.ref_id}`) : e.trip_id && navigate(`/trips/${e.trip_id}`))}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{e.title}</strong>
                    <span className="small muted">{ago(e.at, now)}</span>
                  </div>
                  {e.detail ? <div className="small muted">{e.detail}</div> : null}
                  {e.kind === "speed" ? (
                    <button
                      className="link-button small"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const note = window.prompt("What was done? (optional)") ?? null;
                        if (note === null) return;
                        void rpc("staff_review_speed_alert", { p_alert_id: e.ref_id, p_note: note })
                          .then(() => setEvents((all) => all.filter((x) => x.ref_id !== e.ref_id)))
                          .catch((err: Error) => window.alert(err.message));
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
        <h3>Emergency · {a.person_role === "rider" ? "rider" : "passenger"}</h3>
        <span className="small muted">{ago(a.created_at, now)}</span>
      </div>
      <div className="who" style={{ marginTop: 6 }}>
        {a.person_name}
        {a.person_phone ? (
          <>
            {" · "}
            <a href={`tel:${a.person_phone}`}>{a.person_phone}</a>
          </>
        ) : null}
      </div>
      {a.trip_id ? (
        <div className="small" style={{ marginTop: 4 }}>
          {a.pickup_label} → {a.dropoff_label} <span className="muted">({(a.trip_state && STATE[a.trip_state]) ?? a.trip_state})</span>
          <br />
          {a.rider_name ? (
            <>
              Rider {a.rider_name}
              {a.rider_phone ? (
                <>
                  {" "}
                  · <a href={`tel:${a.rider_phone}`}>{a.rider_phone}</a>
                </>
              ) : null}
              {a.plate ? <> · <span className="plate">{a.plate}</span></> : null}
              {a.vest ? <> · vest {a.vest}</> : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="small muted">Not on a trip.</div>
      )}
      {a.note ? <div className="small" style={{ marginTop: 4 }}>“{a.note}”</div> : null}
      <div className="small muted" style={{ marginTop: 4 }}>
        {a.lat !== null ? `${a.lat.toFixed(5)}, ${a.lng?.toFixed(5)}` : "No location recorded"}
        {a.acknowledged_at ? ` · acknowledged by ${a.acknowledged_by_name ?? "staff"} ${ago(a.acknowledged_at, now)}` : ""}
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

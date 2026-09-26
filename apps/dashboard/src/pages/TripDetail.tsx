import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { kigaliDateTime, kigaliTime, money, rpc } from "../lib/supabase";

interface Detail {
  id: string;
  state: string;
  created_at: string;
  scheduled_for: string | null;
  vehicle_class: string;
  fare_rwf: number | null;
  pickup_label: string;
  pickup_note: string | null;
  dropoff_label: string;
  passenger: { id: string; name: string; phone: string | null };
  rider: { id: string; name: string; phone: string | null } | null;
  total: { total_rwf?: number; fare_rwf?: number; waiting_charge_rwf?: number } | null;
  rating: { rating: number; comment: string | null } | null;
  events: { at: string; from: string; to: string; actor: string }[];
  no_show: { reason: string; waited_seconds: number } | null;
  sos: { at: string; resolution: string | null }[];
}

const WORDS: Record<string, string> = {
  scheduled: "Booked ahead",
  requested: "Looking for a rider",
  offered: "Offered to a rider",
  accepted: "Rider accepted",
  arrived: "Rider arrived",
  in_progress: "Trip started (PIN checked)",
  completed: "Completed",
  cancelled_by_passenger: "Cancelled by passenger",
  cancelled_by_rider: "Cancelled by rider",
  expired: "Timed out",
  no_riders: "No rider found",
  no_show: "Passenger no-show",
  skipped: "Skipped",
};

export function TripDetail() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc<Detail>("staff_trip_detail", { p_trip_id: id })
      .then(setD)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (!d) return <div className="page">{error ? <div className="notice bad">{error}</div> : "Loading…"}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="sub" style={{ margin: 0 }}>
            <Link to="/trips">Trips</Link> · <span className="small">{d.id}</span>
          </p>
          <h1>
            {d.pickup_label} → {d.dropoff_label}
          </h1>
          <p className="sub">
            {d.vehicle_class} · booked {kigaliDateTime(d.created_at)}
            {d.scheduled_for ? ` for ${kigaliDateTime(d.scheduled_for)}` : ""}
          </p>
        </div>
        <div className="spacer" />
        <div className="row">
          <span className={`chip ${d.state === "completed" ? "good" : ["no_show", "no_riders", "cancelled_by_rider"].includes(d.state) ? "bad" : "accent"}`}>{WORDS[d.state] ?? d.state}</span>
          <Link className="btn secondary" to={`/cases?trip=${d.id}`}>
            Open a case
          </Link>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Passenger</h2>
          <strong>{d.passenger.name}</strong>
          <div>{d.passenger.phone ? <a href={`tel:${d.passenger.phone}`}>{d.passenger.phone}</a> : null}</div>
          {d.pickup_note ? <div className="small muted" style={{ marginTop: 6 }}>Note: “{d.pickup_note}”</div> : null}
        </div>
        <div className="card">
          <h2>Rider</h2>
          {d.rider ? (
            <>
              <Link to={`/riders/${d.rider.id}`}>
                <strong>{d.rider.name}</strong>
              </Link>
              <div>{d.rider.phone ? <a href={`tel:${d.rider.phone}`}>{d.rider.phone}</a> : null}</div>
            </>
          ) : (
            <span className="muted">None assigned</span>
          )}
        </div>
        <div className="card stat">
          <div className="figure">
            {money(d.total?.total_rwf ?? d.fare_rwf)}
            <small>RWF</small>
          </div>
          <div className="label">
            {d.total ? `Fare ${money(d.total.fare_rwf ?? d.total.total_rwf)}${d.total.waiting_charge_rwf ? ` + waiting ${money(d.total.waiting_charge_rwf)}` : ""}` : "Quoted price"}
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>What happened</h2>
          <ol className="timeline">
            {d.events.map((e, i) => (
              <li key={i}>
                <time>{kigaliTime(e.at)}</time>
                <span>
                  {WORDS[e.to] ?? e.to} <span className="small muted">· {e.actor}</span>
                </span>
              </li>
            ))}
            {d.events.length === 0 ? <li className="muted">No state changes yet.</li> : null}
          </ol>
        </section>
        <div className="stack">
          {d.no_show ? (
            <div className="notice warn">
              No-show reported after {Math.round(d.no_show.waited_seconds / 60)} min: “{d.no_show.reason}”
            </div>
          ) : null}
          {d.sos.map((s, i) => (
            <div key={i} className="notice bad">
              SOS at {kigaliTime(s.at)} - {s.resolution ?? "still open"}
            </div>
          ))}
          {d.rating ? (
            <section className="card">
              <h2>Rating</h2>
              <div className="num" style={{ fontSize: 28 }}>
                {"★".repeat(d.rating.rating)}
                <span className="muted">{"★".repeat(5 - d.rating.rating)}</span>
              </div>
              {d.rating.comment ? <p>{d.rating.comment}</p> : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

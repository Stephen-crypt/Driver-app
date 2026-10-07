import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { money, rpc } from "../lib/supabase";
import { Odometer, Skeleton } from "../components/ui";
import { Empty, Kpi } from "../components/kit";

interface RiderRow {
  rider_id: string;
  name: string;
  phone: string | null;
  verification: string;
  notes: string | null;
  vest: string | null;
  plate: string | null;
  online: boolean;
  on_shift: boolean;
  cash_held_rwf: number;
  net_owed_rwf: number;
  docs_waiting: number;
  rating: number | null;
}

const FILTERS = [
  { key: "waiting", label: "Waiting for review" },
  { key: "verified", label: "Verified" },
  { key: "suspended", label: "Suspended" },
  { key: "all", label: "Everyone" },
] as const;

export function Riders() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("waiting");
  const [rows, setRows] = useState<RiderRow[] | null>(null);
  // Everyone, once, for the figures above the list: whichever tab is open,
  // the four numbers describe the whole team.
  const [all, setAll] = useState<RiderRow[] | null>(null);
  useEffect(() => {
    rpc<RiderRow[]>("staff_riders", { p_filter: "all" })
      .then(setAll)
      .catch(() => {});
  }, []);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    rpc<RiderRow[]>("staff_riders", { p_filter: filter })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [filter]);
  useEffect(load, [load]);

  const cash = (rows ?? []).reduce((t, r) => t + r.cash_held_rwf, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Riders</h1>
          <p className="sub">
            {rows ? `${rows.length} shown, ${money(cash)} RWF of company cash out with them` : <Skeleton w={340} h={14} style={{ marginTop: 6 }} />}
          </p>
        </div>
        <div className="spacer" />
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi
          icon="document"
          tint={(all ?? []).some((r) => r.docs_waiting > 0) ? "amber" : "blue"}
          label="Waiting for review"
          value={<Odometer value={(all ?? []).filter((r) => r.verification !== "verified" && r.verification !== "rejected").length} />}
          note={`${(all ?? []).reduce((t, r) => t + r.docs_waiting, 0)} documents to check`}
        />
        <Kpi
          icon="shield"
          tint="green"
          label="Verified riders"
          value={<Odometer value={(all ?? []).filter((r) => r.verification === "verified").length} delay={80} />}
          note={`${(all ?? []).filter((r) => r.verification === "rejected").length} suspended`}
        />
        <Kpi
          icon="radio"
          tint="yellow"
          label="Online now"
          value={<Odometer value={(all ?? []).filter((r) => r.online).length} delay={160} />}
          note={`${(all ?? []).filter((r) => r.on_shift).length} on shift`}
        />
        <Kpi
          icon="cash"
          tint={(all ?? []).some((r) => r.cash_held_rwf > 0) ? "amber" : "green"}
          label="Company cash with riders"
          value={<Odometer value={money((all ?? []).reduce((t, r) => t + r.cash_held_rwf, 0))} delay={240} />}
          unit="RWF"
          note="To be handed in"
        />
      </div>

      {error ? <div className="notice bad">{error}</div> : null}

      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 18 }}>Rider</th>
              <th>Status</th>
              <th>Vehicle</th>
              <th className="right">Carrying</th>
              <th className="right">Owed</th>
              <th className="right" style={{ paddingRight: 16 }}>
                Rating
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.rider_id} className="clickable" onClick={() => navigate(`/riders/${r.rider_id}`)}>
                <td style={{ paddingLeft: 16 }}>
                  <div className="row" style={{ gap: 10 }}>
                    {r.vest ? <span className="vest">{r.vest}</span> : <span className="vest" style={{ background: "var(--sunken)", color: "var(--muted)" }}>–</span>}
                    <div>
                      <strong>{r.name}</strong>
                      <div className="small muted">{r.phone}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {r.verification === "verified" ? (
                      <span className="chip good">Verified</span>
                    ) : r.verification === "rejected" ? (
                      <span className="chip bad">Suspended</span>
                    ) : (
                      <span className="chip warn">{r.docs_waiting > 0 ? `${r.docs_waiting} to review` : "Waiting on rider"}</span>
                    )}
                    {r.online ? (
                      <span className="chip accent">
                        <span className="dot" /> Online
                      </span>
                    ) : r.on_shift ? (
                      <span className="chip">On shift</span>
                    ) : null}
                  </div>
                </td>
                <td>{r.plate ? <span className="plate">{r.plate}</span> : <span className="muted small">None assigned</span>}</td>
                <td className={`right num ${r.cash_held_rwf > 0 ? "" : "muted"}`}>{money(r.cash_held_rwf)}</td>
                <td className="right num">{money(r.net_owed_rwf)}</td>
                <td className="right" style={{ paddingRight: 16 }}>
                  {r.rating ? `★ ${r.rating}` : <span className="muted">–</span>}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 0 }}>
                  {filter === "waiting" ? (
                    <Empty icon="riders" title="Nobody is waiting for review" body="New riders show up here once they have sent their licence and national ID." />
                  ) : (
                    <Empty icon="riders" title="No riders here" />
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

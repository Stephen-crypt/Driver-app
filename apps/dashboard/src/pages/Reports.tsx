import { useEffect, useState } from "react";
import { money, rpc } from "../lib/supabase";
import { Odometer } from "../components/ui";

interface Summary {
  day: string;
  completed: number;
  cancelled_by_passenger: number;
  cancelled_by_rider: number;
  no_riders: number;
  no_show: number;
  collected_rwf: number;
  earned_rwf: number;
  remitted_rwf: number;
  riders_worked: number;
  sos: number;
  outstanding_cash_rwf: number;
}

function kigaliToday(): string {
  const k = new Date(Date.now() + 2 * 3600_000);
  return k.toISOString().slice(0, 10);
}

const ROWS: [keyof Summary, string, "money" | "count"][] = [
  ["completed", "Trips completed", "count"],
  ["cancelled_by_passenger", "Cancelled by passengers", "count"],
  ["cancelled_by_rider", "Cancelled by riders", "count"],
  ["no_riders", "No rider found", "count"],
  ["no_show", "Passenger no-shows", "count"],
  ["riders_worked", "Riders who worked", "count"],
  ["sos", "Emergency alerts", "count"],
  ["collected_rwf", "Fares collected (RWF)", "money"],
  ["earned_rwf", "Rider earnings (RWF)", "money"],
  ["remitted_rwf", "Cash handed in (RWF)", "money"],
  ["outstanding_cash_rwf", "Cash still out with riders (RWF)", "money"],
];

/** §88: the day in numbers, and a CSV of the same for whoever keeps the books. */
export function Reports() {
  const [day, setDay] = useState(kigaliToday());
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setS(null);
    rpc<Summary>("staff_day_summary", { p_day: day })
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, [day]);

  const csv = () => {
    if (!s) return;
    const body = ["metric,value", ...ROWS.map(([k, label]) => `"${label}",${s[k]}`)].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gera-${s.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const finished = s ? s.completed + s.cancelled_by_passenger + s.cancelled_by_rider + s.no_riders + s.no_show : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">One day at a time, in Kigali time.</p>
        </div>
        <div className="spacer" />
        <input className="input" type="date" value={day} max={kigaliToday()} onChange={(e) => setDay(e.target.value)} />
        <button className="btn secondary" onClick={csv} disabled={!s}>
          Download CSV
        </button>
      </div>

      {error ? <div className="notice bad">{error}</div> : null}

      {s ? (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <div className="card stat">
              <div className="figure">
                <Odometer value={s.completed} />
              </div>
              <div className="label">Trips completed</div>
            </div>
            <div className="card stat">
              <div className="figure">
                <Odometer value={finished > 0 ? Math.round((s.completed / finished) * 100) : 0} delay={80} />
                <small>%</small>
              </div>
              <div className="label">Of requests that ended in a ride</div>
            </div>
            <div className="card stat">
              <div className="figure">
                <Odometer value={money(s.collected_rwf)} delay={160} />
                <small>RWF</small>
              </div>
              <div className="label">Fares collected</div>
            </div>
            <div className="card stat">
              <div className="figure" style={{ color: s.outstanding_cash_rwf > 0 ? "var(--warn)" : undefined }}>
                <Odometer value={money(s.outstanding_cash_rwf)} delay={240} />
                <small>RWF</small>
              </div>
              <div className="label">Cash still out with riders, all days</div>
            </div>
          </div>
          <div className="card" style={{ maxWidth: 640 }}>
            <table className="table">
              <tbody>
                {ROWS.map(([k, label, kind]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td className="right num">{kind === "money" ? money(s[k] as number) : s[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

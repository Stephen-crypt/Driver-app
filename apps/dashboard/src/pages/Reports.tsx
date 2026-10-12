import { useEffect, useState } from "react";
import { money, rpc } from "../lib/supabase";
import { Odometer, Skeleton } from "../components/ui";
import { DayBars, Donut, Icon, Kpi } from "../components/kit";

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

/** The ISO day `n` days before `day`. */
function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

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

// Which way is good news, for the download's Change column.
const BETTER: Record<keyof Summary | "rate", "up" | "down"> = {
  day: "up",
  completed: "up",
  rate: "up",
  cancelled_by_passenger: "down",
  cancelled_by_rider: "down",
  no_riders: "down",
  no_show: "down",
  riders_worked: "up",
  sos: "down",
  collected_rwf: "up",
  earned_rwf: "up",
  remitted_rwf: "up",
  outstanding_cash_rwf: "down",
};

const finishedOf = (s: Summary) => s.completed + s.cancelled_by_passenger + s.cancelled_by_rider + s.no_riders + s.no_show;
const rateOf = (s: Summary) => (finishedOf(s) > 0 ? Math.round((s.completed / finishedOf(s)) * 100) : 0);

/**
 * §88: the day in numbers - with the six days before it, so every figure
 * says which way it is going - and a workbook of the day and its week for
 * whoever keeps the books.
 */
export function Reports() {
  const [day, setDay] = useState(kigaliToday());
  const [week, setWeek] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWeek(null);
    setError(null);
    const days = Array.from({ length: 7 }, (_, i) => minusDays(day, 6 - i));
    Promise.all(days.map((d) => rpc<Summary>("staff_day_summary", { p_day: d })))
      .then(setWeek)
      .catch((e: Error) => setError(e.message));
  }, [day]);

  const s = week ? week[week.length - 1]! : null;
  const prev = week ? week[week.length - 2]! : null;

  const [making, setMaking] = useState(false);
  // A styled Excel workbook; ExcelJS is fetched only now, on the first download.
  const download = async () => {
    if (!week || !s) return;
    setMaking(true);
    try {
      const { reportWorkbook } = await import("../lib/reportBook");
      const measures = ROWS.flatMap(([key, label, kind]) => {
        const row = { key, label: label.replace(" (RWF)", ""), format: kind, better: BETTER[key] };
        return key === "completed" ? [row, { key: "rate", label: "Requests that became a ride", format: "percent" as const, better: BETTER.rate }] : [row];
      });
      const days = week.map((d) => ({ day: d.day, values: { ...ROWS.reduce((v, [k]) => ({ ...v, [k]: Number(d[k]) }), {}), rate: rateOf(d) / 100 } }));
      const blob = await reportWorkbook(days, measures);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nova-report-${s.day}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be made. Try again.");
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">One day at a time in Kigali time, with the week before it for comparison.</p>
        </div>
        <div className="spacer" />
        <input className="input" type="date" value={day} max={kigaliToday()} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
        <button className="btn secondary" onClick={() => void download()} disabled={!s || making}>
          <Icon name="download" size={16} /> {making ? "Preparing report..." : "Download report"}
        </button>
      </div>

      {error ? <div className="notice bad">{error}</div> : null}

      {!s || !prev || !week ? (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <Skeleton w={120} h={14} />
              <Skeleton w={150} h={34} r={10} />
              <Skeleton w={100} h={12} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              icon="check"
              tint="green"
              label="Trips completed"
              value={<Odometer value={s.completed} />}
              delta={s.completed - prev.completed}
              trend={week.map((w) => w.completed)}
            />
            <Kpi
              icon="trend"
              tint="blue"
              label="Requests that became a ride"
              value={<Odometer value={rateOf(s)} delay={80} />}
              unit="%"
              delta={rateOf(s) - rateOf(prev)}
              trend={week.map(rateOf)}
            />
            <Kpi
              icon="cash"
              tint="yellow"
              label="Fares collected"
              value={<Odometer value={money(s.collected_rwf)} delay={160} />}
              unit="RWF"
              delta={s.collected_rwf - prev.collected_rwf}
              trend={week.map((w) => w.collected_rwf)}
            />
            <Kpi
              icon="wallet"
              tint={s.outstanding_cash_rwf > 0 ? "amber" : "green"}
              label="Cash still out with riders"
              value={<Odometer value={money(s.outstanding_cash_rwf)} delay={240} />}
              unit="RWF"
              better="down"
              note="All days, not only this one"
            />
          </div>

          <div className="grid cols-wide" style={{ marginBottom: 16 }}>
            <section className="card">
              <div className="card-head">
                <h2>
                  <Icon name="chart" size={18} style={{ color: "var(--accent)" }} /> The last seven days
                </h2>
                <div className="spacer" />
                <span className="row small muted" style={{ gap: 14 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="swatch" style={{ background: "var(--accent)" }} /> Completed
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="swatch" style={{ background: "var(--hairline)" }} /> Did not happen
                  </span>
                </span>
              </div>
              <DayBars
                days={week.map((w) => ({ label: weekday(w.day), done: w.completed, lost: finishedOf(w) - w.completed }))}
                highlight={week.length - 1}
              />
            </section>

            <section className="card">
              <div className="card-head">
                <h2>
                  <Icon name="route" size={18} style={{ color: "var(--accent)" }} /> How the day's requests ended
                </h2>
              </div>
              <Donut
                label="requests"
                parts={[
                  { label: "Completed", value: s.completed, color: "var(--good)" },
                  { label: "Cancelled by passenger", value: s.cancelled_by_passenger, color: "var(--highlight)" },
                  { label: "Cancelled by rider", value: s.cancelled_by_rider, color: "var(--warn)" },
                  { label: "No rider found", value: s.no_riders, color: "var(--accent)" },
                  { label: "Passenger no-show", value: s.no_show, color: "var(--bad)" },
                ]}
              />
            </section>
          </div>

          <div className="grid cols-2">
            <section className="card">
              <div className="card-head">
                <h2>
                  <Icon name="wallet" size={18} style={{ color: "var(--warn)" }} /> Money on the day
                </h2>
              </div>
              <MoneyBars
                rows={[
                  { label: "Fares collected", value: s.collected_rwf, color: "var(--accent)" },
                  { label: "Rider earnings", value: s.earned_rwf, color: "var(--good)" },
                  { label: "Cash handed in", value: s.remitted_rwf, color: "var(--highlight)" },
                ]}
              />
              <p className="small muted" style={{ margin: "14px 0 0" }}>
                Fares are company money from the moment a rider takes them. What is not handed in stays on the rider's balance until it is.
              </p>
            </section>

            <section className="card" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 18 }}>Every figure for {new Date(`${s.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}</th>
                    <th className="right" style={{ paddingRight: 18 }}>
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([k, label, kind]) => (
                    <tr key={k}>
                      <td style={{ paddingLeft: 18 }}>{label}</td>
                      <td className="right num" style={{ paddingRight: 18 }}>
                        {kind === "money" ? money(s[k] as number) : s[k]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function MoneyBars({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ gap: 16 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>{r.label}</span>
            <strong className="num" style={{ fontSize: 17 }}>
              {money(r.value)} <span className="small muted">RWF</span>
            </strong>
          </div>
          <div style={{ height: 12, borderRadius: 6, background: "var(--ground)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 6, background: r.color, transition: "width 600ms var(--ease-out)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

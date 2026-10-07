import { useCallback, useEffect, useState } from "react";
import { kigaliDateTime, rpc, type Staff } from "../lib/supabase";
import { Flash } from "../components/ui";
import { Empty } from "../components/kit";

type Role = "primary" | "preferred" | "backup";

interface Schedule {
  id: string;
  passenger: string;
  phone: string | null;
  class: "moto" | "cab" | "cab_xl";
  pickup: string;
  dropoff: string;
  days: number[];
  time: string;
  start: string;
  end: string;
  riders: Partial<Record<Role, { id: string; name: string; vest: string | null }>>;
  rides: { id: string; at: string; state: string; moved: boolean; rider_id: string | null; rider: string | null; by_staff: boolean }[];
}

interface RiderOption {
  id: string;
  name: string;
  vest: string | null;
  plate: string;
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const days = (d: number[]) =>
  d.length === 7 ? "Every day" : d.join() === "1,2,3,4,5" ? "Weekdays" : d.map((x) => DAY[x]).join(", ");

const ROLES: { role: Role; label: string; help: string }[] = [
  { role: "primary", label: "Primary", help: "Planned for every ride, offered first" },
  { role: "preferred", label: "Preferred", help: "Offered next" },
  { role: "backup", label: "Backup", help: "Offered after that" },
];

/**
 * NOVA §13. Operations plans who takes a passenger's regular trip. It is a
 * plan: dispatch offers the ride to these riders first if they are online and
 * free, then carries on to the nearest riders. Nobody is guaranteed.
 */
export function Regular({ staff: _staff }: { staff: Staff }) {
  const [list, setList] = useState<Schedule[] | null>(null);
  const [riders, setRiders] = useState<Record<string, RiderOption[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc<Schedule[]>("staff_regular_trips")
      .then(async (l) => {
        setList(l);
        const classes = [...new Set(l.map((s) => s.class))];
        const entries = await Promise.all(classes.map(async (c) => [c, await rpc<RiderOption[]>("staff_riders_for_class", { p_class: c })] as const));
        setRiders(Object.fromEntries(entries));
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(label);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  const nameOf = (cls: string, id: string | null) => (riders[cls] ?? []).find((r) => r.id === id)?.name ?? "the nearest rider";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Regular trips</h1>
          <p className="sub">Plan who takes each passenger's regular ride. Planned riders are offered it first; nobody is guaranteed it.</p>
        </div>
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      <Flash message={done} onShown={() => setDone(null)} />

      {list && list.length === 0 ? (
        <div className="card">
          <Empty icon="repeat" title="No regular trips running" body="They appear here when a passenger books the same ride on set days - a school run, a commute." />
        </div>
      ) : null}

      <div className="stack" style={{ gap: 16 }}>
        {(list ?? []).map((s) => (
          <section key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {s.passenger}, {days(s.days)} at {s.time}
                </h2>
                <div className="small muted">
                  {s.pickup} to {s.dropoff}, {s.class === "moto" ? "Moto" : s.class === "cab" ? "Cab" : "Cab XL"}, until {s.end}
                  {s.phone ? (
                    <>
                      {", "}
                      <a href={`tel:${s.phone}`}>{s.phone}</a>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid cols-3" style={{ marginTop: 12 }}>
              {ROLES.map(({ role, label, help }) => (
                <div key={role} className="field">
                  <label htmlFor={`${s.id}-${role}`}>
                    {label}
                    <span className="muted small" style={{ display: "block", fontWeight: 400 }}>
                      {help}
                    </span>
                  </label>
                  <select
                    id={`${s.id}-${role}`}
                    className="select"
                    value={s.riders[role]?.id ?? ""}
                    onChange={(e) => {
                      const rider = e.target.value || null;
                      void act(
                        `${label} rider for ${s.passenger}: ${rider ? nameOf(s.class, rider) : "none"}.${role === "primary" ? ` ${s.passenger} has been told.` : ""}`,
                        () => rpc("staff_set_schedule_rider", { p_schedule_id: s.id, p_role: role, p_rider_id: rider }),
                      );
                    }}
                  >
                    <option value="">None</option>
                    {(riders[s.class] ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.vest ? ` (${r.vest})` : ""}, {r.plate}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Next rides</th>
                  <th>Planned rider</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.rides.slice(0, 7).map((r) => (
                  <tr key={r.id}>
                    <td>
                      {kigaliDateTime(r.at)}
                      {r.moved ? <span className="chip warn" style={{ marginLeft: 8 }}>Moved by passenger</span> : null}
                      {r.state !== "scheduled" ? <span className="chip accent" style={{ marginLeft: 8 }}>Finding a rider</span> : null}
                    </td>
                    <td>
                      <select
                        className="select"
                        aria-label={`Rider for ${kigaliDateTime(r.at)}`}
                        value={r.rider_id ?? ""}
                        disabled={r.state === "offered"}
                        onChange={(e) => {
                          const rider = e.target.value || null;
                          void act(`${kigaliDateTime(r.at)} is now planned for ${nameOf(s.class, rider)}. ${s.passenger} has been told.`, () =>
                            rpc("staff_reassign_ride", { p_trip_id: r.id, p_rider_id: rider }),
                          );
                        }}
                      >
                        <option value="">Nearest available</option>
                        {(riders[s.class] ?? []).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} {o.vest ? `(${o.vest})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="small muted">{r.by_staff ? "Changed for this ride" : ""}</td>
                  </tr>
                ))}
                {s.rides.length === 0 ? (
                  <tr>
                    <td className="muted" colSpan={3}>
                      No rides booked in the next few days.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

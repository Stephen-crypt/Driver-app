import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { can, kigaliDateTime, money, rpc, type Staff } from "../lib/supabase";
import { Flash, Odometer, Skeleton } from "../components/ui";
import { Empty, Kpi } from "../components/kit";

// Promo codes (0064-0066). Passengers add a code in the app; a ride it fits
// costs them less and Nova pays the difference - the rider still earns on the
// full fare. Operations make and pause codes; finance reads them.

type Kind = "amount" | "percent";
type Status = "active" | "paused" | "used_up" | "ended" | "not_started";
type VehicleClass = "moto" | "cab" | "cab_xl";

interface PromoRow {
  id: string;
  code: string;
  kind: Kind;
  amount_rwf: number | null;
  percent: number | null;
  max_discount_rwf: number | null;
  min_fare_rwf: number | null;
  vehicle_classes: VehicleClass[] | null;
  per_passenger_limit: number;
  total_limit: number | null;
  starts_at: string;
  ends_at: string | null;
  paused: boolean;
  note: string | null;
  batch_id: string | null;
  created_at: string;
  uses: number;
  cost_rwf: number;
  status: Status;
}

interface PromoTrip {
  trip_id: string;
  created_at: string;
  state: string;
  passenger_name: string | null;
  phone_tail: string | null;
  discount_rwf: number | null;
}

const CLASSES: readonly [VehicleClass, string][] = [
  ["moto", "Moto"],
  ["cab", "Cab"],
  ["cab_xl", "Cab XL"],
];

const STATUS: Record<Status, [string, string]> = {
  active: ["Active", "good"],
  paused: ["Paused", "warn"],
  used_up: ["Used up", ""],
  ended: ["Ended", ""],
  not_started: ["Not started", "accent"],
};

const TRIP_STATE: Record<string, string> = {
  completed: "Finished",
  scheduled: "Booked ahead",
  requested: "Finding a rider",
  offered: "Finding a rider",
  accepted: "Rider on the way",
  arrived: "Rider at pickup",
  in_progress: "On the ride",
};

const discount = (p: Pick<PromoRow, "kind" | "amount_rwf" | "percent" | "max_discount_rwf">) =>
  p.kind === "amount"
    ? `${money(p.amount_rwf)} RWF off`
    : p.max_discount_rwf
      ? `${p.percent}% off, up to ${money(p.max_discount_rwf)}`
      : `${p.percent}% off`;

const finished = (s: Status) => s === "ended" || s === "used_up";

// The characters the server makes codes from: nothing that reads as another.
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const madeUpCode = () => `NV-${Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("")}`;

// datetime-local has no zone; staff mean Kigali time.
const kigali = (local: string) => (local ? new Date(`${local}:00+02:00`).toISOString() : null);

export function Promotions({ staff }: { staff: Staff }) {
  const [rows, setRows] = useState<PromoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [making, setMaking] = useState<"one" | "batch" | null>(null);
  const [batchCodes, setBatchCodes] = useState<string[] | null>(null);
  const [view, setView] = useState<"current" | "finished">("current");
  const [open, setOpen] = useState<string | null>(null);
  const canMake = can(staff.role, "operations");

  const load = useCallback(() => {
    rpc<PromoRow[]>("staff_promos").then(setRows).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(label);
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      return false;
    }
  };

  // A batch shows as one line: its codes share their rules.
  const lines = useMemo(() => {
    const out: { key: string; codes: PromoRow[] }[] = [];
    const batches = new Map<string, PromoRow[]>();
    for (const r of rows ?? []) {
      if (!r.batch_id) out.push({ key: r.id, codes: [r] });
      else if (batches.has(r.batch_id)) batches.get(r.batch_id)!.push(r);
      else {
        const list = [r];
        batches.set(r.batch_id, list);
        out.push({ key: r.batch_id, codes: list });
      }
    }
    return out.filter((l) => (view === "finished") === l.codes.every((c) => finished(c.status)));
  }, [rows, view]);

  const all = rows ?? [];
  const active = all.filter((r) => r.status === "active");
  const uses = all.reduce((s, r) => s + r.uses, 0);
  const cost = all.reduce((s, r) => s + r.cost_rwf, 0);
  const paused = all.filter((r) => r.status === "paused").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Promotions</h1>
          <p className="sub">
            Codes passengers add in the app to pay less for a ride. Nova pays the difference: the rider collects the lower price and still earns on the full fare.
          </p>
        </div>
        {canMake ? (
          <div className="row">
            <button className="btn" onClick={() => { setMaking("one"); setBatchCodes(null); }}>
              New code
            </button>
            <button className="btn secondary" onClick={() => { setMaking("batch"); setBatchCodes(null); }}>
              Make a batch
            </button>
          </div>
        ) : null}
      </div>

      {rows ? (
        <div className="kpi-grid">
          <Kpi icon="tag" tint="green" label="Codes in use" value={<Odometer value={active.length} />} note={`${active.filter((r) => r.batch_id).length} of them from batches`} />
          <Kpi icon="moto" tint="blue" label="Rides with a code" value={<Odometer value={uses} delay={80} />} note="Booked, under way or finished" />
          <Kpi icon="cash" tint="yellow" label="Cost to Nova" value={<Odometer value={money(cost)} delay={160} />} unit="RWF" note="On finished rides" />
          <Kpi icon="clock" tint={paused > 0 ? "amber" : "blue"} label="Paused" value={<Odometer value={paused} delay={240} />} note="Not taken on new rides" />
        </div>
      ) : (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <Skeleton w={120} h={14} />
              <Skeleton w={80} h={34} r={10} />
            </div>
          ))}
        </div>
      )}

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      <Flash message={done} onShown={() => setDone(null)} />

      {making && canMake ? (
        <MakeCodes
          mode={making}
          onMode={(m) => { setMaking(m); setBatchCodes(null); }}
          onClose={() => setMaking(null)}
          onMakeOne={(args, label) => act(label, () => rpc("staff_create_promo", args))}
          onMakeBatch={(args, count) =>
            act(`${count} single-use codes made. Copy them below.`, async () => {
              const out = await rpc<{ code: string }[]>("staff_create_promo_batch", args);
              setBatchCodes(out.map((r) => r.code));
            })
          }
        />
      ) : null}

      {batchCodes ? <BatchResult codes={batchCodes} onDone={() => { setBatchCodes(null); setMaking(null); }} /> : null}

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Codes</h2>
          <div className="tabs" role="tablist">
            {(["current", "finished"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {v === "current" ? "Current" : "Ended and used up"}
              </button>
            ))}
          </div>
        </div>

        {rows && lines.length === 0 ? (
          view === "current" ? (
            <Empty icon="tag" title="No codes yet" body={canMake ? "Make a code to share, or a batch of single-use codes to hand out one each." : "Operations make codes here."} />
          ) : (
            <Empty icon="tag" title="Nothing has ended yet" body="Codes move here when they end or every use is taken." />
          )
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th className="right">Uses</th>
                <th className="right">Cost</th>
                <th>Ends</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map(({ key, codes }) => {
                const first = codes[0]!;
                const batch = first.batch_id !== null;
                const isOpen = open === key;
                const used = codes.reduce((s, c) => s + c.uses, 0);
                const limit = batch ? codes.length : first.total_limit;
                const status: Status = batch
                  ? codes.every((c) => c.paused)
                    ? "paused"
                    : codes.every((c) => finished(c.status))
                      ? first.status
                      : first.status === "not_started"
                        ? "not_started"
                        : "active"
                  : first.status;
                return (
                  <Fragment key={key}>
                    <tr className="clickable" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                      <td>
                        {batch ? (
                          <span>
                            <strong>Batch of {codes.length}</strong> <span className="small muted">single-use</span>
                          </span>
                        ) : (
                          <span className="plate">{first.code}</span>
                        )}
                        {first.note ? <div className="small muted">{first.note}</div> : null}
                      </td>
                      <td>{discount(first)}</td>
                      <td className="right num">
                        {used}
                        {limit ? <span className="small muted"> / {limit}</span> : null}
                      </td>
                      <td className="right num">{money(codes.reduce((s, c) => s + c.cost_rwf, 0))}</td>
                      <td className="small">{first.ends_at ? kigaliDateTime(first.ends_at) : <span className="muted">No end</span>}</td>
                      <td>
                        <span className={`chip ${STATUS[status][1]}`}>
                          {status === "not_started" ? `Starts ${kigaliDateTime(first.starts_at)}` : STATUS[status][0]}
                        </span>
                      </td>
                      <td className="right" onClick={(e) => e.stopPropagation()}>
                        {canMake && !batch && !finished(first.status) ? (
                          <button
                            className="btn secondary small"
                            onClick={() =>
                              void act(first.paused ? `${first.code} is on again.` : `${first.code} is paused. Rides already booked keep it.`, () =>
                                rpc("staff_set_promo_paused", { p_id: first.id, p_paused: !first.paused }),
                              )
                            }
                          >
                            {first.paused ? "Resume" : "Pause"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--ground)" }}>
                          {batch ? (
                            <BatchDetail codes={codes} canPause={canMake} onPause={(c) => act(c.paused ? `${c.code} is on again.` : `${c.code} is paused.`, () => rpc("staff_set_promo_paused", { p_id: c.id, p_paused: !c.paused }))} />
                          ) : (
                            <CodeDetail promo={first} />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!rows
                ? [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={7}>
                        <Skeleton h={18} />
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** The rules a code carries, in words. */
function Rules({ promo }: { promo: PromoRow }) {
  const parts = [
    promo.per_passenger_limit === 1 ? "Once per passenger" : `${promo.per_passenger_limit} times per passenger`,
    promo.vehicle_classes ? `${promo.vehicle_classes.map((c) => CLASSES.find(([k]) => k === c)?.[1]).join(", ")} only` : "Every vehicle type",
    promo.min_fare_rwf ? `Rides from ${money(promo.min_fare_rwf)} RWF` : null,
    `From ${kigaliDateTime(promo.starts_at)}`,
    `Made ${kigaliDateTime(promo.created_at)}`,
  ].filter(Boolean);
  return <p className="small muted" style={{ margin: "0 0 10px" }}>{parts.join(". ")}.</p>;
}

function CodeDetail({ promo }: { promo: PromoRow }) {
  const [trips, setTrips] = useState<PromoTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc<PromoTrip[]>("staff_promo_trips", { p_id: promo.id }).then(setTrips).catch((e: Error) => setError(e.message));
  }, [promo.id]);

  return (
    <div style={{ padding: "4px 4px 8px" }}>
      <Rules promo={promo} />
      {error ? <div className="notice bad">{error}</div> : null}
      {trips && trips.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No rides have used it yet.</p> : null}
      {trips && trips.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Passenger</th>
              <th>Ride</th>
              <th className="right">Took off</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.trip_id}>
                <td className="small">
                  <Link to={`/trips/${t.trip_id}`}>{kigaliDateTime(t.created_at)}</Link>
                </td>
                <td>
                  {t.passenger_name ?? "Passenger"} <span className="small muted">…{t.phone_tail}</span>
                </td>
                <td className="small">{TRIP_STATE[t.state] ?? "Cancelled"}</td>
                <td className="right num">{money(t.discount_rwf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!trips && !error ? <Skeleton h={18} /> : null}
    </div>
  );
}

function BatchDetail({ codes, canPause, onPause }: { codes: PromoRow[]; canPause: boolean; onPause: (c: PromoRow) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ padding: "4px 4px 8px" }}>
      <Rules promo={codes[0]!} />
      <div className="row" style={{ marginBottom: 10 }}>
        <button
          className="btn secondary small"
          onClick={() => {
            void navigator.clipboard.writeText(codes.map((c) => c.code).join("\n")).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : `Copy all ${codes.length}`}
        </button>
        <span className="small muted">{codes.filter((c) => c.uses > 0).length} of {codes.length} used</span>
      </div>
      <div className="promo-codes">
        {codes.map((c) => (
          <span key={c.id} className={`promo-code${c.uses > 0 ? " used" : ""}${c.paused ? " paused" : ""}`}>
            <span className="plate">{c.code}</span>
            {canPause && c.uses === 0 && !finished(c.status) ? (
              <button className="link-button small" onClick={() => onPause(c)}>
                {c.paused ? "Resume" : "Pause"}
              </button>
            ) : (
              <span className="small muted">{c.uses > 0 ? "Used" : STATUS[c.status][0]}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function BatchResult({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>{codes.length} new codes</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Each one works once, for one passenger. They are also listed under the batch below.</p>
      <textarea className="textarea" readOnly rows={Math.min(10, codes.length)} value={text} style={{ width: "100%", fontFamily: "var(--num)", letterSpacing: 1 }} onFocus={(e) => e.currentTarget.select()} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy all"}
        </button>
        <button className="btn secondary" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  );
}

function MakeCodes({
  mode,
  onMode,
  onClose,
  onMakeOne,
  onMakeBatch,
}: {
  mode: "one" | "batch";
  onMode: (m: "one" | "batch") => void;
  onClose: () => void;
  onMakeOne: (args: Record<string, unknown>, label: string) => Promise<boolean>;
  onMakeBatch: (args: Record<string, unknown>, count: number) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [count, setCount] = useState("50");
  const [kind, setKind] = useState<Kind>("amount");
  const [amount, setAmount] = useState("500");
  const [percent, setPercent] = useState("20");
  const [cap, setCap] = useState("");
  const [minFare, setMinFare] = useState("");
  const [classes, setClasses] = useState<VehicleClass[]>([]);
  const [perPerson, setPerPerson] = useState("1");
  const [total, setTotal] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const value = kind === "amount" ? num(amount) : num(percent);
  const n = Number(count);
  const problem =
    !value || value <= 0
      ? kind === "amount" ? "Enter the amount it takes off." : "Enter the percentage it takes off."
      : kind === "percent" && value > 100
        ? "A percentage can't be more than 100."
        : mode === "batch" && (!Number.isInteger(n) || n < 1 || n > 200)
          ? "A batch is 1 to 200 codes."
          : mode === "one" && code.trim() !== "" && code.replace(/[^A-Za-z0-9]/g, "").length < 4
            ? "A code needs at least four letters or numbers."
            : ends && kigali(ends)! <= (kigali(starts) ?? new Date().toISOString())
              ? "The end has to be after the start."
              : null;

  const rules = {
    p_kind: kind,
    p_amount_rwf: kind === "amount" ? value : null,
    p_percent: kind === "percent" ? value : null,
    p_max_discount_rwf: kind === "percent" ? num(cap) : null,
    p_min_fare_rwf: num(minFare),
    p_vehicle_classes: classes.length > 0 && classes.length < CLASSES.length ? classes : null,
    p_starts_at: kigali(starts),
    p_ends_at: kigali(ends),
    p_note: note.trim() || null,
  };
  const label = kind === "amount" ? `${money(value)} RWF off` : `${value}% off${num(cap) ? `, up to ${money(num(cap))}` : ""}`;

  const submit = async () => {
    setSaving(true);
    const ok =
      mode === "one"
        ? await onMakeOne(
            { ...rules, p_code: code.trim() || null, p_per_passenger_limit: num(perPerson) ?? 1, p_total_limit: num(total) },
            `${code.trim() ? code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") : "A new code"} is live: ${label}.`,
          )
        : await onMakeBatch({ ...rules, p_count: n }, n);
    setSaving(false);
    if (ok && mode === "one") onClose();
  };

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "one"} className={mode === "one" ? "on" : ""} onClick={() => onMode("one")}>
            One code to share
          </button>
          <button role="tab" aria-selected={mode === "batch"} className={mode === "batch" ? "on" : ""} onClick={() => onMode("batch")}>
            A batch to hand out
          </button>
        </div>
        <button className="link-button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="promo-form">
        {mode === "one" ? (
          <div className="field wide">
            <label htmlFor="pc-code">Code</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="pc-code" className="input" placeholder="e.g. NOVA50" value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ fontFamily: "var(--num)", letterSpacing: 1, flex: 1 }} />
              <button type="button" className="btn secondary small" onClick={() => setCode(madeUpCode())}>
                Make one up
              </button>
            </div>
            <span className="field-note">Passengers can type it in any case, with or without spaces.</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="pc-count">How many codes</label>
            <input id="pc-count" className="input num" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />
            <span className="field-note">Up to 200. Each works once, for one passenger.</span>
          </div>
        )}

        <div className="field wide">
          <label>Discount</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <div className="tabs" role="radiogroup">
              <button role="radio" aria-checked={kind === "amount"} className={kind === "amount" ? "on" : ""} onClick={() => setKind("amount")}>
                RWF off
              </button>
              <button role="radio" aria-checked={kind === "percent"} className={kind === "percent" ? "on" : ""} onClick={() => setKind("percent")}>
                % off
              </button>
            </div>
            {kind === "amount" ? (
              <input aria-label="Amount off in RWF" className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} style={{ width: 120 }} />
            ) : (
              <>
                <input aria-label="Percent off" className="input num" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, ""))} style={{ width: 80 }} />
                <input aria-label="Most it takes off, in RWF" className="input num" inputMode="numeric" placeholder="Up to (RWF)" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} style={{ width: 140 }} />
              </>
            )}
          </div>
          <span className="field-note">Off the ride fare only. Waiting time is still paid.</span>
        </div>

        {mode === "one" ? (
          <>
            <div className="field">
              <label htmlFor="pc-per">Uses per passenger</label>
              <input id="pc-per" className="input num" inputMode="numeric" value={perPerson} onChange={(e) => setPerPerson(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field">
              <label htmlFor="pc-total">Uses in all</label>
              <input id="pc-total" className="input num" inputMode="numeric" placeholder="No limit" value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} />
            </div>
          </>
        ) : null}

        <div className="field">
          <label htmlFor="pc-starts">Starts</label>
          <input id="pc-starts" type="datetime-local" className="input" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <span className="field-note">Empty means now.</span>
        </div>
        <div className="field">
          <label htmlFor="pc-ends">Ends</label>
          <input id="pc-ends" type="datetime-local" className="input" value={ends} onChange={(e) => setEnds(e.target.value)} />
          <span className="field-note">Empty means it runs until paused.</span>
        </div>
        <div className="field">
          <label htmlFor="pc-min">Smallest fare it works on</label>
          <input id="pc-min" className="input num" inputMode="numeric" placeholder="Any fare" value={minFare} onChange={(e) => setMinFare(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="field">
          <label>Vehicle types</label>
          <div className="row">
            {CLASSES.map(([k, l]) => (
              <label key={k} className="row small" style={{ gap: 6, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={classes.includes(k)}
                  onChange={(e) => setClasses(e.target.checked ? [...classes, k] : classes.filter((c) => c !== k))}
                />
                {l}
              </label>
            ))}
          </div>
          <span className="field-note">None ticked means every type.</span>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="pc-note">Private note</label>
          <input id="pc-note" className="input" placeholder="What it's for. Passengers never see this." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={problem !== null || saving} onClick={() => void submit()}>
          {mode === "one" ? "Make the code" : `Make ${Number.isInteger(n) && n > 0 ? n : ""} codes`}
        </button>
        {problem ? <span className="small" style={{ color: "var(--bad)" }}>{problem}</span> : <span className="small muted">{label}</span>}
      </div>
    </section>
  );
}

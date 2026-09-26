import { useCallback, useEffect, useMemo, useState } from "react";
import { quoteFare, type FarePolicy, type VehicleClass } from "@gera/core";
import { can, kigaliDateTime, money, rpc, type Staff, type StaffRole } from "../lib/supabase";

interface PolicyRow {
  id: string;
  vehicle_class: VehicleClass;
  base_rwf: number;
  per_km_rwf: number;
  per_minute_rwf: number;
  minimum_rwf: number;
  commission_pct: number;
  effective_from: string;
  effective_to: string | null;
  current: boolean;
}

type Settings = Record<string, number | boolean | string>;

const CLASS_NAME: Record<VehicleClass, string> = { moto: "Moto", cab: "Cab", cab_xl: "Cab XL" };

// Three trips people actually take, so a price change reads as money, not as
// a rate: a hop across Kimironko, Remera to town, and town to the airport.
const SAMPLE_TRIPS = [
  { label: "Short hop", km: 2, min: 7 },
  { label: "Remera to town", km: 6, min: 18 },
  { label: "Town to the airport", km: 11, min: 28 },
] as const;

interface SettingDef {
  key: string;
  label: string;
  help: string;
  role: StaffRole;
  /** Stored in seconds, shown and edited in minutes. */
  minutes?: boolean;
  unit?: string;
  bool?: boolean;
}

// The same roles as staff_update_setting. The database is the guard; this
// only avoids offering a field that would be refused.
const SETTINGS: { group: string; items: SettingDef[] }[] = [
  {
    group: "At the pickup",
    items: [
      { key: "wait_grace_seconds", label: "Free waiting", help: "How long a rider waits at the pickup before waiting is charged.", role: "operations", minutes: true, unit: "min" },
      { key: "wait_charge_per_minute_rwf", label: "Waiting charge", help: "Charged per whole minute after the free wait.", role: "finance", unit: "RWF / min" },
      { key: "require_ride_pin", label: "Ride PIN", help: "The passenger reads a 4-digit PIN to the rider before the trip can start.", role: "safety", bool: true },
      { key: "max_pin_attempts", label: "PIN attempts", help: "Wrong PINs allowed before the rider has to call the control room.", role: "operations" },
    ],
  },
  {
    group: "Riders",
    items: [
      { key: "max_cash_held_rwf", label: "Cash limit", help: "A rider holding more cash than this cannot go online until they hand it in.", role: "finance", unit: "RWF" },
      { key: "route_deviation_m", label: "Route alert margin", help: "How far off course a trip must go before it raises an alert. Small detours never do.", role: "safety", unit: "m" },
      { key: "speed_alert_kmh", label: "Speed alert", help: "A trip moving faster than this raises an alert in the control room.", role: "safety", unit: "km/h" },
    ],
  },
  {
    group: "Booking ahead",
    items: [
      { key: "schedule_min_lead_seconds", label: "Earliest booking", help: "How far ahead a scheduled ride must be booked.", role: "operations", minutes: true, unit: "min" },
      { key: "schedule_release_lead_seconds", label: "Dispatch starts", help: "How long before pickup a booked ride starts looking for a rider.", role: "operations", minutes: true, unit: "min" },
      { key: "schedule_max_days_ahead", label: "Furthest booking", help: "How many days ahead a single ride can be booked.", role: "operations", unit: "days" },
      { key: "recurring_max_days", label: "Regular trips run for", help: "The longest a regular trip can be set up for.", role: "operations", unit: "days" },
      { key: "recurring_horizon_days", label: "Regular trips booked ahead", help: "How many days of a regular trip exist as bookings at any time.", role: "operations", unit: "days" },
    ],
  },
];

const toPolicy = (r: PolicyRow): FarePolicy => ({
  vehicleClass: r.vehicle_class,
  baseRwf: r.base_rwf,
  perKmRwf: r.per_km_rwf,
  perMinuteRwf: r.per_minute_rwf,
  minimumRwf: r.minimum_rwf,
  commissionPct: Number(r.commission_pct),
});

export function Pricing({ staff }: { staff: Staff }) {
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    if (can(staff.role, "finance", "operations")) {
      rpc<PolicyRow[]>("staff_fare_policies").then(setPolicies).catch((e: Error) => setError(e.message));
    }
    rpc<Settings>("staff_settings").then(setSettings).catch((e: Error) => setError(e.message));
  }, [staff.role]);
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

  const current = (policies ?? []).filter((p) => p.current);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Prices & settings</h1>
          <p className="sub">A new price applies to trips quoted after it starts. Every trip already quoted keeps the price its passenger saw.</p>
        </div>
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {done ? <div className="notice good" style={{ marginBottom: 16 }}>{done}</div> : null}

      {policies ? (
        <div className="stack" style={{ gap: 16, marginBottom: 24 }}>
          {current.map((p) => (
            <PriceCard
              key={p.id}
              policy={p}
              canEdit={can(staff.role, "finance")}
              onSave={(next, from) =>
                act(`New ${CLASS_NAME[p.vehicle_class].toLowerCase()} price ${from ? `starts ${kigaliDateTime(from)}` : "is in force"}.`, () =>
                  rpc("staff_set_fare_policy", {
                    p_class: p.vehicle_class,
                    p_base_rwf: next.baseRwf,
                    p_per_km_rwf: next.perKmRwf,
                    p_per_minute_rwf: next.perMinuteRwf,
                    p_minimum_rwf: next.minimumRwf,
                    p_commission_pct: next.commissionPct,
                    p_effective_from: from,
                  }),
                )
              }
            />
          ))}
          <PriceHistory rows={policies} />
        </div>
      ) : null}

      {settings ? (
        <div className="grid cols-3">
          {SETTINGS.map((g) => (
            <section key={g.group} className="card">
              <h2>{g.group}</h2>
              <div className="stack" style={{ gap: 0 }}>
                {g.items.map((d) => (
                  <SettingRow
                    key={d.key}
                    def={d}
                    value={settings[d.key]!}
                    canEdit={can(staff.role, d.role)}
                    onSave={(v) => act(`${d.label} updated.`, () => rpc("staff_update_setting", { p_key: d.key, p_value: String(v) }))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const FIELDS = [
  ["baseRwf", "Base", "RWF"],
  ["perKmRwf", "Per km", "RWF"],
  ["perMinuteRwf", "Per minute", "RWF"],
  ["minimumRwf", "Minimum fare", "RWF"],
  ["commissionPct", "Gera's share", "%"],
] as const;

function PriceCard({
  policy,
  canEdit,
  onSave,
}: {
  policy: PolicyRow;
  canEdit: boolean;
  onSave: (next: FarePolicy, from: string | null) => Promise<boolean>;
}) {
  const now = useMemo(() => toPolicy(policy), [policy]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [saving, setSaving] = useState(false);

  const next: FarePolicy = {
    ...now,
    ...Object.fromEntries(
      Object.entries(draft)
        .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
        .map(([k, v]) => [k, Number(v)]),
    ),
  };
  const changed = FIELDS.some(([k]) => next[k] !== now[k]);
  const invalid = FIELDS.some(([k]) => next[k] < 0) || next.commissionPct > 90;

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{CLASS_NAME[policy.vehicle_class]}</h2>
        <span className="small muted">In force since {kigaliDateTime(policy.effective_from)}</span>
      </div>

      <div className="price-grid">
        {FIELDS.map(([k, label, unit]) => (
          <div key={k} className="field">
            <label htmlFor={`${policy.id}-${k}`}>
              {label} <span className="muted">({unit})</span>
            </label>
            <input
              id={`${policy.id}-${k}`}
              className={`input num${draft[k] !== undefined && next[k] !== now[k] ? " changed" : ""}`}
              inputMode="decimal"
              disabled={!canEdit}
              value={draft[k] ?? String(now[k])}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/[^\d.]/g, "") })}
            />
          </div>
        ))}
      </div>

      <table className="table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Trip</th>
            <th className="right">Passenger pays</th>
            <th className="right">Rider earns</th>
            {changed ? <th className="right">After the change</th> : null}
          </tr>
        </thead>
        <tbody>
          {SAMPLE_TRIPS.map((t) => {
            const a = quoteFare(now, t.km * 1000, t.min * 60);
            const b = quoteFare(next, t.km * 1000, t.min * 60);
            const earn = (fare: number, pct: number) => Math.round(fare * (1 - pct / 100));
            return (
              <tr key={t.label}>
                <td>
                  {t.label} <span className="small muted">{t.km} km, {t.min} min</span>
                </td>
                <td className="right num">{money(a)}</td>
                <td className="right num">{money(earn(a, now.commissionPct))}</td>
                {changed ? (
                  <td className="right num">
                    <strong>{money(b)}</strong>
                    <Delta by={b - a} />
                    <span className="small muted"> · rider {money(earn(b, next.commissionPct))}</span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit && changed ? (
        <div className="row" style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor={`${policy.id}-from`}>Starts</label>
            <input id={`${policy.id}-from`} type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="row" style={{ alignSelf: "flex-end" }}>
            <button
              className="btn"
              disabled={invalid || saving}
              onClick={async () => {
                setSaving(true);
                // datetime-local has no zone; staff mean Kigali time.
                const iso = from ? new Date(`${from}:00+02:00`).toISOString() : null;
                if (await onSave(next, iso)) {
                  setDraft({});
                  setFrom("");
                }
                setSaving(false);
              }}
            >
              {from ? "Schedule this price" : "Apply now"}
            </button>
            <button className="btn secondary" onClick={() => { setDraft({}); setFrom(""); }}>
              Discard
            </button>
          </div>
          {invalid ? <span className="small" style={{ color: "var(--bad)" }}>Prices can't be negative and Gera's share can't exceed 90%.</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function Delta({ by }: { by: number }) {
  if (by === 0) return null;
  return (
    <span className={`delta ${by > 0 ? "up" : "down"}`}>
      {by > 0 ? "+" : "−"}
      {money(Math.abs(by))}
    </span>
  );
}

function PriceHistory({ rows }: { rows: PolicyRow[] }) {
  const past = rows.filter((r) => !r.current);
  if (past.length === 0) return null;
  return (
    <section className="card">
      <h2>Earlier and scheduled prices</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Class</th>
            <th>From</th>
            <th>To</th>
            <th className="right">Base</th>
            <th className="right">Per km</th>
            <th className="right">Per min</th>
            <th className="right">Minimum</th>
            <th className="right">Share</th>
          </tr>
        </thead>
        <tbody>
          {past.map((r) => (
            <tr key={r.id}>
              <td>{CLASS_NAME[r.vehicle_class]}</td>
              <td className="small">{kigaliDateTime(r.effective_from)}</td>
              <td className="small">{r.effective_to ? kigaliDateTime(r.effective_to) : <span className="chip warn">Scheduled</span>}</td>
              <td className="right num">{money(r.base_rwf)}</td>
              <td className="right num">{money(r.per_km_rwf)}</td>
              <td className="right num">{money(r.per_minute_rwf)}</td>
              <td className="right num">{money(r.minimum_rwf)}</td>
              <td className="right num">{Number(r.commission_pct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SettingRow({
  def,
  value,
  canEdit,
  onSave,
}: {
  def: SettingDef;
  value: number | boolean | string;
  canEdit: boolean;
  onSave: (v: string | number | boolean) => Promise<boolean>;
}) {
  const shown = def.bool ? value : def.minutes ? Number(value) / 60 : Number(value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(shown));

  return (
    <div className="setting">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{def.label}</strong>
          {def.bool ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={value === true}
                disabled={!canEdit}
                onChange={(e) => {
                  if (!e.target.checked && !window.confirm("Turn off the ride PIN? Any rider could then start a trip with any passenger.")) return;
                  void onSave(e.target.checked);
                }}
              />
              <span>{value ? "On" : "Off"}</span>
            </label>
          ) : editing ? (
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const n = Number(text);
                if (!Number.isFinite(n)) return;
                if (await onSave(def.minutes ? Math.round(n * 60) : Math.round(n))) setEditing(false);
              }}
            >
              <input className="input num" style={{ width: 90 }} autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn small">Save</button>
              <button type="button" className="link-button" onClick={() => { setEditing(false); setText(String(shown)); }}>
                Cancel
              </button>
            </form>
          ) : (
            <span className="row" style={{ gap: 8 }}>
              <span className="num">
                {money(Number(shown))} <span className="small muted">{def.unit}</span>
              </span>
              {canEdit ? (
                <button className="link-button" onClick={() => { setText(String(shown)); setEditing(true); }}>
                  Change
                </button>
              ) : null}
            </span>
          )}
        </div>
        <div className="small muted">{def.help}</div>
      </div>
    </div>
  );
}

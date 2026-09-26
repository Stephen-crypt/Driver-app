import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { can, kigaliDateTime, money, rpc, supabase, type Staff } from "../lib/supabase";

interface Detail {
  id: string;
  name: string;
  phone: string | null;
  verification: string;
  notes: string | null;
  licence: string | null;
  national_id: string | null;
  joined: string;
  rating: number | null;
  rating_count: number;
  cash_held_rwf: number;
  net_owed_rwf: number;
  vehicle: { id: string; plate: string; class: string; vest: string | null } | null;
  documents: { kind: string; status: string; note: string | null; path: string; updated_at: string }[];
  ledger: { kind: string; amount_rwf: number; memo: string | null; created_at: string }[];
  shifts: { started_at: string; ended_at: string | null; condition: string | null; notes: string | null }[];
  reports: { id: string; kind: string; note: string; created_at: string; resolved: boolean }[];
}

interface Vehicle {
  vehicle_id: string;
  class: string;
  plate: string;
  vest: string | null;
  rider_id: string | null;
}

const DOC_NAME: Record<string, string> = {
  national_id: "National ID",
  driving_licence: "Driving licence",
  vehicle_registration: "Vehicle registration",
  insurance: "Insurance",
};

const LEDGER_NAME: Record<string, string> = {
  fare_collected: "Fare collected",
  trip_earning: "Trip earning",
  cash_remittance: "Cash handed in",
  payout: "Paid to rider",
  bonus: "Bonus",
  deduction: "Deduction",
};

export function RiderDetail({ staff }: { staff: Staff }) {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [depot, setDepot] = useState<Vehicle[]>([]);

  const reviewer = can(staff.role, "operations", "fleet", "safety");
  const finance = can(staff.role, "finance");
  const cashDesk = can(staff.role, "finance", "operations");
  const fleet = can(staff.role, "fleet", "operations");
  const suspender = can(staff.role, "operations", "safety");

  const load = useCallback(async () => {
    try {
      const detail = await rpc<Detail>("staff_rider_detail", { p_rider_id: id });
      setD(detail);
      if (reviewer) {
        // Signed for five minutes: long enough to look, short enough that a
        // link copied out of the dashboard stops working.
        const pairs = await Promise.all(
          detail.documents.map(async (doc) => {
            const { data } = await supabase.storage.from("rider-documents").createSignedUrl(doc.path, 300);
            return [doc.kind, data?.signedUrl ?? ""] as const;
          }),
        );
        setUrls(Object.fromEntries(pairs));
      }
      if (fleet) {
        const vs = await rpc<Vehicle[]>("staff_vehicles");
        setDepot(vs.filter((v) => !v.rider_id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this rider.");
    }
  }, [id, reviewer, fleet]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(label);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  };

  if (!d) return <div className="page">{error ? <div className="notice bad">{error}</div> : "Loading…"}</div>;

  const required = d.documents.filter((x) => x.kind === "national_id" || x.kind === "driving_licence");
  const allApproved = required.length === 2 && required.every((x) => x.status === "approved");

  return (
    <div className="page">
      <div className="page-head">
        {d.vehicle?.vest ? <span className="vest lg">{d.vehicle.vest}</span> : null}
        <div>
          <p className="sub" style={{ margin: 0 }}>
            <Link to="/riders">Riders</Link>
          </p>
          <h1>{d.name}</h1>
          <p className="sub">
            {d.phone} · joined {kigaliDateTime(d.joined)}
            {d.rating ? ` · ★ ${d.rating} from ${d.rating_count}` : ""}
          </p>
        </div>
        <div className="spacer" />
        {d.verification === "verified" ? (
          <span className="chip good">Verified</span>
        ) : d.verification === "rejected" ? (
          <span className="chip bad">Suspended</span>
        ) : (
          <span className="chip warn">Waiting for review</span>
        )}
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {done ? <div className="notice good" style={{ marginBottom: 16 }}>{done}</div> : null}

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="figure">
            {money(d.cash_held_rwf)}
            <small>RWF</small>
          </div>
          <div className="label">Company cash they are carrying</div>
        </div>
        <div className="card stat">
          <div className="figure" style={{ color: "var(--good)" }}>
            {money(d.net_owed_rwf)}
            <small>RWF</small>
          </div>
          <div className="label">Owed to them</div>
        </div>
        <div className="card stat">
          <div className="figure">{d.vehicle ? <span className="plate" style={{ fontSize: 26 }}>{d.vehicle.plate}</span> : "–"}</div>
          <div className="label">{d.vehicle ? `${d.vehicle.class} assigned` : "No vehicle assigned"}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="stack">
          <section className="card">
            <h2>Documents</h2>
            <div className="small muted" style={{ marginBottom: 12 }}>
              Licence {d.licence ?? "not given"} · National ID {d.national_id ?? "not given"}
            </div>
            <div className="docs">
              {required.map((doc) => (
                <DocCard
                  key={doc.kind}
                  doc={doc}
                  url={urls[doc.kind]}
                  canReview={reviewer}
                  onReview={(approve, note) =>
                    act(approve ? `${DOC_NAME[doc.kind]} approved.` : `${DOC_NAME[doc.kind]} sent back to the rider.`, () =>
                      rpc("staff_review_document", { p_rider_id: d.id, p_kind: doc.kind, p_approve: approve, p_note: note }),
                    )
                  }
                />
              ))}
              {required.length === 0 ? <div className="muted">Nothing uploaded yet.</div> : null}
            </div>
            {reviewer && d.verification !== "verified" ? (
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn" disabled={!allApproved} onClick={() => void act("Rider verified. They can start a shift once they have a vehicle.", () => rpc("staff_verify_rider", { p_rider_id: d.id }))}>
                  Verify rider
                </button>
                {!allApproved ? <span className="small muted">Approve the ID and licence first.</span> : null}
              </div>
            ) : null}
          </section>

          {fleet ? (
            <section className="card">
              <h2>Vehicle</h2>
              <AssignVehicle
                current={d.vehicle}
                depot={depot}
                onAssign={(vehicleId) => act("Vehicle assigned.", () => rpc("staff_assign_vehicle", { p_vehicle_id: vehicleId, p_rider_id: d.id }))}
                onReturn={() => d.vehicle && act("Vehicle returned to the depot.", () => rpc("staff_assign_vehicle", { p_vehicle_id: d.vehicle!.id, p_rider_id: null }))}
              />
            </section>
          ) : null}

          {suspender && d.verification === "verified" ? (
            <section className="card">
              <h2>Suspend</h2>
              <Suspend onSuspend={(reason) => act("Rider suspended and taken offline.", () => rpc("staff_suspend_rider", { p_rider_id: d.id, p_reason: reason }))} />
            </section>
          ) : null}
        </div>

        <div className="stack">
          {cashDesk || finance ? (
            <section className="card">
              <h2>Money</h2>
              <MoneyForms
                canRemit={cashDesk}
                canPay={finance}
                onRemit={(n, ref) => act(`${money(n)} RWF handed in, recorded.`, () => rpc("staff_record_remittance", { p_rider_id: d.id, p_amount_rwf: n, p_reference: ref }))}
                onPay={(n, ref) => act(`${money(n)} RWF paid out, recorded.`, () => rpc("staff_pay_rider", { p_rider_id: d.id, p_amount_rwf: n, p_reference: ref }))}
                onAdjust={(n, kind, reason) =>
                  act(`${kind === "bonus" ? "Bonus" : "Deduction"} of ${money(n)} RWF recorded.`, () =>
                    rpc("staff_adjust_earnings", { p_rider_id: d.id, p_amount_rwf: n, p_kind: kind, p_reason: reason }),
                  )
                }
              />
            </section>
          ) : null}

          <section className="card">
            <h2>Ledger</h2>
            <table className="table">
              <tbody>
                {d.ledger.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {LEDGER_NAME[l.kind] ?? l.kind}
                      {l.memo && !l.memo.startsWith("cash taken") && !l.memo.startsWith("earning on") ? <div className="small muted">{l.memo}</div> : null}
                    </td>
                    <td className="small muted">{kigaliDateTime(l.created_at)}</td>
                    <td className="right num">{money(l.amount_rwf)}</td>
                  </tr>
                ))}
                {d.ledger.length === 0 ? (
                  <tr>
                    <td className="muted">No entries yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Recent shifts</h2>
            {d.shifts.length === 0 ? (
              <div className="muted small">No shifts yet.</div>
            ) : (
              <table className="table">
                <tbody>
                  {d.shifts.map((s, i) => (
                    <tr key={i}>
                      <td>{kigaliDateTime(s.started_at)}</td>
                      <td>{s.ended_at ? kigaliDateTime(s.ended_at) : <span className="chip accent">On shift</span>}</td>
                      <td>
                        {s.condition === "needs_repair" ? (
                          <span className="chip bad">Needs repair</span>
                        ) : s.condition === "minor_issue" ? (
                          <span className="chip warn">Minor issue</span>
                        ) : s.condition ? (
                          <span className="chip good">Good</span>
                        ) : null}
                        {s.notes ? <div className="small muted">{s.notes}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {d.reports.length > 0 ? (
            <section className="card">
              <h2>Reports from this rider</h2>
              <div className="list">
                {d.reports.map((r) => (
                  <div key={r.id} className="list-item">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{r.kind.replace("_", " ")}</strong>
                      {r.resolved ? <span className="chip good">Resolved</span> : <span className="chip warn">Open</span>}
                    </div>
                    <div className="small">{r.note}</div>
                    <div className="small muted">{kigaliDateTime(r.created_at)}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {can(staff.role, "safety", "operations", "fleet", "inspector") && id ? <Inspections riderId={id} /> : null}
        </div>
      </div>
    </div>
  );
}

function DocCard({
  doc,
  url,
  canReview,
  onReview,
}: {
  doc: Detail["documents"][number];
  url: string | undefined;
  canReview: boolean;
  onReview: (approve: boolean, note: string | null) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="doc stack" style={{ gap: 8 }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={DOC_NAME[doc.kind]} />
        </a>
      ) : (
        <div className="placeholder">{canReview ? "No image" : "Hidden for your role"}</div>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{DOC_NAME[doc.kind]}</strong>
        <span className={`chip ${doc.status === "approved" ? "good" : doc.status === "rejected" ? "bad" : "warn"}`}>
          {doc.status === "pending" ? "To review" : doc.status}
        </span>
      </div>
      {doc.note ? <div className="small muted">“{doc.note}”</div> : null}
      {canReview && doc.status !== "approved" ? (
        rejecting ? (
          <div className="stack" style={{ gap: 6 }}>
            <input className="input" placeholder="What should they fix? They see this." value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            <div className="row">
              <button className="btn danger small" disabled={note.trim().length < 5} onClick={() => onReview(false, note.trim())}>
                Send back
              </button>
              <button className="btn secondary small" onClick={() => setRejecting(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn small" onClick={() => onReview(true, null)}>
              Approve
            </button>
            <button className="btn secondary small" onClick={() => setRejecting(true)}>
              Reject
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

function AssignVehicle({
  current,
  depot,
  onAssign,
  onReturn,
}: {
  current: Detail["vehicle"];
  depot: Vehicle[];
  onAssign: (vehicleId: string) => void;
  onReturn: () => void;
}) {
  const [choice, setChoice] = useState("");
  return (
    <div className="stack">
      {current ? (
        <div className="row">
          {current.vest ? <span className="vest">{current.vest}</span> : null}
          <span className="plate">{current.plate}</span>
          <span className="muted small">{current.class}</span>
          <div style={{ flex: 1 }} />
          <button className="btn secondary small" onClick={onReturn}>
            Return to depot
          </button>
        </div>
      ) : null}
      <div className="row">
        <select className="select" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ flex: 1 }}>
          <option value="">{depot.length ? (current ? "Swap for a depot vehicle…" : "Choose a depot vehicle…") : "No vehicles in the depot"}</option>
          {depot.map((v) => (
            <option key={v.vehicle_id} value={v.vehicle_id}>
              {v.plate} · {v.class}
              {v.vest ? ` · vest ${v.vest}` : ""}
            </option>
          ))}
        </select>
        <button className="btn small" disabled={!choice} onClick={() => onAssign(choice)}>
          Assign
        </button>
      </div>
      <div className="small muted">Not while the rider is on a shift. Their current vehicle goes back to the depot.</div>
    </div>
  );
}

function Suspend({ onSuspend }: { onSuspend: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="stack">
      <textarea className="textarea" placeholder="Why? This goes on the rider's record and in the audit log." value={reason} onChange={(e) => setReason(e.target.value)} />
      {confirm ? (
        <div className="row">
          <button className="btn danger" onClick={() => onSuspend(reason.trim())}>
            Yes, suspend now
          </button>
          <button className="btn secondary" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <span className="small muted">They go offline and their shift closes immediately.</span>
        </div>
      ) : (
        <div>
          <button className="btn danger" disabled={reason.trim().length < 5} onClick={() => setConfirm(true)}>
            Suspend rider
          </button>
        </div>
      )}
    </div>
  );
}

function MoneyForms({
  canRemit,
  canPay,
  onRemit,
  onPay,
  onAdjust,
}: {
  canRemit: boolean;
  canPay: boolean;
  onRemit: (n: number, ref: string) => void;
  onPay: (n: number, ref: string) => void;
  onAdjust: (n: number, kind: "bonus" | "deduction", reason: string) => void;
}) {
  const [kind, setKind] = useState<"remit" | "pay" | "bonus" | "deduction">(canRemit ? "remit" : "pay");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const n = Math.round(Number(amount));
  const ok = Number.isFinite(n) && n > 0 && ref.trim().length >= 3;
  const kinds = [
    ...(canRemit ? [["remit", "Cash handed in"] as const] : []),
    ...(canPay
      ? ([
          ["pay", "Pay out"],
          ["bonus", "Bonus"],
          ["deduction", "Deduction"],
        ] as const)
      : []),
  ];

  const submit = () => {
    if (!ok) return;
    if (kind === "remit") onRemit(n, ref.trim());
    else if (kind === "pay") onPay(n, ref.trim());
    else onAdjust(n, kind, ref.trim());
    setAmount("");
    setRef("");
  };

  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {kinds.map(([k, l]) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="row">
        <input className="input" inputMode="numeric" placeholder="Amount (RWF)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} style={{ width: 150 }} />
        <input
          className="input"
          placeholder={kind === "remit" || kind === "pay" ? "MoMo or receipt reference" : "Reason - the rider sees it"}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" disabled={!ok} onClick={submit}>
          Record
        </button>
      </div>
      <div className="small muted">
        {kind === "remit"
          ? "Reduces the cash they are carrying. Does not change what they are owed."
          : kind === "pay"
            ? "Reduces what they are owed. The reference must prove the money left."
            : "Changes what they are owed. The two numbers are never netted."}
      </div>
    </div>
  );
}

interface InspectionRow {
  id: string;
  created_at: string;
  inspector_name: string | null;
  plate: string | null;
  kind: "routine" | "random";
  result: "pass" | "advisory" | "fail";
  checks: Record<string, "pass" | "fail" | "na">;
  alcohol_result: string | null;
  alcohol_reading: number | null;
  notes: string | null;
  photos: string[];
  case_id: string | null;
}

const RESULT_CHIP = { pass: ["Passed", "good"], advisory: ["Advisory", "warn"], fail: ["Failed", "bad"] } as const;

/** NOVA §47, §48: what inspectors recorded, with the photos they took. */
function Inspections({ riderId }: { riderId: string }) {
  const [rows, setRows] = useState<InspectionRow[] | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    rpc<InspectionRow[]>("staff_inspections", { p_rider_id: riderId, p_limit: 20 })
      .then(async (r) => {
        setRows(r);
        const paths = r.flatMap((x) => x.photos);
        if (paths.length === 0) return;
        const { data } = await supabase.storage.from("inspection-photos").createSignedUrls(paths, 300);
        setPhotoUrls(Object.fromEntries((data ?? []).flatMap((u) => (u.signedUrl && u.path ? [[u.path, u.signedUrl] as const] : []))));
      })
      .catch(() => setRows([]));
  }, [riderId]);

  if (!rows || rows.length === 0) return null;
  return (
    <section className="card">
      <h2>Inspections</h2>
      <div className="list">
        {rows.map((r) => {
          const failed = Object.entries(r.checks).filter(([, v]) => v === "fail").map(([k]) => k.replace("_", " "));
          return (
            <div key={r.id} className="list-item" style={{ cursor: "default" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`chip ${RESULT_CHIP[r.result][1]}`}>{RESULT_CHIP[r.result][0]}</span>
                  <strong>{r.kind === "random" ? "Random check" : "Routine"}</strong>
                  {r.plate ? <span className="plate">{r.plate}</span> : null}
                </span>
                <span className="small muted">{kigaliDateTime(r.created_at)}</span>
              </div>
              <div className="small">
                {failed.length ? `Failed: ${failed.join(", ")}. ` : ""}
                {r.alcohol_result ? `Alcohol ${r.alcohol_result}${r.alcohol_reading !== null ? ` (${r.alcohol_reading} mg/L)` : ""}. ` : "No alcohol test. "}
                {r.notes ?? ""}
              </div>
              <div className="small muted">
                By {r.inspector_name ?? "an inspector"}
                {r.case_id ? (
                  <>
                    {" · "}
                    <Link to={`/cases/${r.case_id}`}>open the case</Link>
                  </>
                ) : null}
              </div>
              {r.photos.length > 0 ? (
                <div className="row" style={{ marginTop: 6 }}>
                  {r.photos.map((p) =>
                    photoUrls[p] ? (
                      <a key={p} href={photoUrls[p]} target="_blank" rel="noreferrer">
                        <img src={photoUrls[p]} alt="Inspection photo" className="thumb" />
                      </a>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

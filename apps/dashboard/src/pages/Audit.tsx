import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { kigaliDateTime, rpc } from "../lib/supabase";

interface Entry {
  id: number;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

const ACTION: Record<string, string> = {
  "sos.acknowledge": "Took an emergency",
  "sos.resolve": "Closed an emergency",
  "document.approve": "Approved a document",
  "document.reject": "Sent a document back",
  "rider.verify": "Verified a rider",
  "rider.suspend": "Suspended a rider",
  "cash.remittance": "Recorded cash handed in",
  "earnings.payout": "Paid a rider",
  "earnings.bonus": "Added a bonus",
  "earnings.deduction": "Took a deduction",
  "vehicle.create": "Added a vehicle",
  "vehicle.assign": "Assigned a vehicle",
  "vehicle.return": "Returned a vehicle",
  "report.resolve": "Resolved a report",
  "staff.grant": "Granted a staff role",
  "staff.role": "Changed a staff role",
  "staff.disable": "Disabled a staff account",
  "pricing.change": "Changed a price",
  "settings.change": "Changed a setting",
  "case.create": "Logged a call",
  "case.take": "Took a case",
  "case.resolve": "Resolved a case",
  "speed.review": "Reviewed a speed alert",
  "geo.review": "Reviewed a zone or route alert",
  "zone.create": "Drew a zone",
  "zone.update": "Changed a zone",
  "inspect.lookup": "Looked someone up",
  "inspection.record": "Recorded an inspection",
  "vehicle.qr_reissue": "Replaced a vehicle sticker",
  "schedule.rider": "Planned a regular trip's rider",
  "ride.reassign": "Reassigned a ride",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One value, readable: ids shortened, objects flattened, nothing as [object Object]. */
function show(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "string") return UUID.test(v) ? v.slice(0, 8) : v;
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null)
      .map(([k, x]) => `${k.replace(/_/g, " ")} ${show(x)}`)
      .join(", ");
  return String(v);
}

/** §89: every staff action, who took it and when. Read-only - nobody edits history. */
export function Audit() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc<Entry[]>("staff_audit_log", { p_limit: 300 })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const describe = (e: Entry) => {
    const d = e.detail ?? {};
    // A change reads as "what: before → after".
    const change = "from" in d || "to" in d ? `${e.action === "settings.change" && e.target_id ? `${e.target_id.replace(/_/g, " ")}: ` : ""}${show(d.from)} → ${show(d.to)}` : null;
    const rest = Object.entries(d)
      .filter(([k, v]) => v !== null && v !== "" && k !== "from" && k !== "to")
      .map(([k, v]) => `${k.replace("_rwf", "").replace(/_/g, " ")}: ${show(v)}`);
    return [change, ...rest].filter(Boolean).join("; ");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Every action taken from this dashboard or the staff script. It cannot be edited.</p>
        </div>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>When</th>
              <th>Who</th>
              <th>What</th>
              <th style={{ paddingRight: 16 }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((e) => (
              <tr key={e.id}>
                <td style={{ paddingLeft: 16, whiteSpace: "nowrap" }} className="small">
                  {kigaliDateTime(e.created_at)}
                </td>
                <td>{e.actor_name ?? "system"}</td>
                <td>
                  {e.target_type === "rider" && e.target_id ? <Link to={`/riders/${e.target_id}`}>{ACTION[e.action] ?? e.action}</Link> : ACTION[e.action] ?? e.action}
                </td>
                <td className="small muted" style={{ paddingRight: 16 }}>
                  {describe(e)}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 24 }}>
                  Nothing yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

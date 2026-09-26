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
};

/** §89: every staff action, who took it and when. Read-only - nobody edits history. */
export function Audit() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc<Entry[]>("staff_audit_log", { p_limit: 300 })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const describe = (e: Entry) =>
    Object.entries(e.detail)
      .filter(([k, v]) => v !== null && v !== "" && k !== "from" && k !== "to")
      .map(([k, v]) => `${k.replace("_rwf", "").replace("_", " ")}: ${v}`)
      .join(" · ");

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

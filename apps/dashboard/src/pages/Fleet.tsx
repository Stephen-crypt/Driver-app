import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { can, rpc, type Staff } from "../lib/supabase";

interface Vehicle {
  vehicle_id: string;
  class: string;
  plate: string;
  vest: string | null;
  is_active: boolean;
  rider_id: string | null;
  rider_name: string | null;
  in_use: boolean;
}

const CLASSES = [
  ["moto", "Moto"],
  ["cab", "Cab"],
  ["cab_xl", "Cab XL"],
] as const;

export function Fleet({ staff }: { staff: Staff }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cls, setCls] = useState<(typeof CLASSES)[number][0]>("moto");
  const [plate, setPlate] = useState("");
  const [vest, setVest] = useState("");

  const load = useCallback(() => {
    rpc<Vehicle[]>("staff_vehicles")
      .then(setVehicles)
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

  const assigned = (vehicles ?? []).filter((v) => v.rider_id);
  const depot = (vehicles ?? []).filter((v) => !v.rider_id);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Fleet</h1>
          <p className="sub">
            {vehicles ? `${assigned.length} with riders · ${depot.length} in the depot · ${assigned.filter((v) => v.in_use).length} out on shift` : "Loading…"}
          </p>
        </div>
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {done ? <div className="notice good" style={{ marginBottom: 16 }}>{done}</div> : null}

      {can(staff.role, "fleet") ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Add a vehicle</h2>
          <div className="row">
            <select className="select" value={cls} onChange={(e) => setCls(e.target.value as typeof cls)}>
              {CLASSES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input className="input" placeholder="Plate, e.g. RAD 123 B" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} style={{ width: 200 }} />
            {cls === "moto" ? (
              <input className="input" placeholder="Vest number" inputMode="numeric" value={vest} onChange={(e) => setVest(e.target.value.replace(/\D/g, ""))} style={{ width: 130 }} />
            ) : null}
            <button
              className="btn"
              disabled={plate.trim().length < 4}
              onClick={() =>
                void act(`${plate.trim()} added to the depot.`, async () => {
                  await rpc("staff_create_vehicle", { p_class: cls, p_plate: plate, p_vest: cls === "moto" ? vest : null });
                  setPlate("");
                  setVest("");
                })
              }
            >
              Add to depot
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid cols-2">
        <section className="card">
          <h2>With riders</h2>
          <table className="table">
            <tbody>
              {assigned.map((v) => (
                <tr key={v.vehicle_id}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {v.vest ? <span className="vest">{v.vest}</span> : null}
                      <span className="plate">{v.plate}</span>
                    </div>
                  </td>
                  <td className="small muted">{v.class}</td>
                  <td>
                    <Link to={`/riders/${v.rider_id}`}>{v.rider_name}</Link>
                  </td>
                  <td className="right">
                    {v.in_use ? (
                      <span className="chip accent">On shift</span>
                    ) : (
                      <button className="btn secondary small" onClick={() => void act(`${v.plate} returned to the depot.`, () => rpc("staff_assign_vehicle", { p_vehicle_id: v.vehicle_id, p_rider_id: null }))}>
                        Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {vehicles && assigned.length === 0 ? (
                <tr>
                  <td className="muted">No vehicles are out with riders.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>In the depot</h2>
          <table className="table">
            <tbody>
              {depot.map((v) => (
                <tr key={v.vehicle_id}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {v.vest ? <span className="vest">{v.vest}</span> : null}
                      <span className="plate">{v.plate}</span>
                    </div>
                  </td>
                  <td className="small muted">{v.class}</td>
                  <td className="right small muted">Assign from the rider's page</td>
                </tr>
              ))}
              {vehicles && depot.length === 0 ? (
                <tr>
                  <td className="muted">The depot is empty. Add a vehicle above.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

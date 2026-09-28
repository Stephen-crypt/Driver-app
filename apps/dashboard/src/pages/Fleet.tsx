import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { can, rpc, type Staff } from "../lib/supabase";
import { Flash, Skeleton, useUi } from "../components/ui";

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

/**
 * NOVA §32. A sticker for the vehicle: the QR inspectors scan, with the plate
 * and vest printed large so a person can check it without a phone. Opens a
 * page sized for printing; reprinting issues a new code and retires the old.
 */
async function printSticker(v: Vehicle, reissue: boolean) {
  const code = await rpc<string>("staff_vehicle_qr", { p_vehicle_id: v.vehicle_id, p_reissue: reissue });
  const svg = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) throw new Error("Allow pop-ups for this page to print stickers.");
  const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  w.document.write(`<!doctype html><title>${esc(v.plate)} sticker</title>
<style>
  @page { size: 80mm 110mm; margin: 0 }
  body { margin: 0; font-family: Barlow, system-ui, sans-serif; display: grid; place-items: center; height: 100vh; }
  .s { width: 72mm; border: 2px solid #0b0d12; border-radius: 6mm; padding: 5mm; text-align: center; }
  .q svg { width: 56mm; height: 56mm; }
  .p { font: 700 9mm/1 "Barlow Condensed", "Arial Narrow", sans-serif; letter-spacing: .5mm; margin-top: 2mm; }
  .v { display: inline-block; background: #0057e7; color: #fff; font: 700 7mm/1 "Barlow Condensed", sans-serif; padding: 1.5mm 3mm; border-radius: 2mm; margin-top: 2mm; }
  .t { font-size: 3.2mm; color: #5e6676; margin-top: 2mm; }
</style>
<div class="s"><div class="q">${svg}</div><div class="p">${esc(v.plate)}</div>${v.vest ? `<div class="v">${esc(v.vest)}</div>` : ""}<div class="t">Nova inspectors scan this to verify</div></div>
<script>setTimeout(() => print(), 300)</script>`);
  w.document.close();
}

export function Fleet({ staff }: { staff: Staff }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ui = useUi();
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
            {vehicles ? (
              `${assigned.length} with riders, ${depot.length} in the depot, ${assigned.filter((v) => v.in_use).length} out on shift`
            ) : (
              <Skeleton w={320} h={14} style={{ marginTop: 6 }} />
            )}
          </p>
        </div>
      </div>

      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      <Flash message={done} onShown={() => setDone(null)} />

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
                    <button className="link-button small" onClick={() => void act(`Sticker for ${v.plate} opened for printing.`, () => printSticker(v, false))}>
                      Sticker
                    </button>
                    <span className="gap" aria-hidden="true" />
                    <button
                      className="link-button small"
                      onClick={async () => {
                        const ok = await ui.confirm({
                          title: `Replace ${v.plate}'s sticker?`,
                          body: "A new code is printed and the old sticker stops working. Take it off the vehicle once the new one is on.",
                          confirmLabel: "Print a new sticker",
                          tone: "danger",
                        });
                        if (ok) void act(`New sticker for ${v.plate}. Remove the old one from the vehicle.`, () => printSticker(v, true));
                      }}
                    >
                      Replace
                    </button>
                  </td>
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
                  <td>
                    <button className="link-button small" onClick={() => void act(`Sticker for ${v.plate} opened for printing.`, () => printSticker(v, false))}>
                      Sticker
                    </button>
                    <span className="gap" aria-hidden="true" />
                    <button
                      className="link-button small"
                      onClick={async () => {
                        const ok = await ui.confirm({
                          title: `Replace ${v.plate}'s sticker?`,
                          body: "A new code is printed and the old sticker stops working. Take it off the vehicle once the new one is on.",
                          confirmLabel: "Print a new sticker",
                          tone: "danger",
                        });
                        if (ok) void act(`New sticker for ${v.plate}. Remove the old one from the vehicle.`, () => printSticker(v, true));
                      }}
                    >
                      Replace
                    </button>
                  </td>
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

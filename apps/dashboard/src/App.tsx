import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { can, supabase, useStaff, type Staff, type StaffRole } from "./lib/supabase";
import { Login } from "./pages/Login";
import { ControlRoom } from "./pages/ControlRoom";
import { Riders } from "./pages/Riders";
import { RiderDetail } from "./pages/RiderDetail";
import { Fleet } from "./pages/Fleet";
import { Trips } from "./pages/Trips";
import { TripDetail } from "./pages/TripDetail";
import { Reports } from "./pages/Reports";
import { Audit } from "./pages/Audit";
import { Cases } from "./pages/Cases";
import { Pricing } from "./pages/Pricing";
import { Zones } from "./pages/Zones";

interface Section {
  readonly to: string;
  readonly label: string;
  readonly roles: StaffRole[];
}

// Each section lists the roles that may open it. The database enforces the
// same thing on every call; this only keeps people out of pages that would
// refuse them.
const SECTIONS: Section[] = [
  { to: "/", label: "Control room", roles: ["control_room", "operations", "safety"] },
  { to: "/riders", label: "Riders", roles: ["operations", "fleet", "safety", "finance", "support"] },
  { to: "/fleet", label: "Fleet", roles: ["fleet", "operations"] },
  { to: "/trips", label: "Trips & people", roles: ["support", "operations", "control_room", "safety"] },
  { to: "/zones", label: "Zones", roles: ["control_room", "operations", "safety", "fleet"] },
  { to: "/cases", label: "Cases", roles: ["support", "operations", "safety", "control_room", "fleet"] },
  { to: "/reports", label: "Reports", roles: ["operations", "finance", "safety"] },
  { to: "/pricing", label: "Prices & settings", roles: ["finance", "operations", "safety"] },
  { to: "/audit", label: "Audit log", roles: ["operations", "safety", "finance"] },
];

export function App() {
  const { loading, session, staff } = useStaff();

  if (loading) return null;
  if (!session) return <Login />;
  if (!staff) return <NotStaff />;

  const allowed = SECTIONS.filter((s) => can(staff.role, ...s.roles));
  const home = allowed[0]?.to ?? "/";

  return (
    <div className="frame">
      <Nav staff={staff} sections={allowed} />
      <main style={{ overflow: "hidden", height: "100%" }}>
        <Routes>
          <Route path="/" element={guard(staff, SECTIONS[0]!, <ControlRoom staff={staff} />, home)} />
          <Route path="/riders" element={guard(staff, SECTIONS[1]!, <Riders />, home)} />
          <Route path="/riders/:id" element={guard(staff, SECTIONS[1]!, <RiderDetail staff={staff} />, home)} />
          <Route path="/fleet" element={guard(staff, SECTIONS[2]!, <Fleet staff={staff} />, home)} />
          <Route path="/trips" element={guard(staff, SECTIONS[3]!, <Trips />, home)} />
          <Route path="/trips/:id" element={guard(staff, SECTIONS[3]!, <TripDetail />, home)} />
          <Route path="/zones" element={guard(staff, SECTIONS[4]!, <Zones staff={staff} />, home)} />
          <Route path="/cases" element={guard(staff, SECTIONS[5]!, <Cases staff={staff} />, home)} />
          <Route path="/cases/:id" element={guard(staff, SECTIONS[5]!, <Cases staff={staff} />, home)} />
          <Route path="/reports" element={guard(staff, SECTIONS[6]!, <Reports />, home)} />
          <Route path="/pricing" element={guard(staff, SECTIONS[7]!, <Pricing staff={staff} />, home)} />
          <Route path="/audit" element={guard(staff, SECTIONS[8]!, <Audit />, home)} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function guard(staff: Staff, section: Section, page: ReactNode, home: string) {
  return can(staff.role, ...section.roles) ? page : <Navigate to={home} replace />;
}

const ROLE_NAME: Record<StaffRole, string> = {
  admin: "Administrator",
  operations: "Operations",
  control_room: "Control room",
  fleet: "Fleet",
  safety: "Safety",
  support: "Support",
  finance: "Finance",
};

function Nav({ staff, sections }: { staff: Staff; sections: Section[] }) {
  const alerts = useOpenAlertCount(can(staff.role, "control_room", "operations", "safety"));
  const cases = useOpenCaseCount(can(staff.role, "support", "operations", "safety", "control_room", "fleet"));
  return (
    <nav className="nav" aria-label="Sections">
      <div className="brand">
        <span className="vest">G</span>
        <div>
          <div className="brand-word">Gera</div>
          <div className="brand-sub">Control</div>
        </div>
      </div>
      {sections.map((s) => (
        <NavLink key={s.to} to={s.to} end={s.to === "/"}>
          {s.label}
          {s.to === "/" && alerts > 0 ? (
            <span className="count" aria-label={`${alerts} open emergency alerts`}>
              {alerts}
            </span>
          ) : null}
          {s.to === "/cases" && cases > 0 ? (
            <span className="count quiet" aria-label={`${cases} open cases`}>
              {cases}
            </span>
          ) : null}
        </NavLink>
      ))}
      <div className="nav-foot">
        <strong>{staff.name}</strong>
        {ROLE_NAME[staff.role]}
        <div style={{ marginTop: 8 }}>
          <button className="link-button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}

/** Open SOS alerts, kept live so the count shows on every page, not just one. */
function useOpenAlertCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const read = () =>
      supabase
        .from("sos_alerts")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null)
        .then(({ count: n }) => setCount(n ?? 0));
    void read();
    const channel = supabase
      .channel("nav-sos")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => void read())
      .subscribe();
    const id = setInterval(read, 20_000);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(id);
    };
  }, [enabled]);
  return count;
}

/** Cases nobody has resolved yet. Polled - a case is not an emergency. */
function useOpenCaseCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const read = () =>
      supabase
        .from("support_cases")
        .select("id", { count: "exact", head: true })
        .neq("status", "resolved")
        .then(({ count: n }) => setCount(n ?? 0));
    void read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, [enabled]);
  return count;
}

function NotStaff() {
  return (
    <div className="login">
      <div className="card stack">
        <h1>Not a staff account</h1>
        <p className="muted">
          This dashboard is for Gera staff. Ask an administrator to give your account a role - it
          can only be done from the staff script, not from here.
        </p>
        <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

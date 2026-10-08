import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { Regular } from "./pages/Regular";
import { Promotions } from "./pages/Promotions";
import { Palette } from "./components/Palette";
import { Icon, type IconName } from "./components/kit";

interface Section {
  readonly to: string;
  readonly label: string;
  readonly roles: StaffRole[];
  readonly icon: IconName;
  readonly group: "Operations" | "People" | "Money and records";
}

// Each section lists the roles that may open it. The database enforces the
// same thing on every call; this only keeps people out of pages that would
// refuse them.
const SECTIONS: Section[] = [
  { to: "/", label: "Control room", roles: ["control_room", "operations", "safety"], icon: "radio", group: "Operations" },
  { to: "/trips", label: "Trips & people", roles: ["support", "operations", "control_room", "safety"], icon: "route", group: "Operations" },
  { to: "/regular", label: "Regular trips", roles: ["operations", "control_room"], icon: "repeat", group: "Operations" },
  { to: "/zones", label: "Zones", roles: ["control_room", "operations", "safety", "fleet"], icon: "zone", group: "Operations" },
  { to: "/riders", label: "Riders", roles: ["operations", "fleet", "safety", "finance", "support"], icon: "riders", group: "People" },
  { to: "/fleet", label: "Fleet", roles: ["fleet", "operations"], icon: "moto", group: "People" },
  { to: "/cases", label: "Cases", roles: ["support", "operations", "safety", "control_room", "fleet"], icon: "cases", group: "People" },
  { to: "/reports", label: "Reports", roles: ["operations", "finance", "safety"], icon: "chart", group: "Money and records" },
  { to: "/promotions", label: "Promotions", roles: ["operations", "finance"], icon: "tag", group: "Money and records" },
  { to: "/pricing", label: "Prices & settings", roles: ["finance", "operations", "safety"], icon: "sliders", group: "Money and records" },
  { to: "/audit", label: "Audit log", roles: ["operations", "safety", "finance"], icon: "audit", group: "Money and records" },
];

const GROUPS = ["Operations", "People", "Money and records"] as const;

/** The section for a path, so a route's guard can't drift when sections are added. */
const sec = (to: string): Section => SECTIONS.find((s) => s.to === to)!;

export function App() {
  const { loading, session, staff } = useStaff();

  if (loading) return null;
  if (!session) return <Login />;
  if (!staff) return <NotStaff />;

  const allowed = SECTIONS.filter((s) => can(staff.role, ...s.roles));
  if (allowed.length === 0) return <NoSections />;
  const home = allowed[0]?.to ?? "/";

  return (
    <div className="frame">
      <Nav staff={staff} sections={allowed} />
      <Palette sections={allowed} canSearch={can(staff.role, ...sec("/trips").roles)} />
      <main className="main">
        <TopBar sections={allowed} />
        <div className="main-body">
        <Routes>
          <Route path="/" element={guard(staff, sec("/"), <ControlRoom staff={staff} />, home)} />
          <Route path="/riders" element={guard(staff, sec("/riders"), <Riders />, home)} />
          <Route path="/riders/:id" element={guard(staff, sec("/riders"), <RiderDetail staff={staff} />, home)} />
          <Route path="/fleet" element={guard(staff, sec("/fleet"), <Fleet staff={staff} />, home)} />
          <Route path="/trips" element={guard(staff, sec("/trips"), <Trips />, home)} />
          <Route path="/trips/:id" element={guard(staff, sec("/trips"), <TripDetail />, home)} />
          <Route path="/regular" element={guard(staff, sec("/regular"), <Regular staff={staff} />, home)} />
          <Route path="/zones" element={guard(staff, sec("/zones"), <Zones staff={staff} />, home)} />
          <Route path="/cases" element={guard(staff, sec("/cases"), <Cases staff={staff} />, home)} />
          <Route path="/cases/:id" element={guard(staff, sec("/cases"), <Cases staff={staff} />, home)} />
          <Route path="/reports" element={guard(staff, sec("/reports"), <Reports />, home)} />
          <Route path="/promotions" element={guard(staff, sec("/promotions"), <Promotions staff={staff} />, home)} />
          <Route path="/pricing" element={guard(staff, sec("/pricing"), <Pricing staff={staff} />, home)} />
          <Route path="/audit" element={guard(staff, sec("/audit"), <Audit />, home)} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
        </div>
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
  inspector: "Inspector",
};

function Nav({ staff, sections }: { staff: Staff; sections: Section[] }) {
  const alerts = useOpenAlertCount(can(staff.role, "control_room", "operations", "safety"));
  const cases = useOpenCaseCount(can(staff.role, "support", "operations", "safety", "control_room", "fleet"));
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<{ y: number; h: number } | null>(null);

  // One marker that travels to the section you open, the way the apps' tab
  // pill does, instead of one that blinks out here and in over there.
  useLayoutEffect(() => {
    const a = ref.current?.querySelector<HTMLAnchorElement>("a.active");
    setMarker(a ? { y: a.offsetTop + 8, h: a.offsetHeight - 16 } : null);
  }, [location.pathname, sections.length]);

  return (
    <nav className="nav" aria-label="Sections" ref={ref}>
      {marker ? <span className="nav-marker" style={{ transform: `translateY(${marker.y}px)`, height: marker.h }} aria-hidden="true" /> : null}
      <div className="brand">
        <span className="brand-mark">N</span>
        <div>
          <div className="brand-word">Nova</div>
          <div className="brand-sub">Control centre</div>
        </div>
      </div>
      {GROUPS.map((g) => {
        const items = sections.filter((s) => s.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="nav-group">
            <div className="nav-group-title">{g}</div>
            {items.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.to === "/"}>
                <Icon name={s.icon} size={18} />
                <span>{s.label}</span>
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
          </div>
        );
      })}
      <div className="nav-foot">
        <span className="me-avatar" aria-hidden="true">
          {(staff.name.trim().charAt(0) || "?").toUpperCase()}
        </span>
        <div className="me-text">
          <strong>{staff.name}</strong>
          <span>{ROLE_NAME[staff.role]}</span>
        </div>
        <button className="icon-button on-dark" onClick={() => void supabase.auth.signOut()} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={18} />
        </button>
      </div>
    </nav>
  );
}

/**
 * Above every page: where you are, the time in Kigali (the only clock that
 * matters to a rider), that the data is live, and the way to search.
 */
function TopBar({ sections }: { sections: Section[] }) {
  const location = useLocation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const here =
    sections.find((s) => s.to !== "/" && location.pathname.startsWith(s.to)) ?? sections.find((s) => s.to === "/" && location.pathname === "/");
  const kigali = new Date(now).toLocaleString("en-GB", { timeZone: "Africa/Kigali", weekday: "long", day: "numeric", month: "long" });
  const time = new Date(now).toLocaleTimeString("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit" });
  return (
    <header className="topbar">
      <div className="topbar-where">
        {here ? <Icon name={here.icon} size={18} /> : null}
        <span>{here?.label ?? "Nova"}</span>
      </div>
      <div className="topbar-spacer" />
      <span className="live-pill" title="Updates as it happens">
        <span className="live-dot" /> Live
      </span>
      <div className="topbar-clock" aria-label={`Kigali time ${time}, ${kigali}`}>
        <Icon name="clock" size={16} />
        <strong>{time}</strong>
        <span>{kigali}</span>
      </div>
      <button
        className="topbar-search"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
        aria-label="Search and go to (Ctrl K)"
      >
        <Icon name="search" size={16} />
        <span>Search riders, trips, pages</span>
        <kbd>Ctrl K</kbd>
      </button>
    </header>
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

function NoSections() {
  return (
    <div className="login">
      <div className="card stack">
        <h1>Inspections are in the app</h1>
        <p className="muted">
          Inspectors work from the Nova Rider app: tap Staff sign in on its first screen and use this
          email and password.
        </p>
        <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function NotStaff() {
  return (
    <div className="login">
      <div className="card stack">
        <h1>Not a staff account</h1>
        <p className="muted">
          This dashboard is for Nova staff. Ask an administrator to give your account a role - it
          can only be done from the staff script, not from here.
        </p>
        <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

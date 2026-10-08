import type { CSSProperties, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Icons. Drawn here rather than pulled from a package: two dozen strokes on a
// 24-point grid, the same weight everywhere, in whatever colour the text is.
// ---------------------------------------------------------------------------

const PATHS = {
  map: ["M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z", "M9 3v16", "M15 5v16"],
  riders: ["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1", "M16 3.2a4 4 0 0 1 0 7.6", "M22 21v-1a6 6 0 0 0-4-5.6"],
  moto: ["M5 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M5 17h3l4-6h4l3 6", "M12 11 10 7H7", "M15 7h3"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m21 21-4.3-4.3"],
  repeat: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  zone: ["M12 2 21 7v10l-9 5-9-5V7z", "M12 22V12", "M21 7l-9 5-9-5"],
  cases: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"],
  chart: ["M3 3v18h18", "M7 16v-4", "M12 16V8", "M17 16v-7"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  audit: ["M9 3h6v4H9z", "M9 5H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3", "M9 12h6", "M9 16h4"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  mail: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  lock: ["M7 11h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M8 11V7a4 4 0 0 1 8 0v4"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  eyeOff: ["m3 3 18 18", "M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4", "M6.6 6.6C3.8 8.5 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6", "M9.9 9.9a3 3 0 0 0 4.2 4.2"],
  shield: ["M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z", "m9 12 2 2 4-4"],
  alert: ["M12 3 2 20h20z", "M12 10v4", "M12 17h.01"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  trend: ["m3 17 6-6 4 4 8-8", "M15 7h6v6"],
  cash: ["M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 12h.01", "M18 12h.01"],
  route: ["M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"],
  star: ["m12 2 3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5L7 14.5l-5-5 7-1z"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  check: ["m5 12 5 5 9-9"],
  tag: ["M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z", "M7.5 7.5h.01"],
  navigate: ["m3 11 19-9-9 19-2-8z"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  wallet: ["M3 7a2 2 0 0 1 2-2h13v4", "M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z", "M16 14h.01"],
  radio: ["M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M16.2 7.8a6 6 0 0 1 0 8.4", "M7.8 16.2a6 6 0 0 1 0-8.4", "M19.1 4.9a10 10 0 0 1 0 14.2", "M4.9 19.1a10 10 0 0 1 0-14.2"],
  document: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h5"],
  arrowRight: ["M5 12h14", "m13 6 6 6-6 6"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, stroke = 2, style }: { readonly name: IconName; readonly size?: number; readonly stroke?: number; readonly style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none", ...style }}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figures: a sparkline, a KPI card, a donut, a bar chart. No chart library -
// each is a few lines of SVG, drawn in the brand's colours.
// ---------------------------------------------------------------------------

export function Sparkline({ values, color = "var(--accent)", width = 120, height = 36 }: { readonly values: readonly number[]; readonly color?: string; readonly width?: number; readonly height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${height} L${pts[0]![0].toFixed(1)} ${height} Z`;
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="spark">
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3.2} fill={color} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}

export type Tint = "blue" | "yellow" | "green" | "amber" | "red";

/**
 * A headline figure: what it counts, the number, how it moved since the day
 * before, and a week of it as a line. `better` says which way is good, so a
 * rise in cancellations is red and a rise in trips is green.
 */
export function Kpi({
  icon,
  tint,
  label,
  value,
  unit,
  delta,
  better = "up",
  trend,
  note,
}: {
  readonly icon: IconName;
  readonly tint: Tint;
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  /** The change against the previous day, in the figure's own units. */
  readonly delta?: number | null;
  readonly better?: "up" | "down";
  readonly trend?: readonly number[];
  readonly note?: string;
}) {
  const good = delta == null || delta === 0 ? null : (delta > 0) === (better === "up");
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className={`kpi-icon tint-${tint}`}>
          <Icon name={icon} size={18} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-mid">
        <div className="kpi-figure">
          {value}
          {unit ? <small>{unit}</small> : null}
        </div>
        {trend && trend.length > 1 ? <Sparkline values={trend} color={tint === "red" ? "var(--bad)" : tint === "amber" ? "var(--warn)" : tint === "green" ? "var(--good)" : "var(--accent)"} /> : null}
      </div>
      <div className="kpi-foot">
        {delta != null ? (
          <span className={`delta-chip ${good === null ? "flat" : good ? "good" : "bad"}`}>
            {delta === 0 ? "No change" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toLocaleString("en-US")}`}
          </span>
        ) : null}
        <span className="muted small">{note ?? (delta != null ? "vs the day before" : "")}</span>
      </div>
    </div>
  );
}

/** Parts of a whole as a ring, with the total in the middle. */
export function Donut({
  parts,
  size = 168,
  label,
}: {
  readonly parts: readonly { readonly label: string; readonly value: number; readonly color: string }[];
  readonly size?: number;
  readonly label: string;
}) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={20} />
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => {
                const len = (p.value / total) * c;
                const el = (
                  <circle
                    key={p.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={20}
                    strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                    strokeDashoffset={-offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                );
                offset += len;
                return el;
              })
          : null}
        <text x="50%" y="47%" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="donut-label">
          {label}
        </text>
      </svg>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="legend-label">{p.label}</span>
            <strong className="legend-value">{p.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Days side by side, each a stack: the good part in midnight, the rest in grey. */
export function DayBars({
  days,
  highlight,
}: {
  readonly days: readonly { readonly label: string; readonly done: number; readonly lost: number }[];
  readonly highlight?: number;
}) {
  const max = Math.max(1, ...days.map((d) => d.done + d.lost));
  return (
    <div className="daybars" role="img" aria-label={days.map((d) => `${d.label}: ${d.done} completed, ${d.lost} not`).join("; ")}>
      {days.map((d, i) => (
        <div key={`${d.label}-${i}`} className={`daybar${i === highlight ? " on" : ""}`}>
          <span className="daybar-value">{d.done}</span>
          <div className="daybar-track">
            <div className="daybar-lost" style={{ height: `${(d.lost / max) * 100}%` }} />
            <div className="daybar-done" style={{ height: `${(d.done / max) * 100}%` }} />
          </div>
          <span className="daybar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Nothing here yet: a drawn badge and one line on what will appear. */
export function Empty({ icon, title, body }: { readonly icon: IconName; readonly title: string; readonly body?: string }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <span className="empty-ring" />
        <span className="empty-disc">
          <Icon name={icon} size={30} />
        </span>
        <span className="empty-token">
          <Icon name="check" size={14} stroke={3} />
        </span>
      </div>
      <strong>{title}</strong>
      {body ? <p className="muted">{body}</p> : null}
    </div>
  );
}

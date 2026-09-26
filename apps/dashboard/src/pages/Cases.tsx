import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ago, can, kigaliDateTime, rpc, usePoll, type Staff } from "../lib/supabase";

interface CaseRow {
  id: string;
  number: number;
  kind: Kind;
  category: string | null;
  status: "open" | "in_progress" | "resolved";
  reporter_name: string | null;
  reporter_role: "passenger" | "rider" | "staff";
  rider_name: string | null;
  trip_id: string | null;
  description: string;
  assigned_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Person {
  id: string;
  name: string;
  phone: string | null;
}

interface CaseDetail {
  id: string;
  number: number;
  kind: Kind;
  category: string | null;
  status: CaseRow["status"];
  description: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  trip_id: string | null;
  lat: number | null;
  lng: number | null;
  reporter: (Person & { role: string }) | null;
  rider: Person | null;
  passenger: Person | null;
  assigned_to: string | null;
  assigned_name: string | null;
  notes: { author: string | null; body: string; at: string }[];
}

type Kind = "incident" | "complaint" | "lost_property" | "vehicle" | "other";

const KIND: Record<Kind, string> = {
  incident: "Incident",
  complaint: "Complaint",
  lost_property: "Lost property",
  vehicle: "Vehicle",
  other: "Other",
};

const STATUS: Record<CaseRow["status"], [string, string]> = {
  open: ["Open", "bad"],
  in_progress: ["Being handled", "warn"],
  resolved: ["Resolved", "good"],
};

const title = (c: { kind: Kind; category: string | null }) =>
  c.category ? c.category.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase()) : KIND[c.kind];

export function Cases({ staff }: { staff: Staff }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [kind, setKind] = useState<Kind | null>(null);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(params.has("trip"));

  const load = useCallback(async () => {
    try {
      setRows(await rpc<CaseRow[]>("staff_cases", { p_status: status, p_kind: kind }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the cases.");
    }
  }, [status, kind]);
  usePoll(load, 20_000, [load]);

  return (
    <div className="split">
      <div className="split-list">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <div>
            <h1>Cases</h1>
            <p className="sub">Incidents, complaints, lost property and vehicle faults, from the apps and the phone.</p>
          </div>
          {can(staff.role, "support", "operations", "safety", "control_room") ? (
            <button className="btn" onClick={() => setLogging(true)}>
              Log a call
            </button>
          ) : null}
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <div className="tabs" role="tablist">
            {(["open", "resolved", "all"] as const).map((s) => (
              <button key={s} role="tab" aria-selected={status === s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
                {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "All"}
              </button>
            ))}
          </div>
          <select className="select" value={kind ?? ""} onChange={(e) => setKind((e.target.value || null) as Kind | null)} aria-label="Kind">
            <option value="">Every kind</option>
            {Object.entries(KIND).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="notice bad">{error}</div> : null}

        <div className="case-list">
          {(rows ?? []).map((c) => (
            <button key={c.id} className={`case-item${c.id === id ? " on" : ""}${c.kind === "incident" && c.status !== "resolved" ? " urgent" : ""}`} onClick={() => navigate(`/cases/${c.id}`)}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                <span>
                  <span className="case-no">#{c.number}</span> <strong>{title(c)}</strong>
                </span>
                <span className="small muted">{ago(c.created_at)}</span>
              </div>
              <div className="case-desc">{c.description}</div>
              <div className="row small muted" style={{ gap: 8 }}>
                <span className={`chip ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
                <span>
                  {c.reporter_name ?? (c.reporter_role === "staff" ? "Staff" : "Unknown caller")} ({c.reporter_role})
                </span>
                {c.assigned_name ? <span>· {c.assigned_name}</span> : null}
              </div>
            </button>
          ))}
          {rows && rows.length === 0 ? (
            <p className="muted" style={{ padding: "24px 4px" }}>
              {status === "open" ? "Nothing waiting. New reports from passengers and riders land here." : "No cases match."}
            </p>
          ) : null}
        </div>
      </div>

      <div className="split-detail">
        {logging ? (
          <LogCall
            tripId={params.get("trip")}
            onCancel={() => setLogging(false)}
            onCreated={(newId) => {
              setLogging(false);
              void load();
              navigate(`/cases/${newId}`);
            }}
          />
        ) : id ? (
          <CaseView key={id} id={id} staff={staff} onChanged={() => void load()} />
        ) : (
          <div className="empty-detail muted">Pick a case to read it, take it and close it.</div>
        )}
      </div>
    </div>
  );
}

function CaseView({ id, staff, onChanged }: { id: string; staff: Staff; onChanged: () => void }) {
  const [c, setC] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [closing, setClosing] = useState(false);

  const load = useCallback(() => {
    rpc<CaseDetail>("staff_case_detail", { p_case_id: id })
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      return false;
    }
  };

  if (!c) return error ? <div className="notice bad">{error}</div> : null;
  const mine = c.assigned_name === staff.name;
  const open = c.status !== "resolved";

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <span className="case-no lg">#{c.number}</span>
            <h1 style={{ margin: 0 }}>{title(c)}</h1>
            <span className={`chip ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
          </div>
          <p className="sub">
            {KIND[c.kind]} · opened {kigaliDateTime(c.created_at)}
            {c.assigned_name ? ` · ${mine ? "yours" : `with ${c.assigned_name}`}` : " · nobody has it yet"}
          </p>
        </div>
        {open && !mine ? (
          <button className="btn" onClick={() => void act(() => rpc("staff_take_case", { p_case_id: c.id }))}>
            {c.assigned_name ? "Take it over" : "Take this case"}
          </button>
        ) : null}
      </div>

      {error ? <div className="notice bad">{error}</div> : null}

      <section className="card">
        <p className="case-body">{c.description}</p>
        <div className="grid cols-3" style={{ marginTop: 16 }}>
          <PersonBox label={`Reported by (${c.reporter?.role ?? "staff"})`} person={c.reporter} link={c.reporter?.role === "rider"} />
          {c.rider && c.rider.id !== c.reporter?.id ? <PersonBox label="Rider" person={c.rider} link /> : null}
          {c.passenger && c.passenger.id !== c.reporter?.id ? <PersonBox label="Passenger" person={c.passenger} /> : null}
        </div>
        {c.trip_id ? (
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            <Link to={`/trips/${c.trip_id}`}>Open the trip</Link>
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>Notes</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Only staff see these.</p>
        {c.notes.length > 0 ? (
          <ol className="timeline">
            {c.notes.map((n, i) => (
              <li key={i}>
                <time className="small">{kigaliDateTime(n.at)}</time>
                <div>
                  <strong>{n.author ?? "Staff"}</strong>
                  <div>{n.body}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {open ? (
          <form
            className="row"
            style={{ marginTop: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => rpc("staff_add_case_note", { p_case_id: c.id, p_body: note }))) setNote("");
            }}
          >
            <input className="input" style={{ flex: 1 }} placeholder="Who you called, what they said, what happens next" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn secondary" disabled={!note.trim()}>
              Add note
            </button>
          </form>
        ) : null}
      </section>

      {open ? (
        <section className="card">
          <h2>Close the case</h2>
          {closing ? (
            <div className="stack">
              <label className="small muted" htmlFor="resolution">
                {c.reporter && c.reporter.role !== "staff" ? `${c.reporter.name} sees this in the app and gets a notification.` : "Written on the record."}
              </label>
              <textarea id="resolution" className="textarea" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={c.kind === "lost_property" ? "e.g. Your phone is at the Remera depot. Bring your ID to collect it." : "What was found and what was done"} />
              <div className="row">
                <button className="btn" disabled={resolution.trim().length < 5} onClick={() => void act(() => rpc("staff_resolve_case", { p_case_id: c.id, p_resolution: resolution }))}>
                  Resolve
                </button>
                <button className="link-button" onClick={() => setClosing(false)}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button className="btn secondary" onClick={() => setClosing(true)}>
              Write the resolution
            </button>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Resolution</h2>
          <p style={{ margin: 0 }}>{c.resolution}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>{kigaliDateTime(c.resolved_at)}</p>
        </section>
      )}
    </div>
  );
}

function PersonBox({ label, person, link }: { label: string; person: Person | null; link?: boolean }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      {person ? (
        <>
          <strong>{link ? <Link to={`/riders/${person.id}`}>{person.name}</Link> : person.name}</strong>
          {person.phone ? (
            <div>
              <a href={`tel:${person.phone}`}>{person.phone}</a>
            </div>
          ) : null}
        </>
      ) : (
        <strong className="muted">Not recorded</strong>
      )}
    </div>
  );
}

interface Hit {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
}

function LogCall({ tripId, onCancel, onCreated }: { tripId: string | null; onCancel: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<Exclude<Kind, "vehicle">>("complaint");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [person, setPerson] = useState<Hit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      rpc<Hit[]>("staff_search", { p_query: query })
        .then((r) => setHits(r.filter((h) => h.kind !== "trip").slice(0, 6)))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <section className="card stack">
      <h1 style={{ margin: 0 }}>Log a call</h1>
      <p className="sub" style={{ margin: 0 }}>
        The case opens with you as its owner.{tripId ? " It is linked to the trip you came from." : ""}
      </p>

      <div className="tabs" role="radiogroup" style={{ alignSelf: "flex-start" }}>
        {(["incident", "complaint", "lost_property", "other"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {KIND[k]}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="caller">Who called</label>
        {person ? (
          <div className="row">
            <strong>{person.title}</strong>
            <span className="muted">{person.subtitle}</span>
            <button className="link-button" onClick={() => setPerson(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input id="caller" className="input" placeholder="Name or phone number" value={query} onChange={(e) => setQuery(e.target.value)} />
            {hits.length > 0 ? (
              <div className="list">
                {hits.map((h) => (
                  <div key={h.id} className="list-item" onClick={() => setPerson(h)}>
                    <strong>{h.title}</strong> <span className="small muted">{h.kind} · {h.subtitle}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="field">
        <label htmlFor="what">What happened</label>
        <textarea id="what" className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="In the caller's words: where, when, what they need" />
      </div>

      {error ? <div className="notice bad">{error}</div> : null}

      <div className="row">
        <button
          className="btn"
          disabled={text.trim().length < 5}
          onClick={async () => {
            setError(null);
            try {
              onCreated(await rpc<string>("staff_create_case", { p_kind: kind, p_description: text, p_trip_id: tripId, p_person_id: person?.id ?? null }));
            } catch (e) {
              setError(e instanceof Error ? e.message : "That didn't work.");
            }
          }}
        >
          Open case
        </button>
        <button className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

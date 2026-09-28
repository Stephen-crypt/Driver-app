import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc } from "../lib/supabase";

interface Hit {
  kind: "rider" | "passenger" | "trip";
  id: string;
  title: string;
  subtitle: string | null;
}

/** §53: find anyone or any trip from a name, a phone number or a trip ID. */
export function Trips() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      rpc<Hit[]>("staff_search", { p_query: term })
        .then((h) => {
          if (!live) return;
          setHits(h);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const open = (h: Hit) => {
    if (h.kind === "trip") navigate(`/trips/${h.id}`);
    else if (h.kind === "rider") navigate(`/riders/${h.id}`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Trips & people</h1>
          <p className="sub">Search by first name, any part of a phone number, or the start of a trip ID.</p>
        </div>
      </div>
      <input className="input" style={{ width: "min(560px, 100%)", height: 48, fontSize: 17 }} placeholder="Aline, 0788 123, 3a41…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {error ? <div className="notice bad" style={{ marginTop: 16 }}>{error}</div> : null}
      {hits.length > 0 ? (
        <div className="card" style={{ marginTop: 16, padding: 0, maxWidth: 720 }}>
          <table className="table">
            <tbody>
              {hits.map((h) => (
                <tr key={`${h.kind}-${h.id}`} className={h.kind === "passenger" ? "" : "clickable"} onClick={() => open(h)}>
                  <td style={{ paddingLeft: 16, width: 110 }}>
                    <span className={`chip ${h.kind === "rider" ? "accent" : h.kind === "trip" ? "good" : ""}`}>{h.kind}</span>
                  </td>
                  <td>
                    <strong>{h.title}</strong>
                  </td>
                  <td className="muted small" style={{ paddingRight: 16 }}>
                    {h.subtitle}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : q.trim().length >= 2 ? (
        <p className="muted">Nothing matches.</p>
      ) : null}
    </div>
  );
}

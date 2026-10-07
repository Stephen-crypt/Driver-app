import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc } from "../lib/supabase";
import { Empty, Icon, type IconName } from "../components/kit";

const KIND: Record<Hit["kind"], { icon: IconName; tint: string; label: string }> = {
  rider: { icon: "moto", tint: "tint-yellow", label: "Rider" },
  passenger: { icon: "riders", tint: "tint-blue", label: "Passenger" },
  trip: { icon: "route", tint: "tint-green", label: "Trip" },
};

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
          <p className="sub">Find a rider, a passenger or a trip.</p>
        </div>
      </div>
      <div style={{ maxWidth: 820 }}>
        <div className="search-hero">
          <Icon name="search" size={22} />
          <input className="input" placeholder="Aline, 0788 123, NV-3F2A1B, 3a41…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search" />
        </div>
        {error ? <div className="notice bad" style={{ marginTop: 16 }}>{error}</div> : null}
        {hits.length > 0 ? (
          <div className="card" style={{ marginTop: 16, padding: 0 }}>
            <table className="table">
              <tbody>
                {hits.map((h) => (
                  <tr key={`${h.kind}-${h.id}`} className={h.kind === "passenger" ? "" : "clickable"} onClick={() => open(h)}>
                    <td style={{ paddingLeft: 18, width: 56 }}>
                      <span className={`kind-icon ${KIND[h.kind].tint}`}>
                        <Icon name={KIND[h.kind].icon} size={17} />
                      </span>
                    </td>
                    <td>
                      <strong>{h.title}</strong>
                      <div className="small muted">{KIND[h.kind].label}</div>
                    </td>
                    <td className="muted small" style={{ paddingRight: 18 }}>
                      {h.subtitle}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : q.trim().length >= 2 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon="search" title="Nothing matches" body="Try part of a phone number, a first name, or a booking reference from a passenger's ticket." />
          </div>
        ) : (
          <div className="grid cols-3" style={{ marginTop: 16 }}>
            {(
              [
                ["riders", "A person", "Their first name, or any four digits of their phone number."],
                ["route", "A trip", "The start of its ID, from a link or the audit log."],
                ["document", "A booking", "The NV- reference on a passenger's ticket."],
              ] as [IconName, string, string][]
            ).map(([icon, title, body]) => (
              <div key={title} className="card">
                <span className="kind-icon tint-blue" style={{ marginBottom: 10 }}>
                  <Icon name={icon} size={17} />
                </span>
                <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong>
                <span className="small muted">{body}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Icon } from "./kit";
import { findPlaces, type FoundPlace } from "../lib/zonePlaces";

/**
 * Pick a place for a zone: one box for sectors, cells, sites and every place
 * passenger search knows. Each result says what it is, because cell names
 * repeat across sectors.
 */
export function ZonePlacePicker({ picked, onPick }: { readonly picked: FoundPlace | null; readonly onPick: (p: FoundPlace) => void }) {
  const [query, setQuery] = useState(picked?.name ?? "");
  const [results, setResults] = useState<FoundPlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!picked);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      findPlaces(q)
        .then((r) => {
          if (!live) return;
          setResults(r);
          setFailed(false);
        })
        .catch(() => {
          if (!live) return;
          setResults(null);
          setFailed(true);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="input-icon">
        <Icon name="search" size={16} />
        <input
          className="input"
          aria-label="Find a place"
          placeholder="A sector, a cell, a site or a place"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && failed ? <p className="small muted" style={{ margin: 0 }}>Search didn't work. Try again.</p> : null}
      {open && results && results.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          No place called “{query.trim()}”. Try a sector, a site, or draw it by hand.
        </p>
      ) : null}
      {open && results && results.length > 0 ? (
        <div className="place-results" role="listbox" aria-label="Places">
          {results.map((p) => (
            <button
              key={p.ref}
              role="option"
              aria-selected={picked?.ref === p.ref}
              className={`place-result${picked?.ref === p.ref ? " on" : ""}`}
              onClick={() => {
                setQuery(p.name);
                setOpen(false);
                onPick(p);
              }}
            >
              <strong>{p.name}</strong>
              <span className="small muted">{p.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

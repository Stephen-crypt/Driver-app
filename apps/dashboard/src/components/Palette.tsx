import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc } from "../lib/supabase";

interface Hit {
  kind: "rider" | "passenger" | "trip";
  id: string;
  title: string;
  subtitle: string | null;
}

interface Item {
  readonly key: string;
  readonly title: string;
  readonly note: string;
  readonly go: () => void;
}

const KIND: Record<Hit["kind"], string> = { rider: "Rider", passenger: "Passenger", trip: "Trip" };

/**
 * Ctrl+K from anywhere: jump to a section, or find a rider or a trip by name,
 * phone or trip ID. A control room works with one hand on the keyboard and the
 * other on the phone; the mouse is the slow way round.
 */
export function Palette({ sections, canSearch }: { readonly sections: readonly { to: string; label: string }[]; readonly canSearch: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setAt(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!canSearch || term.length < 2) {
      setHits([]);
      return;
    }
    // A reply to an older query must not land after a newer one: typing on,
    // or deleting back, would otherwise show someone else's results.
    let live = true;
    const id = setTimeout(() => {
      rpc<Hit[]>("staff_search", { p_query: term })
        .then((h) => live && setHits(h.slice(0, 8)))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, canSearch]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const go = (to: string) => () => {
      setOpen(false);
      navigate(to);
    };
    const secs = sections
      .filter((s) => !term || s.label.toLowerCase().includes(term))
      .map((s) => ({ key: `s${s.to}`, title: s.label, note: "Go to", go: go(s.to) }));
    const found = hits
      .filter((h) => h.kind !== "passenger")
      .map((h) => ({
        key: `h${h.kind}${h.id}`,
        title: h.title,
        note: [KIND[h.kind], h.subtitle].filter(Boolean).join(", "),
        go: go(h.kind === "trip" ? `/trips/${h.id}` : `/riders/${h.id}`),
      }));
    return [...found, ...secs];
  }, [q, hits, sections, navigate]);

  useEffect(() => setAt(0), [items.length]);

  if (!open) return null;

  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to">
        <input
          ref={input}
          className="palette-input"
          placeholder={canSearch ? "Go to a section, or find a rider or trip" : "Go to a section"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") items[at]?.go();
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[at] ? `pi-${items[at].key}` : undefined}
        />
        <ul className="palette-list" id="palette-list" role="listbox">
          {items.length === 0 ? <li className="palette-empty">Nothing matches "{q}".</li> : null}
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`pi-${it.key}`}
              role="option"
              aria-selected={i === at}
              className={i === at ? "on" : ""}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                it.go();
              }}
            >
              <span className="palette-title">{it.title}</span>
              <span className="palette-note">{it.note}</span>
            </li>
          ))}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

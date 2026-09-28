import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/*
 * The dashboard's small kit: toasts, dialogs, rolling figures and skeletons.
 * It moves the way the apps move - the same curves and durations, defined once
 * in styles.css - so a staff member who also uses the phones sees one product.
 */

// ---------------------------------------------------------------------------
// Toasts and dialogs
// ---------------------------------------------------------------------------

type Tone = "good" | "bad" | "neutral";

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: Tone;
  readonly leaving?: boolean;
}

interface ConfirmRequest {
  readonly title: string;
  readonly body?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: "danger" | "primary";
}

interface PromptRequest {
  readonly title: string;
  readonly body?: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly confirmLabel: string;
  readonly optional?: boolean;
}

type DialogState = { readonly id: number } & (
  | { kind: "confirm"; r: ConfirmRequest; resolve: (ok: boolean) => void }
  | { kind: "prompt"; r: PromptRequest; resolve: (value: string | null) => void }
);

interface Ui {
  readonly toast: (message: string, tone?: Tone) => void;
  readonly confirm: (r: ConfirmRequest) => Promise<boolean>;
  readonly prompt: (r: PromptRequest) => Promise<string | null>;
}

const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi needs <UiProvider>");
  return ui;
}

const TOAST_MS = 3200;
const LEAVE_MS = 200;

export function UiProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Dialogs wait their turn: a second one asked for while one is open queues
  // behind it, so neither answer is lost.
  const [dialogs, setDialogs] = useState<DialogState[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    // Marked as leaving first, so it can play its exit before it is removed.
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);

  const ui = useMemo<Ui>(
    () => ({
      toast: (message, tone = "good") => {
        const id = next.current++;
        // Three at most: a fourth pushes the oldest out rather than stacking a wall.
        setToasts((all) => [...all.slice(-2), { id, message, tone }]);
        setTimeout(() => dismiss(id), TOAST_MS);
      },
      confirm: (r) =>
        new Promise<boolean>((resolve) => setDialogs((q) => [...q, { id: next.current++, kind: "confirm", r, resolve }])),
      prompt: (r) =>
        new Promise<string | null>((resolve) => setDialogs((q) => [...q, { id: next.current++, kind: "prompt", r, resolve }])),
    }),
    [dismiss],
  );
  const closeDialog = useCallback((id: number) => setDialogs((q) => q.filter((d) => d.id !== id)), []);

  return (
    <UiContext.Provider value={ui}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}${t.leaving ? " leaving" : ""}`} onClick={() => dismiss(t.id)}>
            <span className="toast-mark" aria-hidden="true" />
            {t.message}
          </div>
        ))}
      </div>
      {dialogs[0] ? <Dialog key={dialogs[0].id} state={dialogs[0]} onClose={closeDialog} /> : null}
    </UiContext.Provider>
  );
}

function Dialog({ state, onClose }: { readonly state: DialogState; readonly onClose: (id: number) => void }) {
  const [value, setValue] = useState("");
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const answered = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Answers once, then leaves. Held in a ref so the keyboard handler below is
  // set up once and never re-runs - re-running it would pull focus back to the
  // first field every time anything else on the page re-rendered.
  const finish = useRef<(ok: boolean) => void>(() => {});
  finish.current = (ok: boolean) => {
    if (answered.current) return;
    answered.current = true;
    setLeaving(true);
    if (state.kind === "confirm") state.resolve(ok);
    else state.resolve(ok ? valueRef.current.trim() : null);
    setTimeout(() => onClose(state.id), 160);
  };

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (state.kind === "prompt" ? input.current : primary.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish.current(false);
      } else if (e.key === "Tab" && box.current) {
        // Tab stays inside: the page behind a dialog can't be reached while
        // it is open.
        const all = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, input, select, a[href]")];
        const first = all[0];
        const last = all[all.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to where the person was, so the keyboard doesn't land on the page top.
      before?.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const danger = state.kind === "confirm" && state.r.tone === "danger";
  const blocked = state.kind === "prompt" && !state.r.optional && value.trim().length === 0;

  return (
    <div className={`scrim${leaving ? " leaving" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && finish.current(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={box}>
        <h2 id="dialog-title">{state.r.title}</h2>
        {state.r.body ? <p className="muted">{state.r.body}</p> : null}
        {state.kind === "prompt" ? (
          <div className="field">
            <label htmlFor="dialog-input">{state.r.label}</label>
            <textarea
              id="dialog-input"
              ref={input}
              className="textarea"
              value={value}
              placeholder={state.r.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) finish.current(true);
              }}
            />
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="btn secondary" onClick={() => finish.current(false)}>
            {state.kind === "confirm" ? (state.r.cancelLabel ?? "Cancel") : "Cancel"}
          </button>
          <button ref={primary} className={`btn ${danger ? "danger-solid" : ""}`} disabled={blocked} onClick={() => finish.current(true)}>
            {state.r.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows a page's "done" message as a toast, then clears it. */
export function Flash({ message, onShown }: { readonly message: string | null; readonly onShown: () => void }) {
  const { toast } = useUi();
  useEffect(() => {
    if (!message) return;
    toast(message);
    onShown();
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ---------------------------------------------------------------------------
// Odometer: the apps' rolling figures, in CSS. Each digit is a strip of 0-9
// twice that turns to its value; the columns are keyed from the right, so a
// new thousands column rolls in while the others stay put.
// ---------------------------------------------------------------------------

export function Odometer({ value, delay = 0 }: { readonly value: string | number; readonly delay?: number }) {
  const text = typeof value === "number" ? value.toLocaleString("en-US") : value;
  const chars = text.split("");
  let n = 0;
  return (
    <span className="odo">
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (ch >= "0" && ch <= "9") {
          const order = n++;
          return <Digit key={`d${key}`} digit={Number(ch)} delay={delay + order * 40} />;
        }
        return (
          <span key={`s${key}${ch}`} className="odo-sym" aria-hidden="true">
            {ch}
          </span>
        );
      })}
    </span>
  );
}

function Digit({ digit, delay }: { readonly digit: number; readonly delay: number }) {
  // Mounted on the first turn, then moved to the second: every column
  // visibly turns once, zeros included.
  const [row, setRow] = useState(digit);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const f = requestAnimationFrame(() => requestAnimationFrame(() => setRow(digit + 10)));
      return () => cancelAnimationFrame(f);
    }
    setRow(digit + 10);
  }, [digit]);
  return (
    <span className="odo-col" aria-hidden="true">
      <span className="odo-strip" style={{ transform: `translateY(-${row}em)`, transitionDelay: `${delay}ms` }}>
        {"01234567890123456789".split("").map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeletons: the shape of what is loading.
// ---------------------------------------------------------------------------

export function Skeleton({ w = "100%", h = 14, r = 7, style }: { readonly w?: number | string; readonly h?: number; readonly r?: number; readonly style?: CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function SkeletonPage() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="stack" style={{ gap: 16 }}>
        <Skeleton w={260} h={34} r={8} />
        <Skeleton w={380} h={14} />
        <div className="grid cols-3" style={{ marginTop: 8 }}>
          <Skeleton h={96} r={14} />
          <Skeleton h={96} r={14} />
          <Skeleton h={96} r={14} />
        </div>
        <Skeleton h={260} r={14} />
      </div>
    </div>
  );
}

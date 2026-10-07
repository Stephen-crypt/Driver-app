import { useState, type FormEvent, type KeyboardEvent } from "react";
import { supabase } from "../lib/supabase";
import { Icon } from "../components/kit";

const TEAMS = ["Control room", "Operations", "Fleet", "Support", "Safety", "Finance"];

/**
 * Staff sign-in, split in two: the night on the left with the Kigali
 * illustration (public/login-hero.jpg) and the words over its empty sky, and
 * the form on the right.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // One message for both cases: saying which half was wrong tells an
    // attacker which staff emails exist.
    if (err) setError("That email and password don't match a staff account.");
    setBusy(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState("CapsLock"));

  return (
    <div className="login-split">
      <section className={`login-brand${art ? " has-art" : ""}`} aria-hidden="true">
        {/* The illustration fills the panel; its top is plain night sky, so
            the words sit on it without a scrim. Until the file is there, the
            panel is the night and the diamonds on their own. */}
        <img className="login-art" src="/login-hero.jpg" alt="" onLoad={() => setArt(true)} onError={() => setArt(false)} style={art ? undefined : { display: "none" }} />
        <div className="login-brand-top">
          <span className="brand-mark lg">N</span>
          <div>
            <div className="login-brand-word">Nova</div>
            <div className="login-brand-sub">Control centre</div>
          </div>
        </div>

        <div className="login-pitch">
          <h2>Kigali's fleet, on one screen.</h2>
          <p>Every rider, every trip and every alert, live - and the day's numbers when the shift is done.</p>
        </div>

        <ul className="login-teams">
          {TEAMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="login-form-side">
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="login-form-brand">
            <span className="brand-mark">N</span>
            <span>Nova Control centre</span>
          </div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in with your Nova staff account.</p>

          <div className="field">
            <label htmlFor="email">Work email</label>
            <div className="input-icon">
              <Icon name="mail" size={18} />
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                placeholder="name@nova.rw"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-icon">
              <Icon name="lock" size={18} />
              <input
                id="password"
                className="input"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={onKey}
                onKeyDown={onKey}
              />
              <button type="button" className="input-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
                <Icon name={show ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>
            {caps ? (
              <span className="field-note warn">
                <Icon name="alert" size={14} /> Caps Lock is on
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="notice bad row" role="alert" style={{ gap: 8, flexWrap: "nowrap" }}>
              <Icon name="alert" size={18} />
              {error}
            </div>
          ) : null}

          <button className="btn highlight lg" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
            {!busy ? <Icon name="arrowRight" size={18} /> : null}
          </button>

          <div className="login-help">
            <Icon name="shield" size={16} />
            <span>
              What you can open depends on your role, and the database checks it on every request. Forgotten your password? An
              administrator resets it with the staff script.
            </span>
          </div>
        </form>
        <p className="login-foot muted small">Inspectors sign in from the Nova Rider app.</p>
      </section>
    </div>
  );
}

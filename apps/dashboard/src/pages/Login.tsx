import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <span className="vest lg">G</span>
          <div>
            <h1>Gera</h1>
            <div className="muted">Staff sign-in</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error ? <div className="notice bad">{error}</div> : null}
        <button className="btn" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

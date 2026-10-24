import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../ctx.js";
import { Logo } from "../ui.jsx";

function Side() {
  return (
    <aside className="auth-side">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Logo /> <b style={{ fontSize: 18 }}>ProjectPulse</b>
      </div>
      <div>
        <h1>Turning project chaos into clarity.</h1>
        <p style={{ marginTop: 14 }}>
          One platform for tasks, workload and deadlines — with an AI Project Assistant that reads your live task data and
          tells you honestly whether the project is on track.
        </p>
      </div>
      <div className="auth-feats">
        <div className="auth-feat"><b>Tasks &amp; Kanban</b>Every task has one owner and a deadline.</div>
        <div className="auth-feat"><b>Team workload</b>See who is above the limit at a glance.</div>
        <div className="auth-feat"><b>Delay warnings</b>At-risk and Delayed tasks are flagged with a reason.</div>
        <div className="auth-feat"><b>AI Assistant &amp; Daily Brief</b>Ask “Why are we behind schedule?”</div>
      </div>
    </aside>
  );
}

export function Login() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api("auth/login", { method: "POST", body: f });
      signIn(r.token, r.user);
      nav("/");
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Side />
      <main className="auth-main">
        <form className="card auth-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>Welcome back to ProjectPulse.</p>
          {err && <div className="alert">{err}</div>}
          <div className="field">
            <label htmlFor="u">Username</label>
            <input id="u" className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" className="input" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ width: "100%", padding: 12 }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="small" style={{ textAlign: "center", marginTop: 16 }}>
            No account? <Link to="/register">Create one</Link>
          </p>
          <p className="hint" style={{ textAlign: "center" }}>Team demo accounts are listed in the project README.</p>
        </form>
      </main>
    </div>
  );
}

export function Register() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", username: "", password: "", role: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api("auth/register", { method: "POST", body: f });
      signIn(r.token, r.user);
      nav("/");
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Side />
      <main className="auth-main">
        <form className="card auth-card" onSubmit={submit}>
          <h2>Create your account</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>You will join the ProjectPulse MVP team project.</p>
          {err && <div className="alert">{err}</div>}
          <div className="field"><label htmlFor="n">Your name</label><input id="n" className="input" value={f.name} onChange={set("name")} autoFocus /></div>
          <div className="field"><label htmlFor="r">Role</label><input id="r" className="input" placeholder="e.g. Team lead" value={f.role} onChange={set("role")} /></div>
          <div className="field"><label htmlFor="u2">Username</label><input id="u2" className="input" autoComplete="username" value={f.username} onChange={set("username")} /></div>
          <div className="field"><label htmlFor="p2">Password (6+ characters)</label><input id="p2" type="password" autoComplete="new-password" className="input" value={f.password} onChange={set("password")} /></div>
          <button className="btn btn-primary" style={{ width: "100%", padding: 12 }} disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
          <p className="small" style={{ textAlign: "center", marginTop: 16 }}>Already registered? <Link to="/login">Sign in</Link></p>
        </form>
      </main>
    </div>
  );
}

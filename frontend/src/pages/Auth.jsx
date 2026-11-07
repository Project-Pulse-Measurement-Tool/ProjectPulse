import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../ctx.js";
import { AuthHeader, Icon } from "../ui.jsx";
import { useT } from "../i18n.js";

/* Figma frames: "Sign in to ProjectPulse", "Create your account", "You have signed out". */

function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <AuthHeader />
      <main className="auth-main">{children}</main>
    </div>
  );
}

const SAMPLE = { email: "aisha@example.com", password: "pulse2026" };

export function Login() {
  const t = useT();
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "", remember: true });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    const v = {};
    if (!f.email.trim()) v.email = t("Write your email.");
    if (!f.password) v.password = t("Write your password.");
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setErr(null);
    try {
      const r = await api("auth/login", { method: "POST", body: { email: f.email, password: f.password } });
      signIn(r.token, r.user, f.remember);
      nav("/");
    } catch (x) { setErr(t(x.message)); } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="eyebrow-sm">{t("Welcome back")}</div>
        <h1 className="auth-title">{t("Sign in to ProjectPulse")}</h1>
        <p className="auth-sub">{t("See your tasks, deadlines and team workload.")}</p>
        {err && <div className="alert alert-pill">{err}</div>}

        <div className="field">
          <label htmlFor="email">{t("Email")}</label>
          <input id="email" className={`input input-lg ${errors.email ? "invalid" : ""}`} autoComplete="username" placeholder="you@example.com"
            value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="pw">{t("Password")}</label>
          <input id="pw" type="password" className={`input input-lg ${errors.password ? "invalid" : ""}`} autoComplete="current-password"
            value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {errors.password && <span className="field-error">{errors.password}</span>}
        </div>

        <div className="auth-row">
          <label className="check">
            <input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />
            <span className="check-box">{Icon.check}</span> {t("Remember me")}
          </label>
          <button type="button" className="link-btn" onClick={() => setForgot(!forgot)}>{t("Forgot password?")}</button>
        </div>
        {forgot && <div className="note-box">{t("Ask your team lead or the project admin to reset your password. After signing in you can change it in Settings.")}</div>}

        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
        <p className="auth-foot">{t("New to ProjectPulse?")} <Link to="/register" className="strong-link">{t("Create account")}</Link></p>
        <button type="button" className="sample-link" onClick={() => setF({ ...f, ...SAMPLE })}>
          {t("Sample account for the prototype:")} {SAMPLE.email} - {SAMPLE.password}
        </button>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const t = useT();
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", role: "Team lead", agree: false });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const v = {};
    if (!f.name.trim()) v.name = t("Write your full name.");
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) v.email = t("Write a valid email.");
    if (f.password.length < 8 || !/\d/.test(f.password)) v.password = t("At least 8 characters, with one number.");
    if (!f.agree) v.agree = t("Please agree to the Terms and the Privacy Policy.");
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setErr(null);
    try {
      const r = await api("auth/register", { method: "POST", body: { name: f.name, email: f.email, password: f.password, role: f.role } });
      signIn(r.token, r.user);
      nav("/");
    } catch (x) {
      const e2 = x.data?.errors || {};
      setErrors(Object.fromEntries(Object.entries(e2).map(([k, v]) => [k, t(v)])));
      setErr(t(x.message));
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="eyebrow-sm">{t("Get started")}</div>
        <h1 className="auth-title">{t("Create your account")}</h1>
        <p className="auth-sub">{t("Plan tasks with one owner and a deadline, and see your team's workload.")}</p>
        {err && <div className="alert alert-pill">{err}</div>}

        <div className="field">
          <label htmlFor="n">{t("Full name")}</label>
          <input id="n" className={`input input-lg ${errors.name ? "invalid" : ""}`} autoComplete="name" value={f.name} onChange={set("name")} autoFocus />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="e">{t("Email")}</label>
          <input id="e" type="email" className={`input input-lg ${errors.email ? "invalid" : ""}`} autoComplete="email" value={f.email} onChange={set("email")} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="p2">{t("Password")}</label>
          <input id="p2" type="password" autoComplete="new-password" className={`input input-lg ${errors.password ? "invalid" : ""}`} value={f.password} onChange={set("password")} />
          <span className={errors.password ? "field-error" : "hint"}>{t("At least 8 characters, with one number.")}</span>
        </div>

        <div className="field">
          <label>{t("I am a")}</label>
          <div className="toggle-row" role="radiogroup" aria-label={t("I am a")}>
            {["Team lead", "Team member"].map((r) => (
              <button type="button" key={r} role="radio" aria-checked={f.role === r} className={`choice ${f.role === r ? "on" : ""}`} onClick={() => setF({ ...f, role: r })}>{t(r)}</button>
            ))}
          </div>
          <span className="hint">{f.role === "Team lead" ? t("Team leads create projects and tasks and can delete projects.") : t("Team members work on their tasks. A team lead adds you to a project.")}</span>
        </div>

        <label className="check" style={{ marginBottom: errors.agree ? 4 : 20 }}>
          <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
          <span className="check-box">{Icon.check}</span> {t("I agree to the Terms and the Privacy Policy")}
        </label>
        {errors.agree && <div className="field-error" style={{ marginBottom: 16 }}>{errors.agree}</div>}

        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("Creating…") : t("Create account")}</button>
        <p className="auth-foot">{t("Already have an account?")} <Link to="/login" className="strong-link">{t("Sign in")}</Link></p>
      </form>
    </AuthLayout>
  );
}

export function SignedOut() {
  const t = useT();
  return (
    <AuthLayout>
      <div className="auth-card auth-card-center">
        <div className="done-circle" aria-hidden="true">✓</div>
        <h1 className="auth-title">{t("You have signed out")}</h1>
        <p className="auth-sub">{t("Your tasks and changes are saved. Sign in again to continue.")}</p>
        <Link to="/login" className="btn btn-primary btn-block">{t("Sign in again")}</Link>
      </div>
    </AuthLayout>
  );
}

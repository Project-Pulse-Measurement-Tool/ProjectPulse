import { useState } from "react";
import { api, getPrefs, savePrefs, setToken } from "../api.js";
import { useAuth } from "../ctx.js";
import { LANGS, useLang, useT } from "../i18n.js";
import { toast, useLogout } from "../ui.jsx";

/* Figma frame "Personal settings": profile, notifications, preferences (with the interface language). */

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-line">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-thumb" /></span>
      </span>
    </label>
  );
}

const TIME_ZONES = [
  ["Asia/Almaty", "Asia/Almaty (UTC+5)"],
  ["Asia/Aqtobe", "Asia/Aqtobe (UTC+5)"],
  ["Europe/Moscow", "Europe/Moscow (UTC+3)"],
  ["Europe/London", "Europe/London (UTC+0)"],
  ["UTC", "UTC"],
];
const DATE_FORMATS = [
  ["d MMM yyyy", "7 Nov 2026"],
  ["dd.MM.yyyy", "07.11.2026"],
  ["yyyy-MM-dd", "2026-11-07"],
];

export default function Account() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { user, setUser } = useAuth();
  const logout = useLogout();
  const m = user.member;
  const initial = { name: m?.name || "", email: user.email || "", role: m?.role || "" };
  const [f, setF] = useState(initial);
  const [pw, setPw] = useState(null); // null = not changing
  const [prefs, setPrefs] = useState({ ...getPrefs(), language: lang });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("profile");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setP = (k, v) => setPrefs({ ...prefs, [k]: v });

  const name = f.name || user.username;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  async function save(e) {
    e.preventDefault();
    const v = {};
    if (!f.name.trim()) v.name = t("Write your full name.");
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) v.email = t("Write a valid email.");
    if (pw !== null && (pw.length < 8 || !/\d/.test(pw))) v.password = t("At least 8 characters, with one number.");
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const body = { ...f };
      if (pw) body.password = pw;
      const r = await api("auth/me", { method: "PATCH", body });
      if (r.token) setToken(r.token, !!localStorageToken());
      const { token, ...u } = r;
      setUser(u);
      savePrefs(prefs);
      setLang(prefs.language);
      setPw(null);
      toast(t("Changes saved", {}, prefs.language));
    } catch (x) {
      setErrors(Object.fromEntries(Object.entries(x.data?.errors || {}).map(([k, val]) => [k, t(val)])));
      toast(t(x.message));
    } finally { setBusy(false); }
  }

  function cancel() {
    setF(initial); setPw(null); setPrefs({ ...getPrefs(), language: lang }); setErrors({});
  }

  const go = (id) => {
    setSection(id);
    document.getElementById(`acc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="account">
      <aside className="card account-side">
        <div className="avatar-xl" style={{ background: m?.color || "var(--primary)" }}>{initials}</div>
        <div className="account-name">{name}</div>
        <div className="account-role">{f.role || t("Team member")}</div>
        <span className={`badge ${user.is_lead ? "badge-ai" : "badge-soft"} role-badge`}>{user.is_lead ? t("Team lead") : t("Team member")}</span>
        <nav className="side-nav" aria-label={t("Settings sections")}>
          {[["profile", "Profile"], ["notifications", "Notifications"], ["preferences", "Preferences"]].map(([id, l]) => (
            <button key={id} type="button" className={section === id ? "on" : ""} onClick={() => go(id)}>{t(l)}</button>
          ))}
          <button type="button" className="danger" onClick={logout}>{t("Log out")}</button>
        </nav>
      </aside>

      <form className="card account-main" onSubmit={save} noValidate>
        <div className="eyebrow-sm">{t("Account")}</div>
        <h1 className="form-title">{t("Personal settings")}</h1>

        <h2 className="section-title" id="acc-profile">{t("Profile")}</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="a-name">{t("Full name")}</label>
            <input id="a-name" className={`input input-lg ${errors.name ? "invalid" : ""}`} value={f.name} onChange={set("name")} />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>
          <div className="field">
            <label htmlFor="a-email">{t("Email")}</label>
            <input id="a-email" type="email" className={`input input-lg ${errors.email ? "invalid" : ""}`} value={f.email} onChange={set("email")} placeholder="you@example.com" />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="a-role">{t("Role in team")}</label>
            <input id="a-role" className="input input-lg" value={f.role} onChange={set("role")} placeholder={t("e.g. Scrum Master, UX")} />
          </div>
          <div className="field">
            <label htmlFor="a-pw">{t("Password")}</label>
            {pw === null ? (
              <div className="input input-lg fake-input">
                <span className="dots">••••••••••</span> - <button type="button" className="link-btn" onClick={() => setPw("")}>{t("Change")}</button>
              </div>
            ) : (
              <>
                <input id="a-pw" type="password" autoFocus autoComplete="new-password" className={`input input-lg ${errors.password ? "invalid" : ""}`}
                  value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("New password")} />
                <span className={errors.password ? "field-error" : "hint"}>{t("At least 8 characters, with one number.")}</span>
              </>
            )}
          </div>
        </div>

        <h2 className="section-title" id="acc-notifications">{t("Notifications")}</h2>
        <Toggle label={t("Warn me 2 days before a task deadline")} checked={prefs.warn_2_days} onChange={(v) => setP("warn_2_days", v)} />
        <Toggle label={t("Notify me when my task becomes Delayed")} checked={prefs.notify_delayed} onChange={(v) => setP("notify_delayed", v)} />
        <Toggle label={t("Email me when I get a new task")} checked={prefs.email_new_task} onChange={(v) => setP("email_new_task", v)} />
        <Toggle label={t("Daily summary after the Daily Scrum (21:00)")} checked={prefs.daily_summary} onChange={(v) => setP("daily_summary", v)} />

        <h2 className="section-title" id="acc-preferences">{t("Preferences")}</h2>
        <div className="form-row form-row-3">
          <div className="field">
            <label htmlFor="a-tz">{t("Time zone")}</label>
            <select id="a-tz" className="input input-lg" value={prefs.time_zone} onChange={(e) => setP("time_zone", e.target.value)}>
              {TIME_ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-lang">{t("Language")}</label>
            <select id="a-lang" className="input input-lg" value={prefs.language} onChange={(e) => setP("language", e.target.value)}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-df">{t("Date format")}</label>
            <select id="a-df" className="input input-lg" value={prefs.date_format} onChange={(e) => setP("date_format", e.target.value)}>
              {DATE_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <p className="hint" style={{ marginTop: -4 }}>{t("The language changes after you press Save changes. Notification and preference choices are saved in this browser.")}</p>

        <div className="btn-row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? t("Saving…") : t("Save changes")}</button>
          <button type="button" className="btn btn-outline btn-lg" onClick={cancel}>{t("Cancel")}</button>
        </div>
      </form>
    </div>
  );
}

function localStorageToken() {
  try { return !!localStorage.getItem("pp_token"); } catch { return true; }
}

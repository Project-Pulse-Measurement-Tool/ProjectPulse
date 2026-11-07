import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./ctx.js";
import { LANGS, useLang, useT } from "./i18n.js";

export const STATUSES = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["review", "Review"],
  ["done", "Done"],
];
export const PRIORITIES = [
  ["highest", "Highest"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["lowest", "Lowest"],
];

export function Logo({ size = 50 }) {
  // Figma: white rounded tile with a hand-drawn dark "P".
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 50 50" aria-hidden="true">
      <rect width="50" height="50" rx="12" fill="#fff" />
      <path d="M18.5 39.5c-.6-8.4-.9-16.6-1.6-25.6" fill="none" stroke="#1d2536" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M14.2 15.6c6.6-5.2 18.6-5.6 19.6 2.2.9 6.9-7.4 9.6-14.8 8.6" fill="none" stroke="#1d2536" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Badge({ signal, big }) {
  const t = useT();
  if (!signal) return null;
  return <span className={`badge badge-${signal.state} ${big ? "badge-lg" : ""}`}>{t(signal.label)}</span>;
}

export function Priority({ value }) {
  const t = useT();
  const label = PRIORITIES.find((p) => p[0] === value)?.[1] || value;
  return <span className={`prio prio-${value}`}><i />{t(label)}</span>;
}

export function Avatar({ member, size }) {
  if (!member) return null;
  return (
    <span className={`avatar ${size === "lg" ? "avatar-lg" : ""}`} style={{ background: member.color }} title={member.name}>
      {member.initials}
    </span>
  );
}

export function Who({ member }) {
  return <span className="who"><Avatar member={member} /><span>{member?.name}</span></span>;
}

export function Modal({ title, sub, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {sub && <div className="card-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

export function Loading({ text }) {
  const t = useT();
  return <div className="loading"><span className="spinner" /> &nbsp;{text || t("Loading…")}</div>;
}

export function ErrorBox({ error }) {
  const t = useT();
  if (!error) return null;
  return <div className="alert">{t(String(error.message || error))}</div>;
}

let toastSetter = null;
export function toast(msg) { toastSetter && toastSetter(msg); }
export function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Renders the assistant's light markdown: **bold** and "- " bullet lines. */
export function RichText({ text }) {
  const lines = text.split("\n");
  const out = [];
  let list = [];
  const inline = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <b key={`${k}-${i}`}>{part.slice(2, -2)}</b> : part
    );
  const flush = () => {
    if (list.length) {
      out.push(<ul key={`ul${out.length}`} style={{ margin: "4px 0", paddingLeft: 18 }}>{list}</ul>);
      list = [];
    }
  };
  lines.forEach((l, i) => {
    if (/^\s*[-•*]\s+/.test(l)) list.push(<li key={i}>{inline(l.replace(/^\s*[-•*]\s+/, ""), i)}</li>);
    else {
      flush();
      if (l.trim()) out.push(<div key={i}>{inline(l, i)}</div>);
    }
  });
  flush();
  return <div style={{ whiteSpace: "normal" }}>{out}</div>;
}

export const Icon = {
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
  ),
  spark: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
  chevron: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  ext: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7" /></svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>
  ),
  sync: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></svg>
  ),
};

/** Log out and show the Figma "You have signed out" screen. */
export function useLogout() {
  const { signOut } = useAuth();
  const nav = useNavigate();
  return async () => { nav("/signed-out", { replace: true }); await signOut(); };
}

/** Static header used on the sign-in / sign-up / signed-out screens (Figma). */
export function AuthHeader({ name = "ProjectPulse MVP" }) {
  const t = useT();
  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <span className="brand-divider" />
        <div className="brand-text"><small>{t("Project")}</small><strong>{name}</strong></div>
      </div>
      <div className="header-center" />
      <LangSwitch />
    </header>
  );
}

/** Small language picker for the sign-in screens (the full one is in Personal settings). */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <select className="lang-switch" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
      {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

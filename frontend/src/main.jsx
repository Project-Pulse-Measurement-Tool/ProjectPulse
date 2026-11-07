import React, { useCallback, useEffect, useRef, useState } from "react";
import { AuthCtx, ProjectCtx, useAuth } from "./ctx.js";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams, Link, Outlet } from "react-router-dom";
import "./styles.css";
import { api, getToken, setToken, fmtDateTime, getPrefs, savePrefs, setDateLocale } from "./api.js";
import { LangCtx, translate, useT } from "./i18n.js";
import { Icon, Loading, Logo, ToastHost, useLogout } from "./ui.jsx";
import { Login, Register, SignedOut } from "./pages/Auth.jsx";
import Projects from "./pages/Projects.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Board from "./pages/Board.jsx";
import TaskList from "./pages/TaskList.jsx";
import TaskDetail from "./pages/TaskDetail.jsx";
import Workload from "./pages/Workload.jsx";
import Timeline from "./pages/Timeline.jsx";
import Analytics from "./pages/Analytics.jsx";
import Assistant from "./pages/Assistant.jsx";
import Settings from "./pages/Settings.jsx";
import AddTask from "./pages/AddTask.jsx";
import Account from "./pages/Account.jsx";


function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (!getToken()) return setUser(null);
    api("auth/me").then(setUser).catch(() => setUser(null));
    const out = () => setUser(null);
    window.addEventListener("pp:logout", out);
    return () => window.removeEventListener("pp:logout", out);
  }, []);
  const signIn = (token, u, remember = true) => { setToken(token, remember); setUser(u); };
  const signOut = async () => { try { await api("auth/logout", { method: "POST" }); } catch { /* already out */ } setToken(null); setUser(null); };
  return <AuthCtx.Provider value={{ user, setUser, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* ------------------------------------------------------------------ header pieces */
function Notifications() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, items: [] });
  const ref = useRef();
  const load = useCallback(() => api("notifications").then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggle = async () => {
    setOpen(!open);
    if (!open && data.unread) { const d = await api("notifications", { method: "POST" }); setTimeout(() => setData(d), 1500); }
  };
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="hdr-btn hdr-icon" onClick={toggle} aria-label={t("Notifications, {n} unread", { n: data.unread })}>
        {Icon.bell}{data.unread > 0 && <span className="dot-count">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="pop">
          <div className="pop-head">{t("Notifications")} <span className="muted small">{t("{n} recent", { n: data.items.length })}</span></div>
          {data.items.length === 0 && <div className="empty small">{t("No notifications. You will be notified when your task becomes Delayed.")}</div>}
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {data.items.map((n) => (
              <Link key={n.id} to={`/tasks/${n.task.id}`} className={`pop-item ${n.read ? "" : "unread"}`} onClick={() => setOpen(false)}>
                <span className={`badge badge-${n.kind === "delayed" ? "delayed" : "soft"}`} style={{ marginRight: 8 }}>{n.kind === "delayed" ? t("Delayed") : t("Assigned")}</span>
                {n.message}
                <div className="muted small" style={{ marginTop: 3 }}>{fmtDateTime(n.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectSwitch({ project }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const ref = useRef();
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggle = () => { setOpen(!open); if (!open) api("projects").then(setList).catch(() => {}); };
  return (
    <div className="project-switch" ref={ref}>
      <button className="project-switch-btn brand-text" onClick={toggle} aria-haspopup="listbox" title={t("Switch project")}>
        <small>{t("Project")}</small>
        <strong>{project ? project.name : t("All projects")} <span className="chev">{Icon.chevron}</span></strong>
      </button>
      {open && (
        <div className="pop pop-left" style={{ width: 300 }}>
          <Link className="pop-item" to="/" onClick={() => setOpen(false)}><b>{t("All projects")}</b></Link>
          {list.map((p) => (
            <Link key={p.id} className="pop-item" to={`/p/${p.id}`} onClick={() => setOpen(false)}>
              <b>{p.name}</b> <span className="muted small">- {p.key} - {t("{n} tasks", { n: p.total })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Figma header: logo - divider - "Project / name" on the left, actions (or a back link) on the right. */
export function Header({ project, center, right, switcher = true }) {
  const t = useT();
  return (
    <header className="app-header">
      <div className="brand">
        <Link to={project ? `/p/${project.id}` : "/"} aria-label="ProjectPulse home"><Logo /></Link>
        <span className="brand-divider" />
        {switcher ? <ProjectSwitch project={project} /> : (
          <div className="brand-text"><small>{t("Project")}</small><strong>{project ? project.name : t("All projects")}</strong></div>
        )}
      </div>
      <div className="header-center">{center}</div>
      <div className="header-actions">{right}</div>
    </header>
  );
}

export function BackLink({ to, children }) {
  const t = useT();
  return <Link to={to} className="back-link"><span aria-hidden="true">←</span> <u>{children || t("Back to project overview")}</u></Link>;
}

function OverviewActions({ project }) {
  const t = useT();
  const { user } = useAuth();
  const logout = useLogout();
  const base = project ? `/p/${project.id}` : "";
  return (
    <>
      <span className="header-note hide-sm">
        {project ? (project.source === "apache_jira" ? t("Live data from Apache Jira") : t("Team project data")) : t("Your projects")}
      </span>
      <Notifications />
      <Link to={`${base}/account`} className="hdr-btn">{t("Settings")}</Link>
      <button className="hdr-btn hide-sm" onClick={logout}>{t("Log out")}</button>
      {project && user?.is_lead && <Link to={`${base}/new`} className="hdr-btn hdr-btn-white">{Icon.plus}<span>{t("Add task")}</span></Link>}
    </>
  );
}

const NAV = [
  ["", "Overview"],
  ["board", "Board"],
  ["tasks", "Tasks"],
  ["workload", "Workload"],
  ["timeline", "Timeline"],
  ["analytics", "Analytics"],
  ["assistant", "AI Assistant"],
  ["settings", "Project settings"],
];

/* ------------------------------------------------------------------ project shell */
/** `focus` pages (task page, Add task, Personal settings) follow the Figma frames: no tab bar, a back link in the header. */
export function ProjectShell({ projectId: forcedId, focus = false, children }) {
  const t = useT();
  const params = useParams();
  const pid = forcedId || params.pid;
  const nav = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [pill, setPill] = useState(null);
  const reload = useCallback(() => {
    api(`projects/${pid}`).then(setProject).catch(setError);
  }, [pid]);
  useEffect(() => { if (pid) reload(); }, [pid, reload, version]);
  const bump = () => setVersion((v) => v + 1);

  if (error) return <div className="page"><div className="alert">{error.status === 404 ? t("This project does not exist or you do not have access to it.") : error.message}</div><Link to="/">{t("Back to projects")}</Link></div>;
  return (
    <ProjectCtx.Provider value={{ project, reload, bump, version, setPill, openAdd: () => nav(`/p/${pid}/new`) }}>
      {focus ? (
        <Header project={project} switcher={false}
          center={pill && <span className="header-pill" role="status">{Icon.check} {pill}</span>}
          right={project && <BackLink to={`/p/${project.id}`} />} />
      ) : (
        <Header project={project} right={<OverviewActions project={project} />} />
      )}
      {project && !focus && (
        <nav className="nav" aria-label="Project">
          {NAV.map(([path, label]) => (
            <NavLink key={path} end={path === ""} to={`/p/${project.id}${path ? "/" + path : ""}`}>
              {path === "assistant" && Icon.spark}{t(label)}
            </NavLink>
          ))}
        </nav>
      )}
      <main className={`page ${focus ? "page-focus" : ""}`}>{project ? children || <Outlet /> : <Loading />}</main>
    </ProjectCtx.Provider>
  );
}

function TaskRoute() {
  const t = useT();
  const { tid } = useParams();
  const [pid, setPid] = useState(null);
  useEffect(() => { api(`tasks/${tid}`).then((t) => setPid(t.project.id)).catch(() => setPid("none")); }, [tid]);
  if (!pid) return <Loading />;
  if (pid === "none") return <div className="page"><div className="alert">{t("Task not found.")}</div><Link to="/">{t("Back")}</Link></div>;
  return <ProjectShell projectId={pid} focus><TaskDetail key={tid} /></ProjectShell>;
}

function Home() {
  return (
    <>
      <Header project={null} right={<OverviewActions project={null} />} />
      <main className="page"><Projects /></main>
    </>
  );
}

function AccountHome() {
  const t = useT();
  return (
    <>
      <Header project={null} right={<BackLink to="/">{t("Back to projects")}</BackLink>} />
      <main className="page page-focus"><Account /></main>
    </>
  );
}

function App() {
  const [lang, setLangState] = useState(() => getPrefs().language);
  const setLang = (l) => { setLangState(l); savePrefs({ ...getPrefs(), language: l }); };
  setDateLocale(lang, (k, v) => translate(lang, { today: "today", tomorrow: "tomorrow", yesterday: "yesterday", in: "in {n} days", ago: "{n} days ago" }[k], v));
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/signed-out" element={<SignedOut />} />
          <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><AccountHome /></RequireAuth>} />
          <Route path="/tasks/:tid" element={<RequireAuth><TaskRoute /></RequireAuth>} />
          <Route path="/p/:pid/new" element={<RequireAuth><ProjectShell focus><AddTask /></ProjectShell></RequireAuth>} />
          <Route path="/p/:pid/account" element={<RequireAuth><ProjectShell focus><Account /></ProjectShell></RequireAuth>} />
          <Route path="/p/:pid" element={<RequireAuth><ProjectShell /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="board" element={<Board />} />
            <Route path="tasks" element={<TaskList />} />
            <Route path="workload" element={<Workload />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastHost />
      </BrowserRouter>
    </AuthProvider>
    </LangCtx.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);

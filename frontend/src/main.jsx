import React, { useCallback, useEffect, useRef, useState } from "react";
import { AuthCtx, ProjectCtx, useAuth } from "./ctx.js";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams, Link, Outlet } from "react-router-dom";
import "./styles.css";
import { api, getToken, setToken, fmtDateTime } from "./api.js";
import { Icon, Loading, Logo, Modal, ToastHost, toast, PRIORITIES, STATUSES } from "./ui.jsx";
import { Login, Register } from "./pages/Auth.jsx";
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


function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (!getToken()) return setUser(null);
    api("auth/me").then(setUser).catch(() => setUser(null));
    const out = () => setUser(null);
    window.addEventListener("pp:logout", out);
    return () => window.removeEventListener("pp:logout", out);
  }, []);
  const signIn = (token, u) => { setToken(token); setUser(u); };
  const signOut = async () => { try { await api("auth/logout", { method: "POST" }); } catch { /* already out */ } setToken(null); setUser(null); };
  return <AuthCtx.Provider value={{ user, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* ------------------------------------------------------------------ Add task form (US4) */
export function TaskForm({ project, members, onClose, onSaved, initial }) {
  const [f, setF] = useState({
    title: "", owner: "", due_date: "", priority: "medium", status: "todo", issue_type: "Task", description: "", estimate_hours: "",
    ...initial,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErrors({});
    try {
      const t = await api(`projects/${project.id}/tasks`, { method: "POST", body: { ...f, owner: f.owner ? Number(f.owner) : null } });
      toast(`${t.key} created and assigned to ${t.owner.name}`);
      onSaved && onSaved(t);
      onClose();
    } catch (err) {
      setErrors(err.data?.errors || {});
      setMsg(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Add task" sub={`${project.name} · every task needs one owner and a deadline`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {msg && <div className="alert">{msg}</div>}
        <div className="field">
          <label htmlFor="t-title">Title</label>
          <input id="t-title" className={`input ${errors.title ? "invalid" : ""}`} value={f.title} onChange={set("title")} autoFocus placeholder="e.g. Build the workload view template" />
          {errors.title && <span className="field-error">{errors.title}</span>}
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="t-owner">Owner</label>
            <select id="t-owner" className={`input ${errors.owner ? "invalid" : ""}`} value={f.owner} onChange={set("owner")}>
              <option value="">Choose one owner…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {errors.owner && <span className="field-error">{errors.owner}</span>}
          </div>
          <div className="field">
            <label htmlFor="t-due">Deadline</label>
            <input id="t-due" type="date" className={`input ${errors.due_date ? "invalid" : ""}`} value={f.due_date} onChange={set("due_date")} />
            {errors.due_date && <span className="field-error">{errors.due_date}</span>}
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="t-prio">Priority</label>
            <select id="t-prio" className="input" value={f.priority} onChange={set("priority")}>
              {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-status">Status</label>
            <select id="t-status" className="input" value={f.status} onChange={set("status")}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="t-type">Type</label>
            <select id="t-type" className="input" value={f.issue_type} onChange={set("issue_type")}>
              {["Task", "Story", "Bug", "Design", "Research", "Test", "Docs"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-est">Estimate (hours)</label>
            <input id="t-est" type="number" min="0" step="0.5" className="input" value={f.estimate_hours} onChange={set("estimate_hours")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="t-desc">Description</label>
          <textarea id="t-desc" rows={3} className="input" value={f.description} onChange={set("description")} />
        </div>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save task"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ header pieces */
function Notifications() {
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
      <button className="icon-btn" onClick={toggle} aria-label={`Notifications, ${data.unread} unread`}>
        {Icon.bell}{data.unread > 0 && <span className="dot-count">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="pop">
          <div className="pop-head">Notifications <span className="muted small">{data.items.length} recent</span></div>
          {data.items.length === 0 && <div className="empty small">No notifications. You will be notified when your task becomes Delayed.</div>}
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {data.items.map((n) => (
              <Link key={n.id} to={`/tasks/${n.task.id}`} className={`pop-item ${n.read ? "" : "unread"}`} onClick={() => setOpen(false)}>
                <span className={`badge badge-${n.kind === "delayed" ? "delayed" : "soft"}`} style={{ marginRight: 8 }}>{n.kind === "delayed" ? "Delayed" : "Assigned"}</span>
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
      <button className="project-switch-btn brand-text" onClick={toggle} aria-haspopup="listbox">
        <small>Project</small>
        <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>{project ? project.name : "All projects"} {Icon.chevron}</strong>
      </button>
      {open && (
        <div className="pop pop-left" style={{ width: 300 }}>
          <Link className="pop-item" to="/" onClick={() => setOpen(false)}><b>All projects</b></Link>
          {list.map((p) => (
            <Link key={p.id} className="pop-item" to={`/p/${p.id}`} onClick={() => setOpen(false)}>
              <b>{p.name}</b> <span className="muted small">· {p.key} · {p.total} tasks</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const m = user?.member;
  return (
    <div style={{ position: "relative" }}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Account" style={{ background: "transparent" }}>
        {m ? <span className="avatar avatar-lg" style={{ background: m.color }}>{m.initials}</span> : user?.username?.[0]?.toUpperCase()}
      </button>
      {open && (
        <div className="pop" style={{ width: 220 }} onMouseLeave={() => setOpen(false)}>
          <div className="pop-head" style={{ display: "block" }}>{m?.name || user.username}<div className="muted small">{m?.role}</div></div>
          <button className="pop-item" onClick={async () => { await signOut(); nav("/login"); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Header({ project, onAdd }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="ProjectPulse home"><Logo /></Link>
      <span className="brand-divider" />
      <ProjectSwitch project={project} />
      <div className="header-spacer" />
      <div className="header-actions">
        {project?.source === "apache_jira" && <span className="header-note hide-sm">Live data from Apache Jira</span>}
        {project && <Link to={`/p/${project.id}/assistant`} className="icon-btn hide-sm" aria-label="AI assistant" title="AI assistant">{Icon.spark}</Link>}
        <Notifications />
        {project && onAdd && <button className="btn btn-white" onClick={onAdd}>{Icon.plus}<span className="hide-sm">Add task</span></button>}
        <UserMenu />
      </div>
    </header>
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
  ["settings", "Settings"],
];

/* ------------------------------------------------------------------ project shell */
export function ProjectShell({ projectId: forcedId, children }) {
  const params = useParams();
  const pid = forcedId || params.pid;
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    api(`projects/${pid}`).then(setProject).catch(setError);
  }, [pid]);
  useEffect(() => { if (pid) reload(); }, [pid, reload, version]);
  const bump = () => setVersion((v) => v + 1);

  if (error) return <div className="page"><div className="alert">{error.message}</div><Link to="/">Back to projects</Link></div>;
  return (
    <ProjectCtx.Provider value={{ project, reload, bump, version, openAdd: () => setAdding(true) }}>
      <Header project={project} onAdd={() => setAdding(true)} />
      {project && (
        <nav className="nav" aria-label="Project">
          {NAV.map(([path, label]) => (
            <NavLink key={path} end={path === ""} to={`/p/${project.id}${path ? "/" + path : ""}`}>
              {path === "assistant" && Icon.spark}{label}
            </NavLink>
          ))}
        </nav>
      )}
      <main className="page">{project ? children || <Outlet /> : <Loading />}</main>
      {adding && project && (
        <TaskForm project={project} members={project.members} onClose={() => setAdding(false)} onSaved={() => { bump(); }} />
      )}
    </ProjectCtx.Provider>
  );
}

function TaskRoute() {
  const { tid } = useParams();
  const [pid, setPid] = useState(null);
  useEffect(() => { api(`tasks/${tid}`).then((t) => setPid(t.project.id)).catch(() => setPid("none")); }, [tid]);
  if (!pid) return <Loading />;
  if (pid === "none") return <div className="page"><div className="alert">Task not found.</div><Link to="/">Back</Link></div>;
  return <ProjectShell projectId={pid}><TaskDetail key={tid} /></ProjectShell>;
}

function Home() {
  return (
    <>
      <Header project={null} />
      <main className="page"><Projects /></main>
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="/tasks/:tid" element={<RequireAuth><TaskRoute /></RequireAuth>} />
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
  );
}

createRoot(document.getElementById("root")).render(<App />);

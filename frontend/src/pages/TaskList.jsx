import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fmtDate, relDays } from "../api.js";
import { useProject } from "../ctx.js";
import { Badge, ErrorBox, Loading, Priority, STATUSES, Who } from "../ui.jsx";
import { useTasks } from "./Board.jsx";

const SIGNALS = [
  ["", "All"],
  ["delayed,at_risk,due_today", "Late or at risk"],
  ["delayed", "Delayed"],
  ["at_risk", "At risk"],
  ["on_track", "On track"],
  ["done", "Done"],
];

export default function TaskList() {
  const { project, version } = useProject();
  const [sp, setSp] = useSearchParams();
  const params = Object.fromEntries(sp.entries());
  const query = useMemo(() => {
    const qs = new URLSearchParams();
    ["status", "owner", "signal", "priority", "ordering"].forEach((k) => params[k] && qs.set(k, params[k]));
    if (!params.ordering) qs.set("ordering", "risk");
    return "?" + qs.toString();
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tasks, , err] = useTasks(project, version, query);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const q = (params.q || "").toLowerCase();
  const shown = tasks ? tasks.filter((t) => !q || (t.key + " " + t.title).toLowerCase().includes(q)) : [];

  return (
    <>
      <div className="page-head">
        <div><h1>Tasks</h1><p>Warnings show the reason. A task past its deadline that is not Done is labelled “Delayed”.</p></div>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Signal filter">
          {SIGNALS.map(([v, l]) => (
            <button key={l} className={(params.signal || "") === v ? "on" : ""} onClick={() => set("signal", v)}>{l}</button>
          ))}
        </div>
        <input className="input" placeholder="Search…" value={params.q || ""} onChange={(e) => set("q", e.target.value)} />
        <select className="input" value={params.status || ""} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input" value={params.owner || ""} onChange={(e) => set("owner", e.target.value)} aria-label="Owner">
          <option value="">Any owner</option>
          {project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="input" value={params.ordering || "risk"} onChange={(e) => set("ordering", e.target.value)} aria-label="Sort">
          <option value="risk">Sort: risk first</option>
          <option value="due">Sort: deadline</option>
          <option value="priority">Sort: priority</option>
          <option value="updated">Sort: recently updated</option>
        </select>
      </div>
      <div className="card" style={{ padding: "8px 12px" }}>
        <ErrorBox error={err} />
        {!tasks ? <Loading /> : shown.length === 0 ? <div className="empty">No tasks match these filters.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Key</th><th>Title</th><th>Owner</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Warning</th></tr></thead>
              <tbody>
                {shown.slice(0, 400).map((t) => (
                  <tr key={t.id}>
                    <td className="small muted" style={{ whiteSpace: "nowrap" }}>{t.key}</td>
                    <td>
                      <Link to={`/tasks/${t.id}`} className="t-title">{t.title}</Link>
                      {t.signal.reasons.length > 0 && <div className="small muted">{t.signal.reasons[0]}</div>}
                    </td>
                    <td><Who member={t.owner} /></td>
                    <td className="small">{t.status_label}</td>
                    <td><Priority value={t.priority} /></td>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      <b>{fmtDate(t.due_date)}</b>
                      <div className="muted">{t.status !== "done" ? relDays(t.signal.days_left) : ""}{t.due_source === "estimated" ? " · est." : ""}</div>
                    </td>
                    <td><Badge signal={t.signal} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 400 && <div className="empty small">Showing 400 of {shown.length}. Narrow the filters to see the rest.</div>}
          </div>
        )}
      </div>
    </>
  );
}

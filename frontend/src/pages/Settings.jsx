import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDateTime } from "../api.js";
import { useProject } from "../ctx.js";
import { ErrorBox, Icon, Who, toast } from "../ui.jsx";

export default function Settings() {
  const { project, reload, bump } = useProject();
  const [f, setF] = useState({ name: project.name, goal: project.goal, description: project.description, workload_limit: project.workload_limit });
  const [err, setErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try { await api(`projects/${project.id}`, { method: "PATCH", body: f }); reload(); bump(); toast("Project saved"); }
    catch (x) { setErr(x); }
  }
  async function sync() {
    setSyncing(true); setErr(null);
    try { await api(`projects/${project.id}/sync`, { method: "POST" }); reload(); bump(); toast("Synced with Apache Jira"); }
    catch (x) { setErr(x); } finally { setSyncing(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${project.name} and all its tasks? This cannot be undone.`)) return;
    await api(`projects/${project.id}`, { method: "DELETE" });
    nav("/");
  }

  return (
    <>
      <div className="page-head"><div><h1>Project settings</h1><p>{project.key} · {project.source === "apache_jira" ? "Imported from Apache Jira" : "Team project"}</p></div></div>
      <div className="grid grid-dash">
        <form className="card" onSubmit={save}>
          <ErrorBox error={err} />
          <div className="field"><label htmlFor="s-n">Name</label><input id="s-n" className="input" value={f.name} onChange={set("name")} /></div>
          <div className="field"><label htmlFor="s-g">Goal</label><textarea id="s-g" className="input" rows={2} value={f.goal} onChange={set("goal")} /></div>
          <div className="field"><label htmlFor="s-d">Description</label><textarea id="s-d" className="input" rows={4} value={f.description} onChange={set("description")} /></div>
          <div className="field">
            <label htmlFor="s-l">Workload limit (open tasks per member)</label>
            <input id="s-l" type="number" min={1} max={50} className="input" value={f.workload_limit} onChange={set("workload_limit")} />
            <span className="hint">A member with more open tasks than this is shown as “above limit”.</span>
          </div>
          <button className="btn btn-primary">Save</button>
        </form>
        <div className="grid">
          {project.source === "apache_jira" && (
            <section className="card">
              <div className="card-title">Live data</div>
              <p className="small muted">Last synced {project.last_synced ? fmtDateTime(project.last_synced) : "never"} from <a href={project.source_url} target="_blank" rel="noreferrer">{project.source_url}</a>.</p>
              <button className="btn btn-outline" onClick={sync} disabled={syncing}>{Icon.sync} {syncing ? "Syncing…" : "Sync now"}</button>
            </section>
          )}
          <section className="card">
            <div className="card-title">Members <span className="muted small">{project.members.length}</span></div>
            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
              {project.members.map((m) => <div key={m.id} style={{ padding: "5px 0" }}><Who member={m} /> <span className="muted small">{m.role}</span></div>)}
            </div>
          </section>
          <section className="card">
            <div className="card-title">Danger zone</div>
            <p className="small muted">Deleting a project removes all its tasks, comments and notifications.</p>
            <button className="btn btn-danger" onClick={remove}>Delete project</button>
          </section>
        </div>
      </div>
    </>
  );
}

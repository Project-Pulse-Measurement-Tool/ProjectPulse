import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDateTime } from "../api.js";
import { ErrorBox, Icon, Loading, Modal, toast } from "../ui.jsx";

function healthColor(h) {
  return h >= 75 ? "var(--green)" : h >= 50 ? "#e0a526" : "var(--red)";
}

function ImportModal({ onClose, onDone }) {
  const [catalog, setCatalog] = useState([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { api("jira/catalog").then(setCatalog).catch(() => {}); }, []);
  async function run(k) {
    setBusy(k); setErr(null);
    try {
      const p = await api("jira/import", { method: "POST", body: { key: k } });
      toast(`Imported ${p.total} live issues from Apache ${p.key}`);
      onDone(p);
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <Modal title="Import from Apache Jira" sub="Real, public issues from issues.apache.org: owners, statuses, priorities, release dates and comments." onClose={onClose}>
      <ErrorBox error={err} />
      <div className="grid grid-2" style={{ gap: 10, marginBottom: 16 }}>
        {catalog.map((c) => (
          <button key={c.key} className="btn btn-outline" style={{ justifyContent: "space-between" }} disabled={!!busy} onClick={() => run(c.key)}>
            <span>{c.name}</span>
            {busy === c.key ? <span className="spinner" /> : <span className="muted small">{c.imported ? "Re-sync" : c.key}</span>}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); key && run(key); }} className="btn-row">
        <input className="input" style={{ flex: 1 }} placeholder="Any other Apache project key, e.g. KAFKA" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} />
        <button className="btn btn-primary" disabled={!key || !!busy}>Import</button>
      </form>
      <p className="hint" style={{ marginTop: 12 }}>
        Imports up to 250 issues updated in the last 90 days that have an assignee. Deadlines come from the Jira due date, then the
        fix-version release date; otherwise they are estimated from priority and marked as estimated.
      </p>
    </Modal>
  );
}

function CreateModal({ onClose, onDone }) {
  const [f, setF] = useState({ key: "", name: "", description: "", goal: "", workload_limit: 3 });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    try { onDone(await api("projects", { method: "POST", body: f })); } catch (x) { setErr(x); }
  }
  return (
    <Modal title="New project" sub="Start an empty project for your team." onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-row">
          <div className="field"><label htmlFor="pk">Key</label><input id="pk" className="input" maxLength={10} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} placeholder="WEB" /></div>
          <div className="field"><label htmlFor="pl">Workload limit</label><input id="pl" type="number" min={1} className="input" value={f.workload_limit} onChange={set("workload_limit")} /></div>
        </div>
        <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" value={f.name} onChange={set("name")} /></div>
        <div className="field"><label htmlFor="pg">Goal</label><input id="pg" className="input" value={f.goal} onChange={set("goal")} /></div>
        <div className="field"><label htmlFor="pd">Description</label><textarea id="pd" className="input" rows={3} value={f.description} onChange={set("description")} /></div>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Create project</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api("projects").then(setList).catch(setErr); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!list) return <Loading />;
  const done = (p) => { setModal(null); nav(`/p/${p.id}`); };
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>{list.length} projects · {list.reduce((a, p) => a + p.total, 0).toLocaleString()} tasks tracked</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-outline" onClick={() => setModal("import")}>{Icon.sync} Import from Apache Jira</button>
          <button className="btn btn-primary" onClick={() => setModal("create")}>{Icon.plus} New project</button>
        </div>
      </div>
      <div className="grid grid-3">
        {list.map((p) => (
          <Link key={p.id} to={`/p/${p.id}`} className="card proj-card">
            <div className="proj-key">
              <span>{p.key} · {p.source === "apache_jira" ? "Apache Jira · live" : "Team project"}</span>
              <span className={`badge ${p.health >= 75 ? "badge-on_track" : p.health >= 50 ? "badge-due_today" : "badge-at_risk"}`}>{p.health_label}</span>
            </div>
            <div className="proj-name">{p.name}</div>
            <div className="proj-desc">{p.description}</div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                <span><b>{p.percent}%</b> done</span><span className="muted">{p.done} of {p.total}</span>
              </div>
              <div className="bar"><span style={{ width: `${p.percent}%`, background: "var(--green)" }} /></div>
            </div>
            <div className="proj-stats">
              <span>Health <b style={{ color: healthColor(p.health) }}>{p.health}</b></span>
              <span>Late <b>{p.late}</b></span>
              <span>People <b>{p.people}</b></span>
            </div>
            {p.last_synced && <div className="hint">Synced {fmtDateTime(p.last_synced)}</div>}
          </Link>
        ))}
      </div>
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onDone={done} />}
      {modal === "create" && <CreateModal onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

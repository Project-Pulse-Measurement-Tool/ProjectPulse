import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDateTime } from "../api.js";
import { useAuth, useProject } from "../ctx.js";
import { useT } from "../i18n.js";
import { ErrorBox, Icon, Who, toast } from "../ui.jsx";

export default function Settings() {
  const t = useT();
  const { user } = useAuth();
  const lead = !!user?.is_lead;
  const { project, reload, bump } = useProject();
  const [f, setF] = useState({ name: project.name, goal: project.goal, description: project.description, workload_limit: project.workload_limit });
  const [err, setErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [email, setEmail] = useState("");
  const [memberErr, setMemberErr] = useState(null);
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setErr(null);
    try { await api(`projects/${project.id}`, { method: "PATCH", body: f }); reload(); bump(); toast(t("Project saved")); }
    catch (x) { setErr(x); }
  }
  async function sync() {
    setSyncing(true); setErr(null);
    try { await api(`projects/${project.id}/sync`, { method: "POST" }); reload(); bump(); toast(t("Synced with Apache Jira")); }
    catch (x) { setErr(x); } finally { setSyncing(false); }
  }
  async function remove() {
    if (!window.confirm(t("Delete {name} and all its tasks? This cannot be undone.", { name: project.name }))) return;
    try { await api(`projects/${project.id}`, { method: "DELETE" }); nav("/"); }
    catch (x) { setErr(x); }
  }
  async function addMember(e) {
    e.preventDefault();
    setMemberErr(null);
    try {
      await api(`projects/${project.id}/members`, { method: "POST", body: { email } });
      toast(t("{email} was added to the project", { email }));
      setEmail(""); reload(); bump();
    } catch (x) { setMemberErr(x); }
  }
  async function removeMember(m) {
    if (!window.confirm(t("Remove {name} from {project}?", { name: m.name, project: project.name }))) return;
    setMemberErr(null);
    try { await api(`projects/${project.id}/members/${m.id}`, { method: "DELETE" }); reload(); bump(); }
    catch (x) { setMemberErr(x); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow-sm">{t("Project")}</div>
          <h1>{t("Project settings")}</h1>
          <p>{project.key} - {project.source === "apache_jira" ? t("Imported from Apache Jira") : t("Team project")}</p>
        </div>
      </div>
      <div className="grid grid-dash">
        <form className="card" onSubmit={save}>
          <ErrorBox error={err} />
          <div className="field"><label htmlFor="s-n">{t("Name")}</label><input id="s-n" className="input input-lg" value={f.name} onChange={set("name")} /></div>
          <div className="field"><label htmlFor="s-g">{t("Goal")}</label><textarea id="s-g" className="input" rows={2} value={f.goal} onChange={set("goal")} /></div>
          <div className="field"><label htmlFor="s-d">{t("Description")}</label><textarea id="s-d" className="input" rows={4} value={f.description} onChange={set("description")} /></div>
          <div className="field">
            <label htmlFor="s-l">{t("Workload limit (open tasks per member)")}</label>
            <input id="s-l" type="number" min={1} max={50} className="input input-lg" value={f.workload_limit} onChange={set("workload_limit")} />
            <span className="hint">{t("A member with more open tasks than this is shown as “above limit”.")}</span>
          </div>
          <button className="btn btn-primary btn-lg">{t("Save")}</button>
        </form>
        <div className="grid">
          {project.source === "apache_jira" && (
            <section className="card">
              <div className="card-title">{t("Live data")}</div>
              <p className="small muted">{t("Last synced {d} from", { d: project.last_synced ? fmtDateTime(project.last_synced) : t("never") })} <a href={project.source_url} target="_blank" rel="noreferrer">{project.source_url}</a>.</p>
              <button className="btn btn-outline" onClick={sync} disabled={syncing}>{Icon.sync} {syncing ? t("Syncing…") : t("Sync now")}</button>
            </section>
          )}
          <section className="card">
            <div className="card-title">{t("Members")} <span className="muted small">{project.members.length}</span></div>
            <ErrorBox error={memberErr} />
            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
              {project.members.map((m) => (
                <div key={m.id} className="member-row">
                  <Who member={m} /> <span className="muted small">{m.role}</span>
                  {m.is_lead && <span className="badge badge-ai">{t("Team lead")}</span>}
                  {lead && m.has_login && m.id !== user.member?.id && (
                    <button className="btn btn-ghost btn-sm member-remove" onClick={() => removeMember(m)} aria-label={t("Remove {name}", { name: m.name })}>✕</button>
                  )}
                </div>
              ))}
            </div>
            {lead ? (
              <form className="btn-row" style={{ marginTop: 14 }} onSubmit={addMember}>
                <input className="input" style={{ flex: 1, minWidth: 180 }} type="text" placeholder={t("Teammate's email")} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t("Teammate's email")} />
                <button className="btn btn-primary" disabled={!email.trim()}>{Icon.plus} {t("Add member")}</button>
              </form>
            ) : (
              <p className="hint" style={{ marginTop: 12 }}>{t("Only the team lead can add people to the project.")}</p>
            )}
          </section>
          <section className="card">
            <div className="card-title">{t("Danger zone")}</div>
            {lead ? (
              <>
                <p className="small muted">{t("Deleting a project removes all its tasks, comments and notifications.")}</p>
                <button className="btn btn-danger" onClick={remove}>{t("Delete project")}</button>
              </>
            ) : (
              <p className="small muted">{t("Only the team lead can delete this project.")}</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

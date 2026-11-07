import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useProject } from "../ctx.js";
import { PRIORITIES, STATUSES, toast } from "../ui.jsx";
import { useAuth } from "../ctx.js";
import { useT } from "../i18n.js";

/* Figma frames "Add task": empty, error (no owner), owner chosen. US4: one owner + a deadline are required. */
export default function AddTask() {
  const t = useT();
  const { user } = useAuth();
  const { project, bump } = useProject();
  const nav = useNavigate();
  const [f, setF] = useState({
    title: "", owner: null, due_date: "", priority: "medium", status: "todo", issue_type: "Task", description: "", estimate_hours: "",
  });
  const [open, setOpen] = useState({});
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const limit = project.workload_limit;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api(`projects/${project.id}/workload`)
      .then((w) => {
        const rows = Array.isArray(w) ? w : w.rows || w.workload || w.members || [];
        setOpen(Object.fromEntries(rows.map((r) => [r.member ?? r.id, r.open ?? 0])));
      })
      .catch(() => {});
  }, [project.id]);

  const members = [...project.members].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = members.find((m) => m.id === f.owner);

  async function submit(e) {
    e.preventDefault();
    const v = {};
    if (!f.title.trim()) v.title = t("Write a task name.");
    if (!f.owner) v.owner = t("Owner is required. A task without an owner is not saved.");
    if (!f.due_date) v.due_date = t("Choose a due date.");
    setErrors(v);
    if (Object.keys(v).length) {
      setMsg(v.owner ? t("Task not saved. Choose an owner: every task needs one owner (US1 AC2).") : t("Task not saved. Fill in the required fields."));
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const task = await api(`projects/${project.id}/tasks`, { method: "POST", body: { ...f } });
      toast(t("{key} saved and assigned to {name}", { key: task.key, name: task.owner.name }));
      bump();
      nav(`/p/${project.id}`);
    } catch (err) {
      setErrors(Object.fromEntries(Object.entries(err.data?.errors || {}).map(([k, v]) => [k, t(v)])));
      setMsg(`${t("Task not saved.")} ${t(err.message)}`);
    } finally { setBusy(false); }
  }

  let ownerHint = t("Choose one person. Open tasks per member are shown on the overview (limit {limit}).", { limit });
  if (chosen) {
    const n = open[chosen.id] ?? 0;
    const v = { name: chosen.name, n, limit };
    ownerHint = n < limit
      ? t("{name} has {n} open tasks, below the limit of {limit}. Ready to save.", v)
      : n === limit
        ? t("{name} has {n} open tasks, at the limit of {limit}. This task will put them above it.", v)
        : t("{name} has {n} open tasks, above the limit of {limit}. Consider choosing someone else.", v);
  }

  if (!user?.is_lead) {
    return (
      <div className="card form-card">
        <div className="eyebrow-sm">{t("New task")}</div>
        <h1 className="form-title">{t("Add task")}</h1>
        <div className="alert alert-pill">{t("Only the team lead can create tasks.")}</div>
        <p className="hint" style={{ marginBottom: 20 }}>{t("You can still change the status of your tasks, comment and add subtasks. Ask your team lead to add a new task.")}</p>
        <button className="btn btn-primary btn-lg" onClick={() => nav(`/p/${project.id}`)}>{t("Back to project overview")}</button>
      </div>
    );
  }
  const ownerOver = chosen && (open[chosen.id] ?? 0) >= limit;

  return (
    <form className="card form-card" onSubmit={submit} noValidate>
      <div className="eyebrow-sm">{t("New task")}</div>
      <h1 className="form-title">{t("Add task")}</h1>

      {msg && <div className="alert alert-pill">{msg}</div>}

      <div className="field">
        <label htmlFor="t-title">{t("Task name")}</label>
        <input id="t-title" className={`input input-lg ${errors.title ? "invalid" : ""}`} value={f.title} onChange={set("title")} autoFocus
          placeholder={t("e.g. T15 Prepare the Review demo script")} />
        {errors.title && <span className="field-error">{errors.title}</span>}
      </div>

      <div className="field">
        <label className={errors.owner ? "label-error" : ""}>{t("Owner (required)")}</label>
        <div className={errors.owner ? "owner-box error" : "owner-box"}>
          <div className="toggle-row owner-pills" role="radiogroup" aria-label={t("Owner")}>
            {members.map((m) => (
              <button type="button" key={m.id} role="radio" aria-checked={f.owner === m.id}
                className={`choice ${f.owner === m.id ? "on" : ""}`}
                onClick={() => { setF({ ...f, owner: m.id }); setErrors({ ...errors, owner: undefined }); if (msg && errors.owner) setMsg(null); }}>
                {m.name}
              </button>
            ))}
          </div>
          {errors.owner && <div className="owner-error">{errors.owner}</div>}
        </div>
        {!errors.owner && <span className={`hint ${ownerOver ? "hint-warn" : ""}`}>{ownerHint}</span>}
      </div>

      <div className="field">
        <label htmlFor="t-due">{t("Due date (required)")}</label>
        <input id="t-due" type="date" className={`input input-lg ${errors.due_date ? "invalid" : ""}`} value={f.due_date} onChange={set("due_date")} />
        {errors.due_date && <span className="field-error">{errors.due_date}</span>}
      </div>

      <button type="button" className="link-btn more-toggle" onClick={() => setMore(!more)} aria-expanded={more}>
        {more ? "− " + t("Hide extra details") : "+ " + t("More details (priority, status, description)")}
      </button>
      {more && (
        <div className="more-box">
          <div className="form-row">
            <div className="field">
              <label htmlFor="t-prio">{t("Priority")}</label>
              <select id="t-prio" className="input input-lg" value={f.priority} onChange={set("priority")}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="t-status">{t("Status")}</label>
              <select id="t-status" className="input input-lg" value={f.status} onChange={set("status")}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="t-type">{t("Type")}</label>
              <select id="t-type" className="input input-lg" value={f.issue_type} onChange={set("issue_type")}>
                {["Task", "Story", "Bug", "Design", "Research", "Test", "Docs"].map((x) => <option key={x} value={x}>{t(x)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="t-est">{t("Estimate (hours)")}</label>
              <input id="t-est" type="number" min="0" step="0.5" className="input input-lg" value={f.estimate_hours} onChange={set("estimate_hours")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-desc">{t("Description")}</label>
            <textarea id="t-desc" rows={3} className="input" value={f.description} onChange={set("description")} />
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? t("Saving…") : t("Save task")}</button>
        <button type="button" className="btn btn-outline btn-lg" onClick={() => nav(-1)}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

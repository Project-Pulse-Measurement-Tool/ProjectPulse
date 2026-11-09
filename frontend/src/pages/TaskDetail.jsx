import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate, fmtDateTime, relDays } from "../api.js";
import { useProject } from "../ctx.js";
import { Badge, ErrorBox, Icon, Loading, Priority, PRIORITIES, STATUSES, toast } from "../ui.jsx";
import { useParams } from "react-router-dom";
import { useT } from "../i18n.js";

function Subtasks({ task, onChange }) {
  const tr = useT();
  const [title, setTitle] = useState("");
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState(false);
  const add = async (titles, ai_generated = false) => onChange(await api(`tasks/${task.id}/subtasks`, { method: "POST", body: { titles, ai_generated } }));
  const suggest = async () => {
    setBusy(true);
    try { const r = await api(`tasks/${task.id}/suggest-subtasks`, { method: "POST" }); setIdeas(r); } finally { setBusy(false); }
  };
  const done = task.subtasks.filter((s) => s.done).length;
  return (
    <section className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{tr("Subtasks")} <span className="muted small">{done}/{task.subtasks.length}</span></span>
        <button className="btn btn-sm" onClick={suggest} disabled={busy}>{Icon.spark} {busy ? tr("Thinking…") : tr("AI suggest subtasks")}</button>
      </div>
      {task.subtasks.length > 0 && <div className="bar" style={{ margin: "8px 0 6px" }}><span style={{ width: `${(100 * done) / task.subtasks.length}%`, background: "var(--green)" }} /></div>}
      {task.subtasks.map((s) => (
        <div key={s.id} className="sub-row">
          <input type="checkbox" checked={s.done} aria-label={s.title} onChange={async (e) => onChange(await api(`subtasks/${s.id}`, { method: "PATCH", body: { done: e.target.checked } }))} />
          <span className={s.done ? "done" : ""} style={{ flex: 1 }}>{s.title}</span>
          {s.ai_generated && <span className="badge badge-ai">AI</span>}
          <button className="btn btn-ghost btn-sm" aria-label="Delete subtask" onClick={async () => onChange(await api(`subtasks/${s.id}`, { method: "DELETE" }))}>✕</button>
        </div>
      ))}
      {ideas && (
        <div style={{ background: "#f6f3fe", borderRadius: 12, padding: 12, margin: "10px 0" }}>
          <div className="small" style={{ fontWeight: 800, marginBottom: 6 }}>{Icon.spark} {tr("Suggested subtasks")} <span className="muted">({ideas.engine === "gemini" ? "Gemini" : ideas.engine === "claude" ? "Claude" : tr("built-in")})</span></div>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13 }}>{ideas.subtasks.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={async () => { await add(ideas.subtasks, true); setIdeas(null); toast(tr("Subtasks added")); }}>{tr("Accept all")}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setIdeas(null)}>{tr("Dismiss")}</button>
          </div>
        </div>
      )}
      <form className="btn-row" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (title.trim()) { await add([title]); setTitle(""); } }}>
        <input className="input" style={{ flex: 1 }} placeholder={tr("Add a subtask")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-sm">{tr("Add")}</button>
      </form>
    </section>
  );
}

function Comments({ task, onChange }) {
  const tr = useT();
  const [body, setBody] = useState("");
  return (
    <section className="card">
      <div className="card-title">{tr("Comments")} <span className="muted small">{task.comments.length}</span></div>
      {task.comments.length === 0 && <div className="muted small" style={{ padding: "8px 0" }}>{tr("No comments yet.")}</div>}
      {task.comments.map((c) => (
        <div key={c.id} className="comment"><b>{c.author}</b> <span className="muted small">- {fmtDateTime(c.created_at)}</span><p>{c.body}</p></div>
      ))}
      <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (body.trim()) { onChange(await api(`tasks/${task.id}/comments`, { method: "POST", body: { body } })); setBody(""); } }}>
        <textarea className="input" rows={2} placeholder={tr("Write a comment…")} value={body} onChange={(e) => setBody(e.target.value)} />
        <div style={{ textAlign: "right", marginTop: 8 }}><button className="btn btn-primary btn-sm">{tr("Comment")}</button></div>
      </form>
    </section>
  );
}

/** Past-tense wording for the "Next action accepted" state (Figma Frame 13, accepted). */
function acceptedText(sug, t, tr) {
  const m = /^Ask (.+) to finish (.+) first\.$/.exec(sug.headline);
  const name = t.owner.name;
  switch (sug.kind) {
    case "unblock":
      return m
        ? { head: tr("{who} asked to finish {keys} today.", { who: m[1], keys: m[2] }), badge: tr("{keys} chased today", { keys: m[2] }) }
        : { head: tr(sug.headline), badge: tr("Dependencies chased today") };
    case "reassign": return { head: tr("Task moved to {name}. They were notified.", { name }), badge: tr("Owner changed to {name}", { name }) };
    case "start": return { head: tr("Task started today and moved to In progress."), badge: tr("Started today") };
    case "replan": return { head: tr("The team will agree a new deadline or split the task today."), badge: tr("Replan agreed today") };
    case "checkin": return { head: tr("Check-in with {name} set for today.", { name }), badge: tr("Check-in set for today") };
    case "review": return { head: tr("A teammate was asked to review and close it."), badge: tr("Review requested") };
    default: return { head: tr(sug.headline), badge: tr("Action agreed today") };
  }
}

export default function TaskDetail() {
  const tr = useT();
  const { tid } = useParams();
  const { project, bump, setPill } = useProject();
  const nav = useNavigate();
  const [accepted, setAccepted] = useState(null);
  useEffect(() => () => setPill(null), [setPill]);
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const [lateCount, setLateCount] = useState(null);
  const [editOwner, setEditOwner] = useState(false);

  useEffect(() => { api(`tasks/${tid}`).then(setT).catch(setErr); }, [tid]);
  useEffect(() => { api(`projects/${project.id}/dashboard`).then((d) => setLateCount(d.late_count)).catch(() => {}); }, [project.id, t?.status, t?.owner?.id]);

  if (err) return <ErrorBox error={err} />;
  if (!t) return <Loading />;

  const patch = async (body, msg) => {
    try { const n = await api(`tasks/${t.id}`, { method: "PATCH", body }); setT(n); bump(); msg && toast(msg); }
    catch (e) { toast(tr(e.message)); }
  };
  const sig = t.signal;
  const sug = t.suggestion;
  const act = async (action) => {
    try {
      const before = t.suggestion;
      const n = await api(`tasks/${t.id}/suggestion`, { method: "POST", body: { action } });
      setT(n); bump();
      if (action === "accept") {
        setAccepted(acceptedText(before, n, tr));
        setPill(tr("Suggestion accepted"));
      } else toast(tr("Suggestion dismissed"));
    } catch (e) { toast(e.message); }
  };
  const openDeps = t.depends_on.filter((d) => d.status !== "done");

  return (
    <>
      {t.external_url && (
        <div className="page-tools"><a className="btn btn-sm btn-outline" href={t.external_url} target="_blank" rel="noreferrer">Open in Apache Jira {Icon.ext}</a></div>
      )}
      <div className="grid grid-task">
        {/* Task header card — Figma Frame 13 */}
        <section className="card span-2">
          <div className="task-key">{tr("Task")} {t.key} - {tr(t.issue_type)} - <Priority value={t.priority} /></div>
          <h1 className="task-title">{t.title}</h1>
          <span className="label-sm">{tr("Status")}</span>
          <div className="status-pills" role="radiogroup" aria-label={tr("Status")}>
            {STATUSES.map(([v, l]) => (
              <button key={v} role="radio" aria-checked={t.status === v} className={`status-pill ${t.status === v ? "active" : ""}`}
                onClick={() => t.status !== v && patch({ status: v }, tr("Status changed to {s}", { s: tr(l) }))}>{tr(l)}</button>
            ))}
          </div>
          <div className="meta-grid">
            <div className="meta">
              <small>{tr("Owner")}</small>
              {editOwner ? (
                <select className="input" autoFocus defaultValue={t.owner.id} onBlur={() => setEditOwner(false)}
                  onChange={(e) => { setEditOwner(false); patch({ owner: Number(e.target.value) }, tr("Owner changed")); }}>
                  {project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : (
                <strong style={{ cursor: "pointer" }} onClick={() => setEditOwner(true)} title={tr("Click to change owner")}>{t.owner.name}</strong>
              )}
            </div>
            <div className="meta">
              <small>{tr("Due date")} {t.due_source !== "manual" && <span title={tr(t.due_source_label)}>- {tr(t.due_source_label).toLowerCase()}</span>}</small>
              <strong>{fmtDate(t.due_date, { day: "numeric", month: "short", year: "numeric" })}{t.status !== "done" && ` (${relDays(sig.days_left)})`}</strong>
              <div><input type="date" className="input" style={{ marginTop: 6, padding: "5px 8px", fontSize: 12, width: "auto" }} value={t.due_date}
                aria-label={tr("Change deadline")} onChange={(e) => e.target.value && patch({ due_date: e.target.value }, tr("Deadline moved"))} /></div>
            </div>
            <div className="meta">
              <small>{tr("Depends on")}</small>
              <strong>{t.depends_on.length ? t.depends_on.map((d) => d.key).join(", ") : "—"}</strong>
              {t.blocks.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>{tr("Blocks:")} {t.blocks.map((b) => b.key).join(", ")}</div>}
            </div>
          </div>
        </section>

        {/* Deadline risk */}
        <section className="card">
          <div className="card-title" style={{ marginBottom: 14 }}>{tr("Deadline risk")}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {accepted ? <span className="badge badge-lg badge-due_today">{tr("Action taken")}</span> : <Badge signal={sig} big />}
            <span className="risk-text">
              {accepted ? accepted.badge : <>
                {sig.state === "done" && tr("This task is done.")}
                {sig.state === "on_track" && tr("On track for the {d} deadline.", { d: fmtDate(t.due_date) })}
                {sig.state === "at_risk" && tr("May miss the {d} deadline.", { d: fmtDate(t.due_date) })}
                {sig.state === "due_today" && tr("The deadline is today.")}
                {sig.state === "delayed" && tr("Missed the {d} deadline.", { d: fmtDate(t.due_date) })}
              </>}
            </span>
          </div>
          {sig.reasons.length > 0 && (
            <>
              <div className="why">{tr("Why this warning")}</div>
              <ul className="reasons">{sig.reasons.map((r, i) => <li key={i}>{tr(r)}</li>)}</ul>
            </>
          )}
          {openDeps.length > 0 && (
            <div style={{ marginTop: 12 }}>{openDeps.map((d) => <Link key={d.id} className="dep-link open" to={`/tasks/${d.id}`}>{d.key} - {d.title.slice(0, 40)}</Link>)}</div>
          )}
          {lateCount > 0 && (
            <div className="banner">
              <b>{tr(lateCount === 1 ? "1 task may be late." : "{n} tasks may be late.", { n: lateCount })}</b>
              <Link to={`/p/${project.id}/tasks?signal=delayed,at_risk,due_today`}>{tr("See the deadlines list.")}</Link>
            </div>
          )}
        </section>

        {/* Suggested next action — Figma Frame 13 (and its "accepted" state) */}
        <section className="card card-outline">
          {accepted ? (
            <>
              <div className="card-title">{tr("Next action accepted")}</div>
              <div className="suggest-head">{accepted.head}</div>
              <div className="suggest-detail">{tr("{name} and the team were notified. The risk is rechecked at the next Daily Scrum.", { name: t.owner.name })}</div>
              <button className="btn btn-primary btn-lg" onClick={() => nav(`/p/${project.id}`)}>{tr("Back to project overview")}</button>
            </>
          ) : (
            <>
              <div className="card-title">{tr("Suggested next action")}</div>
              {sug ? (
                <>
                  <div className="suggest-head">{tr(sug.headline)}</div>
                  <div className="suggest-detail">{tr(sug.detail)}</div>
                  <div className="btn-row">
                    <button className="btn btn-primary btn-lg" onClick={() => act("accept")}>{tr("Accept suggestion")}</button>
                    <button className="btn btn-outline btn-lg btn-wide" onClick={() => setEditOwner(true)}>{tr("Change owner")}</button>
                    <button className="btn btn-ghost btn-lg" onClick={() => act("dismiss")}>{tr("Dismiss")}</button>
                  </div>
                </>
              ) : (
                <div className="suggest-detail" style={{ marginTop: 18 }}>
                  {t.status === "done" ? tr("Nothing to do - the task is done.") : tr("No action needed right now. The task is on track.")}
                </div>
              )}
            </>
          )}
        </section>

        <section className="card span-2">
          <div className="card-title">{tr("Description")}</div>
          {t.description ? <div className="desc" style={{ marginTop: 8 }}>{t.description}</div> : <div className="muted small">{tr("No description.")}</div>}
          <div className="proj-stats" style={{ marginTop: 12 }}>
            {t.fix_version && <span>{tr("Fix version")} <b>{t.fix_version}</b></span>}
            {t.components && <span>{tr("Components")} <b>{t.components}</b></span>}
            {t.jira_status && <span>{tr("Jira status")} <b>{t.jira_status}</b></span>}
            {t.estimate_hours !== null && <span>{tr("Estimate")} <b>{t.estimate_hours} {tr("h")}</b></span>}
            <span>{tr("Created")} <b>{fmtDate(t.created_at.slice(0, 10))}</b></span>
            <span>
              {tr("Priority")}{" "}
              <select className="input" style={{ width: "auto", padding: "2px 6px", display: "inline-block" }} value={t.priority} onChange={(e) => patch({ priority: e.target.value }, tr("Priority changed"))}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
              </select>
            </span>
          </div>
        </section>

        <Subtasks task={t} onChange={setT} />
        <Comments task={t} onChange={setT} />

        <section className="card span-2">
          <div className="card-title">{tr("Activity")}</div>
          {t.activity.length === 0 && <div className="muted small">{tr("No changes recorded in ProjectPulse yet.")}</div>}
          {t.activity.map((a, i) => (
            <div key={i} className="activity"><time>{fmtDateTime(a.created_at)}</time><span><b>{a.actor}</b> - {tr(a.detail)}</span></div>
          ))}
        </section>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { useProject } from "../ctx.js";
import { useT } from "../i18n.js";
import { ErrorBox, Loading } from "../ui.jsx";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEGEND = [["var(--badge-mint)", "On track"], ["var(--badge-yellow)", "Due today"], ["var(--badge-pink)", "At risk"], ["var(--red)", "Delayed"], ["var(--badge-gray)", "Done"]];

export default function Timeline() {
  const tr = useT();
  const { project, version } = useProject();
  const [start, setStart] = useState(null);
  const [owner, setOwner] = useState("");
  const [done, setDone] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const weeks = 6;

  useEffect(() => {
    const qs = new URLSearchParams({ weeks: String(weeks) });
    if (start) qs.set("from", start);
    if (owner) qs.set("owner", owner);
    if (done) qs.set("done", "1");
    api(`projects/${project.id}/timeline?${qs}`).then(setD).catch(setErr);
  }, [project.id, version, start, owner, done]);

  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const byDay = {};
  d.tasks.forEach((t) => { (byDay[t.due_date] = byDay[t.due_date] || []).push(t); });
  const thisWeek = d.tasks.filter((t) => t.due_date >= d.today && t.due_date <= addDays(d.today, (7 - new Date(d.today + "T00:00:00").getDay()) % 7)).length;

  return (
    <>
      <div className="page-head">
        <div><h1>{tr("Timeline")}</h1><p>{tr("All deadlines on one timeline, so everyone knows what is due this week.")}</p></div>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => setStart(addDays(d.start, -7 * weeks))}>← {tr("Earlier")}</button>
          <button className="btn btn-sm" onClick={() => setStart(null)}>{tr("This week")}</button>
          <button className="btn btn-sm" onClick={() => setStart(addDays(d.start, 7 * weeks))}>{tr("Later")} →</button>
        </div>
      </div>
      <div className="toolbar">
        <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={tr("Owner")}>
          <option value="">{tr("Everyone")}</option>
          {project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> {tr("Show done tasks")}</label>
        <span className="small muted">{fmtDate(d.start)} – {fmtDate(d.end, { day: "numeric", month: "short", year: "numeric" })} - {tr("{n} deadlines", { n: d.tasks.length })}{!start && " - " + tr("{n} due this week", { n: thisWeek })}</span>
        {d.overdue_before > 0 && <Link className="badge badge-delayed" to={`/p/${project.id}/tasks?signal=delayed`}>{tr("{n} delayed before this range", { n: d.overdue_before })}</Link>}
      </div>
      <div className="card tl" style={{ padding: 12 }}>
        <div className="tl-grid" style={{ gridTemplateColumns: "repeat(7, minmax(120px, 1fr))" }}>
          {DAYS.map((x) => <div key={x} className="tl-week">{tr(x)}</div>)}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const day = addDays(d.start, i);
            const items = byDay[day] || [];
            const dow = i % 7;
            return (
              <div key={day} className={`tl-day ${day === d.today ? "today" : ""} ${dow >= 5 ? "weekend" : ""}`} style={{ borderTop: "1px solid var(--line)" }}>
                <div className="tl-daynum">{day === d.today ? tr("Today") + " - " : ""}{fmtDate(day)}</div>
                {items.slice(0, 4).map((t) => (
                  <Link key={t.id} to={`/tasks/${t.id}`} className={`tl-item s-${t.signal.state}`} title={`${t.key} ${t.title} - ${t.owner.name} (${tr(t.signal.label)})`}>
                    {t.key} {t.title}
                  </Link>
                ))}
                {items.length > 4 && <div className="tl-more">{tr("+{n} more", { n: items.length - 4 })}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="legend" style={{ marginTop: 12 }}>
        {LEGEND.map(([c, l]) => <span key={l}><i style={{ background: c }} />{tr(l)}</span>)}
      </div>
    </>
  );
}

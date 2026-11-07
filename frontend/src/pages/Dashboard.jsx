import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { useProject } from "../ctx.js";
import { useT } from "../i18n.js";
import { Badge, ErrorBox, Icon, Loading } from "../ui.jsx";

export function HealthRing({ score, size = 96 }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? "var(--green)" : score >= 50 ? "#e0a526" : "var(--red)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Health score ${score} of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 24, fontWeight: 800, fill: "var(--ink)" }}>{score}</text>
    </svg>
  );
}

export default function Dashboard() {
  const t = useT();
  const { project, version } = useProject();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api(`projects/${project.id}/dashboard`).then(setD).catch(setErr); }, [project.id, version]);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const s = d.status_counts;
  const total = d.project.total || 1;
  const pct = (n) => `${(100 * n) / total}%`;
  const maxOpen = Math.max(project.workload_limit + 1, ...d.workload.map((r) => r.open));
  const pid = project.id;

  return (
    <div className="grid grid-dash">
      {/* Project progress — Figma Frame 12, top left */}
      <section className="card">
        <div className="card-title">{t("Project progress")}</div>
        <div className="big-number">{d.project.percent}%<small>{t("{a} of {b} tasks done", { a: d.project.done, b: d.project.total })}</small></div>
        <div className="bar" style={{ marginTop: 10 }} aria-hidden="true">
          <span style={{ width: pct(s.done), background: "var(--green)" }} />
          <span style={{ width: pct(s.review), background: "var(--green-2)" }} />
          <span style={{ width: pct(s.in_progress), background: "var(--green-3)" }} />
        </div>
        <div className="stat-grid">
          <div className="stat-chip"><span>{t("Done")}</span><b>{s.done}</b></div>
          <div className="stat-chip"><span>{t("Review")}</span><b>{s.review}</b></div>
          <div className="stat-chip"><span>{t("In progress")}</span><b>{s.in_progress}</b></div>
          <div className="stat-chip"><span>{t("To do")}</span><b>{s.todo}</b></div>
        </div>
        {d.late_count > 0 ? (
          <div className="banner">
            <b>{t(d.late_count === 1 ? "1 task may be late." : "{n} tasks may be late.", { n: d.late_count })}</b>
            <Link to={`/p/${pid}/tasks?signal=delayed,at_risk,due_today`}>{t("See the deadlines list.")}</Link>
          </div>
        ) : (
          <div className="banner banner-ok"><b>{t("No task is late or at risk.")}</b></div>
        )}
      </section>

      {/* Team workload — Figma Frame 12, top right */}
      <section className="card">
        <div className="card-title">{t("Team workload")}</div>
        <div className="card-sub">{t("Open tasks per member. Limit: {n}.", { n: project.workload_limit })}{d.workload_total > d.workload.length && " " + t("Top {a} of {b} people.", { a: d.workload.length, b: d.workload_total })}</div>
        {d.workload.filter((r) => r.open > 0).length === 0 && <div className="empty small">{t("Nobody has open tasks.")}</div>}
        {d.workload.filter((r) => r.open > 0).map((r) => (
          <Link key={r.member} className="wl-row" to={`/p/${pid}/workload?member=${r.member}`}>
            <div className="wl-top">
              <span className="wl-name">{r.name}</span>
              <span className="wl-count"><b>{t("{n} open", { n: r.open })}</b>{r.above_limit && " - " + t("above limit")}</span>
            </div>
            <div className={`wl-bar ${r.above_limit ? "over" : ""}`}><span style={{ width: `${(100 * r.open) / maxOpen}%` }} /></div>
          </Link>
        ))}
        <div style={{ marginTop: 8 }}><Link className="small" to={`/p/${pid}/workload`}>{t("Open the workload view")} →</Link></div>
      </section>

      {/* Upcoming deadlines — Figma Frame 12, bottom */}
      <section className="card span-2">
        <div className="card-title" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
          {t("Upcoming deadlines")} <Link className="small" style={{ fontWeight: 600 }} to={`/p/${pid}/timeline`}>{t("Timeline")} →</Link>
        </div>
        {d.upcoming.length === 0 && <div className="empty small">{t("No upcoming deadlines.")}</div>}
        {d.upcoming.map((task) => (
          <Link key={task.id} to={`/tasks/${task.id}`} className="dl-row">
            <span className="dl-date">{fmtDate(task.due_date)}</span>
            <span className="dl-title">{task.key} {task.title}</span>
            <span className="dl-owner">{task.owner.name}</span>
            <Badge signal={task.signal} big />
          </Link>
        ))}
      </section>

      {/* AI Daily Brief */}
      <section className="card brief">
        <div className="eyebrow">{Icon.spark} {t("AI Daily Brief")} - {fmtDate(d.today, { weekday: "long", day: "numeric", month: "long" })}</div>
        <div className="brief-head">{t(d.brief.headline)}</div>
        <ul>{d.brief.bullets.map((b, i) => <li key={i}>{t(b)}</li>)}</ul>
        {d.brief.focus && <div className="brief-focus">{t(d.brief.focus)}</div>}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <Link className="btn btn-primary btn-sm" to={`/p/${pid}/assistant?q=${encodeURIComponent("Why are we behind schedule?")}`}>{t("Ask “Why are we behind?”")}</Link>
          <Link className="btn btn-sm" to={`/p/${pid}/assistant`}>{t("Open AI Assistant")}</Link>
        </div>
      </section>

      {/* Project Health Score */}
      <section className="card">
        <div className="card-title">{t("Project health score")}</div>
        <div className="card-sub">{t("One number from overdue, at-risk, overloaded and unfinished work.")}</div>
        <div className="health">
          <HealthRing score={d.health.score} />
          <div className="health-parts">
            <div><b>{t(d.health.label)}</b><span /></div>
            {d.health.parts.map((p) => (
              <div key={p.name}><span>{t(p.name)} <span className="muted">({t(p.value)})</span></span><span>−{p.penalty}</span></div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { useProject } from "../ctx.js";
import { useT } from "../i18n.js";
import { Avatar, Badge, ErrorBox, Loading, toast } from "../ui.jsx";

export default function Workload() {
  const t = useT();
  const { project, version, bump } = useProject();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [sp, setSp] = useSearchParams();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const openId = sp.get("member");
  const load = () => api(`projects/${project.id}/workload`).then(setD).catch(setErr);
  useEffect(() => { load(); }, [project.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const rows = onlyOpen ? d.rows.filter((r) => r.open > 0) : d.rows;
  const max = Math.max(d.limit + 1, ...d.rows.map((r) => r.open));
  const over = d.rows.filter((r) => r.above_limit);
  const toggle = (id) => setSp(openId === String(id) ? {} : { member: String(id) }, { replace: true });

  async function reassign(task, memberId) {
    const target = d.rows.find((r) => r.member === Number(memberId));
    await api(`tasks/${task.id}`, { method: "PATCH", body: { owner: Number(memberId) } });
    toast(t("{key} moved to {s}", { key: task.key, s: target.name }));
    bump();
    load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Team workload")}</h1>
          <p>{t("Open tasks per member. More than {n} open tasks is shown as “above limit”. Click a member to see and move their tasks.", { n: d.limit })}</p>
        </div>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {t("Only people with open tasks")}
        </label>
      </div>
      <div className={`banner ${over.length ? "" : "banner-ok"}`} style={{ marginTop: 0, marginBottom: 16 }}>
        {over.length
          ? <><b>{t("Above the limit ({n}):", { n: over.length })}</b> {over.slice(0, 5).map((r) => r.name).join(", ")}{over.length > 5 ? "…" : ""}</>
          : <b>{t("Nobody is above the limit. Work is shared fairly.")}</b>}
      </div>
      <div className="card">
        {rows.map((r) => (
          <div key={r.member} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
            <button className="wl-row" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", textAlign: "left" }}
              onClick={() => toggle(r.member)} aria-expanded={openId === String(r.member)}>
              <div className="wl-top" style={{ alignItems: "center" }}>
                <span className="who"><Avatar member={{ ...r }} /><span className="wl-name">{r.name}</span>
                  {r.role && <span className="muted small hide-sm">{r.role}</span>}</span>
                <span className="wl-count">
                  <span className="muted small hide-sm" style={{ marginRight: 10 }}>{t("{a} to do - {b} in progress - {c} review", { a: r.todo, b: r.in_progress, c: r.review })}</span>
                  {r.late > 0 && <span className="badge badge-at_risk" style={{ marginRight: 8 }}>{t("{n} late", { n: r.late })}</span>}
                  <b>{t("{n} open", { n: r.open })}</b>{r.above_limit && " - " + t("above limit")}
                </span>
              </div>
              <div className={`wl-bar ${r.above_limit ? "over" : ""}`}><span style={{ width: `${(100 * r.open) / max}%` }} /></div>
            </button>
            {openId === String(r.member) && (
              <div style={{ padding: "8px 0 12px 34px" }}>
                {r.tasks.length === 0 && <div className="muted small">{t("No open tasks.")}</div>}
                {r.tasks.map((task) => (
                  <div key={task.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", flexWrap: "wrap" }}>
                    <span className="small muted" style={{ width: 92 }}>{fmtDate(task.due_date)}</span>
                    <Link to={`/tasks/${task.id}`} style={{ flex: 1, fontWeight: 700, minWidth: 180 }}>{task.key} {task.title}</Link>
                    <Badge signal={task.signal} />
                    <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value="" aria-label={t("Move {key} to another member", { key: task.key })}
                      onChange={(e) => e.target.value && reassign(task, e.target.value)}>
                      <option value="">{t("Move to…")}</option>
                      {d.rows.filter((x) => x.member !== r.member).sort((a, b) => a.open - b.open).slice(0, 30).map((x) => (
                        <option key={x.member} value={x.member}>{x.name} ({t("{n} open", { n: x.open })})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

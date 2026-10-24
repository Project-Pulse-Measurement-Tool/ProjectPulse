import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { useProject } from "../ctx.js";
import { ErrorBox, Loading } from "../ui.jsx";
import { HealthRing } from "./Dashboard.jsx";

const SERIES = { created: "var(--series-1)", resolved: "var(--series-2)" };

/** Grouped bars: tasks created vs resolved per week, with a per-week hover tooltip. */
function FlowChart({ flow }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 220, L = 34, B = 26, T = 10;
  const max = Math.max(4, ...flow.flatMap((w) => [w.created, w.resolved]));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const band = (W - L) / flow.length;
  const bw = Math.min(16, band / 3);
  return (
    <div className="chart-wrap chart">
      <div className="legend">
        <span><i style={{ background: SERIES.created }} />Created</span>
        <span><i style={{ background: SERIES.resolved }} />Resolved</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks created and resolved per week" onMouseLeave={() => setHover(null)}>
        <g className="grid">{[0, 1, 2, 3, 4].map((i) => <line key={i} x1={L} x2={W} y1={y(i * step)} y2={y(i * step)} />)}</g>
        <g className="axis">
          {[0, 1, 2, 3, 4].map((i) => <text key={i} x={L - 8} y={y(i * step) + 4} textAnchor="end">{i * step}</text>)}
          {flow.map((w, i) => i % 2 === 0 && <text key={w.week} x={L + band * i + band / 2} y={H - 8} textAnchor="middle">{fmtDate(w.week)}</text>)}
        </g>
        {flow.map((w, i) => {
          const cx = L + band * i + band / 2;
          const bar = (v, x, color) => {
            const h = Math.max(0, H - B - y(v));
            if (!h) return null;
            const r = Math.min(4, h, bw / 2);
            const yt = y(v);
            return <path d={`M${x},${H - B} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${H - B} Z`} fill={color} />;
          };
          return (
            <g key={w.week} onMouseEnter={() => setHover(i)}>
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill={hover === i ? "rgba(79,114,196,.06)" : "transparent"} />
              {bar(w.created, cx - bw - 1, SERIES.created)}
              {bar(w.resolved, cx + 1, SERIES.resolved)}
            </g>
          );
        })}
        <line x1={L} x2={W} y1={H - B} y2={H - B} stroke="#cfd6e0" />
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%`, top: `${(y(Math.max(flow[hover].created, flow[hover].resolved)) / H) * 100}%` }}>
          Week of <b>{fmtDate(flow[hover].week)}</b><br />Created <b>{flow[hover].created}</b> · Resolved <b>{flow[hover].resolved}</b>
        </div>
      )}
    </div>
  );
}

function HBar({ label, parts, total, right }) {
  const [tip, setTip] = useState(false);
  return (
    <div className="hbar" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)} style={{ position: "relative" }}>
      <span>{label}</span>
      <span className="hbar-track">
        {parts.map((p, i) => p.value > 0 && <span key={i} style={{ width: `${(100 * p.value) / Math.max(total, 1)}%`, background: p.color }} />)}
      </span>
      <span style={{ textAlign: "right", fontWeight: 800 }}>{right}</span>
      {tip && <div className="tip" style={{ left: "50%", top: 0 }}>{parts.map((p) => `${p.name} ${p.value}`).join(" · ")}</div>}
    </div>
  );
}

export default function Analytics() {
  const { project, version } = useProject();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [table, setTable] = useState(false);
  useEffect(() => { api(`projects/${project.id}/analytics`).then(setA).catch(setErr); }, [project.id, version]);
  if (err) return <ErrorBox error={err} />;
  if (!a) return <Loading />;
  const sig = a.signals;
  const sigTotal = Object.values(sig).reduce((x, y) => x + y, 0);
  const prMax = Math.max(...a.by_priority.map((p) => p.open + p.done), 1);
  const typeMax = Math.max(...a.by_type.map((p) => p.count), 1);
  const closeMax = Math.max(...a.top_closers.map((p) => p.count), 1);
  const created12 = a.flow.reduce((s, w) => s + w.created, 0);
  const resolved12 = a.flow.reduce((s, w) => s + w.resolved, 0);
  const STATUS = [
    ["delayed", "Delayed", "var(--red)"],
    ["at_risk", "At risk", "#e48b9a"],
    ["due_today", "Due today", "#e8c440"],
    ["on_track", "On track", "var(--green-2)"],
    ["done", "Done", "#a9b3c4"],
  ];

  return (
    <>
      <div className="page-head"><div><h1>Analytics</h1><p>Progress and performance from live task data.</p></div></div>
      <div className="grid">
        <section className="card kpis">
          <div className="kpi"><small>Health score</small><div style={{ display: "flex", alignItems: "center", gap: 10 }}><HealthRing score={a.health.score} size={56} /><span style={{ fontSize: 15 }}>{a.health.label}</span></div></div>
          <div className="kpi"><small>Median cycle time</small><div>{a.cycle_days_median ?? "—"}<span style={{ fontSize: 14 }}> days</span></div><p>created → resolved</p></div>
          <div className="kpi"><small>Resolved on time</small><div>{a.on_time_rate ?? "—"}{a.on_time_rate !== null && "%"}</div><p>resolved on or before the deadline</p></div>
          <div className="kpi"><small>Last 12 weeks</small><div>{resolved12}<span style={{ fontSize: 14 }}> / {created12}</span></div><p>resolved / created</p></div>
        </section>
        <div className="grid grid-dash">
          <section className="card span-2">
            <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              Created vs resolved per week
              <div className="seg"><button className={!table ? "on" : ""} onClick={() => setTable(false)}>Chart</button><button className={table ? "on" : ""} onClick={() => setTable(true)}>Table</button></div>
            </div>
            <div className="card-sub">Is the team closing work as fast as it arrives?</div>
            {table ? (
              <div className="table-wrap"><table className="table"><thead><tr><th>Week of</th><th>Created</th><th>Resolved</th></tr></thead>
                <tbody>{a.flow.map((w) => <tr key={w.week}><td>{fmtDate(w.week, { day: "numeric", month: "short", year: "numeric" })}</td><td>{w.created}</td><td>{w.resolved}</td></tr>)}</tbody></table></div>
            ) : <FlowChart flow={a.flow} />}
          </section>
          <section className="card">
            <div className="card-title">Deadline status</div>
            <div className="card-sub">All {sigTotal} tasks by warning state.</div>
            <div className="bar" style={{ height: 14, marginBottom: 12 }}>
              {STATUS.map(([k, , c]) => sig[k] > 0 && <span key={k} style={{ width: `${(100 * sig[k]) / sigTotal}%`, background: c }} title={`${k} ${sig[k]}`} />)}
            </div>
            {STATUS.map(([k, l, c]) => (
              <div key={k} className="hbar" style={{ gridTemplateColumns: "14px 1fr 60px" }}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: c, display: "inline-block" }} />
                <span>{l}</span><b style={{ textAlign: "right" }}>{sig[k]}</b>
              </div>
            ))}
          </section>
          <section className="card">
            <div className="card-title">Tasks by priority</div>
            <div className="legend" style={{ marginTop: 6 }}>
              <span><i style={{ background: "var(--series-1)" }} />Open</span><span><i style={{ background: "var(--series-2)" }} />Done</span>
            </div>
            {a.by_priority.map((p) => (
              <HBar key={p.key} label={p.label} total={prMax} right={p.open + p.done}
                parts={[{ name: "Open", value: p.open, color: "var(--series-1)" }, { name: "Done", value: p.done, color: "var(--series-2)" }]} />
            ))}
          </section>
          <section className="card">
            <div className="card-title">Tasks by type</div>
            <div className="card-sub">Six most common types.</div>
            {a.by_type.map((p) => <HBar key={p.label} label={p.label} total={typeMax} right={p.count} parts={[{ name: p.label, value: p.count, color: "var(--series-1)" }]} />)}
          </section>
          <section className="card">
            <div className="card-title">Most tasks closed</div>
            <div className="card-sub">People with the most Done tasks.</div>
            {a.top_closers.length === 0 && <div className="muted small">No done tasks yet.</div>}
            {a.top_closers.map((p) => <HBar key={p.name} label={p.name} total={closeMax} right={p.count} parts={[{ name: "Done", value: p.count, color: "var(--series-2)" }]} />)}
          </section>
          <section className="card span-2">
            <div className="card-title">Where deadlines come from</div>
            <div className="card-sub">ProjectPulse needs a deadline for every task. Imported Jira issues without a due date or release date get an estimate.</div>
            <div className="proj-stats">{a.due_sources.filter((s) => s.count).map((s) => <span key={s.key}>{s.label} <b>{s.count}</b></span>)}</div>
          </section>
        </div>
      </div>
    </>
  );
}

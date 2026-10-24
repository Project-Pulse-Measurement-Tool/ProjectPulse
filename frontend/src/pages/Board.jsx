import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { useProject } from "../ctx.js";
import { Avatar, Badge, ErrorBox, Loading, Priority, STATUSES, toast } from "../ui.jsx";

export function useTasks(project, version, query = "") {
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api(`projects/${project.id}/tasks${query}`).then(setTasks).catch(setErr);
  }, [project.id, version, query]);
  return [tasks, setTasks, err];
}

export default function Board() {
  const { project, version } = useProject();
  const [tasks, setTasks, err] = useTasks(project, version);
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const [hideOldDone, setHideOldDone] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const nav = useNavigate();

  const shown = useMemo(() => {
    if (!tasks) return [];
    const cutoff = Date.now() - 1000 * 3600 * 24 * 30;
    return tasks.filter(
      (t) =>
        (!owner || String(t.owner.id) === owner) &&
        (!q || (t.key + " " + t.title).toLowerCase().includes(q.toLowerCase())) &&
        (!hideOldDone || t.status !== "done" || new Date(t.updated_at).getTime() > cutoff)
    );
  }, [tasks, owner, q, hideOldDone]);

  if (err) return <ErrorBox error={err} />;
  if (!tasks) return <Loading />;
  const owners = [...new Map(tasks.map((t) => [t.owner.id, t.owner])).values()].sort((a, b) => a.name.localeCompare(b.name));

  async function move(id, status) {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const prev = tasks;
    setTasks(tasks.map((x) => (x.id === id ? { ...x, status } : x)));
    try {
      const updated = await api(`tasks/${id}`, { method: "PATCH", body: { status } });
      setTasks((cur) => cur.map((x) => (x.id === id ? { ...x, ...updated } : x)));
      toast(`${t.key} moved to ${STATUSES.find((s) => s[0] === status)[1]}`);
    } catch (e) {
      setTasks(prev);
      toast(e.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Board</h1><p>Drag a card to change its status. The team sees real progress without asking.</p></div>
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by owner">
          <option value="">All owners</option>
          {owners.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={hideOldDone} onChange={(e) => setHideOldDone(e.target.checked)} /> Hide Done older than 30 days
        </label>
      </div>
      <div className="board">
        {STATUSES.map(([st, label]) => {
          const col = shown.filter((t) => t.status === st);
          return (
            <section
              key={st}
              className={`col ${over === st ? "drop" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(st); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); move(Number(e.dataTransfer.getData("text/plain")), st); }}
              aria-label={`${label} column`}
            >
              <div className="col-head">{label}<span>{col.length}</span></div>
              {col.slice(0, 80).map((t) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(t.id)); setDragId(t.id); }}
                  onDragEnd={() => setDragId(null)}
                  className={`kcard s-${t.signal.state} ${dragId === t.id ? "dragging" : ""}`}
                  onKeyDown={(e) => {
                    const i = STATUSES.findIndex((s) => s[0] === t.status);
                    if (e.key === "ArrowRight" && i < 3) { e.preventDefault(); move(t.id, STATUSES[i + 1][0]); }
                    if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); move(t.id, STATUSES[i - 1][0]); }
                  }}
                  title="Drag to another column, or focus and press ←/→"
                >
                  <div className="kcard-key"><span>{t.key} · {t.issue_type}</span><Priority value={t.priority} /></div>
                  <div className="kcard-title">{t.title}</div>
                  <div className="kcard-foot">
                    <span className="who small"><Avatar member={t.owner} /><span>{fmtDate(t.due_date)}</span></span>
                    {t.signal.state !== "on_track" && <Badge signal={t.signal} />}
                  </div>
                </Link>
              ))}
              {col.length > 80 && (
                <button className="btn btn-sm btn-ghost" style={{ width: "100%" }} onClick={() => nav(`/p/${project.id}/tasks?status=${st}`)}>
                  +{col.length - 80} more in the task list
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

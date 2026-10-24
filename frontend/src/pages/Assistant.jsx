import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, fmtDateTime } from "../api.js";
import { useProject } from "../ctx.js";
import { ErrorBox, Icon, Loading, RichText } from "../ui.jsx";

const PROMPTS = [
  "Why are we behind schedule?",
  "Who is overloaded?",
  "What is due this week?",
  "What should we focus on today?",
  "Which tasks are blocked?",
  "Give me the daily brief",
];

export default function Assistant() {
  const { project } = useProject();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [sp, setSp] = useSearchParams();
  const log = useRef();
  const asked = useRef(false);

  useEffect(() => { api(`projects/${project.id}/chat`).then(setData).catch(setErr); }, [project.id]);
  useEffect(() => { log.current && (log.current.scrollTop = log.current.scrollHeight); }, [data, pending]);

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    setBusy(true); setPending(q); setText(""); setErr(null);
    try { setData(await api(`projects/${project.id}/chat`, { method: "POST", body: { message: q } })); }
    catch (e) { setErr(e); setText(q); }
    finally { setBusy(false); setPending(null); }
  }
  useEffect(() => {
    const q = sp.get("q");
    if (q && data && !asked.current) { asked.current = true; setSp({}, { replace: true }); ask(q); }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && !err) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI Project Assistant</h1>
          <p>Ask anything about {project.name}. Answers come from the live task data.</p>
        </div>
        <div className="btn-row">
          <span className={`badge ${data?.engine === "claude" ? "badge-ai" : "badge-soft"}`}>
            {Icon.spark} {data?.engine === "claude" ? "Claude API" : "Built-in analyst (no API key set)"}
          </span>
          {data?.messages.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={async () => { await api(`projects/${project.id}/chat`, { method: "DELETE" }); setData({ ...data, messages: [] }); }}>Clear chat</button>
          )}
        </div>
      </div>
      <section className="card chat">
        <div className="chat-log" ref={log} aria-live="polite">
          {data?.messages.length === 0 && !pending && (
            <div className="empty">
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>“Is this project actually on track?”</div>
              Pick a question below or write your own — in English or Russian.
            </div>
          )}
          {data?.messages.map((m) => (
            <div key={m.id} className={`msg msg-${m.role}`}>
              {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
              <div className="msg-meta">{fmtDateTime(m.created_at)}{m.role === "assistant" && ` · ${m.engine === "claude" ? "Claude" : "built-in analyst"}`}</div>
            </div>
          ))}
          {pending && (
            <>
              <div className="msg msg-user">{pending}</div>
              <div className="msg msg-assistant"><span className="typing"><i /><i /><i /></span></div>
            </>
          )}
        </div>
        <ErrorBox error={err} />
        <div className="chips">{PROMPTS.map((p) => <button key={p} className="chip" onClick={() => ask(p)} disabled={busy}>{p}</button>)}</div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <input className="input" placeholder="Ask about deadlines, workload, a person or a task key…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Question" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>{Icon.send} Ask</button>
        </form>
      </section>
    </>
  );
}

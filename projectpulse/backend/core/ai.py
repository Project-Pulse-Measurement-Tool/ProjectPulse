"""AI Project Assistant: chat over live task data (F7), AI subtask suggestions (F4).

Two engines:
- "claude": the Claude API, used when ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is set.
- "analyst": a built-in engine that answers the common PM questions directly from the database.
  It needs no key and costs nothing, which matches the zero cash budget of the pilot (A5, NC2).
"""
import json
import logging
import os
import re
from datetime import timedelta

from . import rules

log = logging.getLogger(__name__)

MODEL = os.environ.get("PP_CLAUDE_MODEL", "claude-opus-5-5")


def claude_available():
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def engine_name():
    return "claude" if claude_available() else "analyst"


# ---------------------------------------------------------------- context

def task_line(t, sig, members):
    deps = ",".join(d.key for d in t.depends_on.all())
    return (
        f"{t.key} | {t.title[:90]} | status={t.get_status_display()} | owner={members[t.owner_id].name} | "
        f"due={t.due_date.isoformat()} ({t.get_due_source_display()}) | priority={t.priority} | "
        f"signal={sig['label']}" + (f" | depends_on={deps}" if deps else "")
    )


def project_context(project, tasks, snap, members, max_tasks=220):
    sig = snap["signals"]
    open_first = sorted(tasks, key=lambda t: (t.status == "done", t.due_date))[:max_tasks]
    wl = "\n".join(
        f"- {r['name']}: {r['open']} open ({r['todo']} to do, {r['in_progress']} in progress, {r['review']} review)"
        + (" ABOVE LIMIT" if r["above_limit"] else "")
        for r in snap["workload"]
        if r["open"]
    )
    return (
        f"Project: {project.name} ({project.key}). Today: {snap['ref'].isoformat()}.\n"
        f"Goal: {project.goal}\nWorkload limit: {project.workload_limit} open tasks per person.\n"
        f"Progress: {snap['done']} of {snap['total']} tasks done ({snap['percent']}%). "
        f"Status counts: {snap['status_counts']}. Health score: {snap['health']['score']}/100 ({snap['health']['label']}).\n"
        f"Workload:\n{wl or '- nobody has open tasks'}\n\nTasks (key | title | status | owner | due | priority | signal):\n"
        + "\n".join(task_line(t, sig[t.id], members) for t in open_first)
    )


SYSTEM_PROMPT = """You are the ProjectPulse AI Project Assistant inside a project management platform.
You answer project managers' questions using only the live project data given in the user turn.
Be short, specific and honest: name task keys, owners and dates. If the data does not answer the question, say so.
Use plain sentences or a short bulleted list. Reply in the language the user wrote in."""


def ask_claude(question, context, history):
    import anthropic

    client = anthropic.Anthropic()
    messages = [{"role": m.role, "content": m.content} for m in history[-6:]]
    messages.append({"role": "user", "content": f"<project_data>\n{context}\n</project_data>\n\nQuestion: {question}"})
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=messages,
    )
    if response.stop_reason == "refusal":
        return None
    return "".join(b.text for b in response.content if b.type == "text").strip() or None


# ---------------------------------------------------------------- built-in analyst

def _has(q, *words):
    return any(w in q for w in words)


def _fmt_task(t, sig, members):
    return f"**{t.key}** {t.title[:70]} — {members[t.owner_id].name}, due {t.due_date:%d %b} ({sig['label']})"


def analyst_answer(question, project, tasks, snap, members):
    q = question.lower()
    sig = snap["signals"]
    ref = snap["ref"]
    open_tasks = [t for t in tasks if t.status != "done"]
    delayed = sorted([t for t in open_tasks if sig[t.id]["state"] == "delayed"], key=lambda t: t.due_date)
    risky = [t for t in open_tasks if sig[t.id]["state"] in ("at_risk", "due_today")]

    # A specific task key, e.g. "KAFKA-123" or "T11"
    for t in tasks:
        if re.search(rf"\b{re.escape(t.key.lower())}\b", q):
            s = sig[t.id]
            lines = [f"**{t.key} — {t.title}**", f"Status: {t.get_status_display()}, owner {members[t.owner_id].name}, due {t.due_date:%d %b %Y} ({s['label']})."]
            lines += [f"- {r}" for r in s["reasons"]]
            deps = list(t.depends_on.all())
            if deps:
                lines.append("Depends on: " + ", ".join(f"{d.key} ({d.get_status_display()})" for d in deps))
            return "\n".join(lines)

    # A specific person
    for m in members.values():
        first = m.name.split()[0].lower()
        if len(first) > 2 and (m.name.lower() in q or re.search(rf"\b{re.escape(first)}\b", q)):
            mine = [t for t in open_tasks if t.owner_id == m.id]
            if not mine:
                return f"{m.name} has no open tasks in {project.name}."
            row = next((r for r in snap["workload"] if r["member"] == m.id), None)
            head = f"{m.name} has {len(mine)} open task{'s' if len(mine) != 1 else ''}"
            if row and row["above_limit"]:
                head += f", above the limit of {project.workload_limit}"
            return head + ":\n" + "\n".join("- " + _fmt_task(t, sig[t.id], members) for t in sorted(mine, key=lambda t: t.due_date)[:10])

    if _has(q, "overload", "workload", "busy", "capacity", "загруж", "перегруж", "нагруз", "who has", "free"):
        over = [r for r in snap["workload"] if r["above_limit"]]
        free = [r for r in snap["workload"] if r["open"] < project.workload_limit]
        lines = []
        if over:
            lines.append(f"Above the limit of {project.workload_limit} open tasks:")
            lines += [f"- {r['name']}: {r['open']} open" for r in over[:8]]
        else:
            lines.append(f"Nobody is above the limit of {project.workload_limit} open tasks.")
        if free:
            lines.append("Has capacity: " + ", ".join(f"{r['name']} ({r['open']})" for r in free[:6]) + ".")
        return "\n".join(lines)

    if _has(q, "behind", "late", "delay", "why", "overdue", "отста", "почему", "просроч", "задерж"):
        if not delayed and not risky:
            return f"Nothing is behind schedule: no delayed or at-risk tasks among {len(open_tasks)} open tasks."
        lines = [f"{len(delayed)} task{'s are' if len(delayed) != 1 else ' is'} delayed and {len(risky)} at risk."]
        owners = {}
        for t in delayed:
            owners[t.owner_id] = owners.get(t.owner_id, 0) + 1
        if owners:
            top = sorted(owners.items(), key=lambda x: -x[1])[:3]
            lines.append("Delays concentrate on: " + ", ".join(f"{members[o].name} ({n})" for o, n in top) + ".")
        blocked = [t for t in delayed + risky if any(d.status != "done" for d in t.depends_on.all())]
        if blocked:
            lines.append(f"{len(blocked)} of them wait on unfinished dependencies.")
        over = [r for r in snap["workload"] if r["above_limit"]]
        if over:
            lines.append(f"{len(over)} people are above the workload limit, which slows their tasks down.")
        lines.append("Most overdue:")
        lines += ["- " + _fmt_task(t, sig[t.id], members) for t in delayed[:5]]
        if risky:
            lines.append("At risk next:")
            lines += ["- " + _fmt_task(t, sig[t.id], members) for t in risky[:3]]
        return "\n".join(lines)

    if _has(q, "this week", "deadline", "due", "week", "дедлайн", "недел", "срок", "today", "сегодня"):
        horizon = 1 if _has(q, "today", "сегодня") else 7
        due = sorted([t for t in open_tasks if ref <= t.due_date <= ref + timedelta(days=horizon)], key=lambda t: t.due_date)
        if not due:
            return f"No open tasks are due in the next {horizon} day{'s' if horizon != 1 else ''}."
        return f"{len(due)} open task{'s' if len(due) != 1 else ''} due by {(ref + timedelta(days=horizon)):%d %b}:\n" + "\n".join(
            "- " + _fmt_task(t, sig[t.id], members) for t in due[:12]
        )

    if _has(q, "health", "on track", "status", "progress", "здоров", "прогресс", "статус", "как дела", "summary", "brief", "итог", "сводк"):
        b = rules.daily_brief(project, tasks, snap, members)
        return "\n".join([f"**{b['headline']}**"] + [f"- {x}" for x in b["bullets"]] + ([b["focus"]] if b["focus"] else []))

    if _has(q, "what should", "focus", "priorit", "next", "что делать", "приоритет", "сначала", "recommend"):
        pick = sorted(open_tasks, key=lambda t: ({"delayed": 0, "due_today": 1, "at_risk": 2}.get(sig[t.id]["state"], 3), -rules.PRIORITY_WEIGHT[t.priority], t.due_date))[:5]
        if not pick:
            return "All tasks are done."
        return "Suggested focus, most urgent first:\n" + "\n".join("- " + _fmt_task(t, sig[t.id], members) for t in pick)

    if _has(q, "block", "depend", "блок", "завис"):
        blocked = [t for t in open_tasks if any(d.status != "done" for d in t.depends_on.all())]
        if not blocked:
            return "No open task is waiting on an unfinished dependency."
        return f"{len(blocked)} open task{'s' if len(blocked) != 1 else ''} wait on unfinished work:\n" + "\n".join(
            f"- **{t.key}** waits on " + ", ".join(d.key for d in t.depends_on.all() if d.status != "done") for t in blocked[:10]
        )

    if _has(q, "bug", "баг"):
        bugs = [t for t in open_tasks if t.issue_type.lower() == "bug"]
        return f"{len(bugs)} open bugs. Highest priority:\n" + "\n".join(
            "- " + _fmt_task(t, sig[t.id], members) for t in sorted(bugs, key=lambda t: -rules.PRIORITY_WEIGHT[t.priority])[:6]
        ) if bugs else "There are no open bugs."

    return (
        f"{project.name}: {snap['done']} of {snap['total']} tasks done ({snap['percent']}%), "
        f"{len(delayed)} delayed, {len(risky)} at risk, health {snap['health']['score']}/100.\n"
        "You can ask: “Why are we behind schedule?”, “Who is overloaded?”, “What is due this week?”, "
        "“What should we focus on today?”, “What is <name> working on?” or about a task key."
    )


def answer(question, project, tasks, snap, members, history):
    if claude_available():
        try:
            text = ask_claude(question, project_context(project, tasks, snap, members), history)
            if text:
                return text, "claude"
        except Exception as exc:  # network, auth or rate limit: fall back to the built-in engine
            log.warning("Claude API call failed, using built-in analyst: %s", exc)
    return analyst_answer(question, project, tasks, snap, members), "analyst"


# ---------------------------------------------------------------- F4 subtask suggestions

TEMPLATES = {
    "bug": ["Reproduce the problem and write down the exact steps", "Add a failing test that shows the bug",
            "Fix the root cause", "Run the full test suite and check for regressions", "Ask a teammate to review the fix"],
    "test": ["List the cases to cover, including boundary cases", "Write the tests", "Run them on CI", "Review the coverage report"],
    "design": ["Collect requirements and examples", "Sketch the screens in Figma", "Review with the Product Owner", "Fix the comments and hand off"],
    "default": ["Clarify the expected result and acceptance criteria", "Split the work into one-day steps",
                "Build the first working version", "Check it against the acceptance criteria", "Ask for review and close the task"],
}


def suggest_subtasks(task):
    if claude_available():
        try:
            import anthropic

            client = anthropic.Anthropic()
            schema = {
                "type": "object",
                "properties": {"subtasks": {"type": "array", "items": {"type": "string"}}},
                "required": ["subtasks"],
                "additionalProperties": False,
            }
            response = client.beta.messages.create(
                model=MODEL,
                max_tokens=2000,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                messages=[{
                    "role": "user",
                    "content": "Suggest 3-6 short, concrete subtasks (each under 12 words) for this task.\n"
                    f"Type: {task.issue_type}\nTitle: {task.title}\nDescription: {task.description[:2000]}",
                }],
            )
            if response.stop_reason != "refusal":
                text = "".join(b.text for b in response.content if b.type == "text")
                items = [s.strip() for s in json.loads(text)["subtasks"] if s.strip()]
                if items:
                    return items[:6], "claude"
        except Exception as exc:
            log.warning("Claude subtask suggestion failed, using templates: %s", exc)
    t = (task.issue_type + " " + task.title).lower()
    key = "bug" if "bug" in t or "fix" in t else "test" if "test" in t else "design" if _has(t, "design", "screen", "prototype", "figma") else "default"
    return TEMPLATES[key], "analyst"

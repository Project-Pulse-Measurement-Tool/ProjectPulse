"""Project rules: delay warnings (F5 / US3), workload (F2 / US1), health score and the Daily Brief.

All functions are pure over already-loaded task lists so they are cheap to test and reuse.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta

from django.utils import timezone

AT_RISK_DAYS = 2
OPEN = ("todo", "in_progress", "review")
PRIORITY_WEIGHT = {"highest": 5, "high": 4, "medium": 3, "low": 2, "lowest": 1}


def today():
    return timezone.localdate()


def owner_open_counts(tasks):
    return Counter(t.owner_id for t in tasks if t.status in OPEN)


def task_signal(task, ref=None, open_counts=None, limit=3):
    """Return the warning state of one task with human-readable reasons.

    state is one of: done, delayed, due_today, at_risk, on_track.
    US3 AC1: "Not started" with a deadline in 2 days or less -> warning with reason.
    US3 AC2: deadline passed and not Done -> "Delayed".
    """
    ref = ref or today()
    if task.status == "done":
        return {"state": "done", "label": "Done", "reasons": [], "days_left": None}

    days_left = (task.due_date - ref).days
    reasons = []
    blockers = [d for d in task.depends_on.all() if d.status != "done"] if task.pk else []
    if blockers:
        keys = ", ".join(d.key for d in blockers[:3])
        reasons.append(f"Depends on {keys}, still not done.")
    if open_counts is not None and open_counts.get(task.owner_id, 0) > limit:
        reasons.append(f"Owner has {open_counts[task.owner_id]} open tasks, above the limit of {limit}.")

    if days_left < 0:
        late = -days_left
        reasons.insert(0, f"Deadline passed {late} day{'s' if late != 1 else ''} ago and the task is not Done.")
        return {"state": "delayed", "label": "Delayed", "reasons": reasons, "days_left": days_left}
    if days_left == 0:
        reasons.insert(0, "Due today.")
        return {"state": "due_today", "label": "Due today", "reasons": reasons, "days_left": 0}

    risky = False
    if days_left <= AT_RISK_DAYS and task.status == "todo":
        reasons.insert(0, f"Due in {days_left} day{'s' if days_left != 1 else ''} and still not started.")
        risky = True
    elif days_left <= 1 and task.status == "in_progress":
        reasons.insert(0, "Due tomorrow and still in progress.")
        risky = True
    elif days_left <= AT_RISK_DAYS and blockers:
        reasons.insert(0, f"Due in {days_left} days.")
        risky = True
    if risky:
        return {"state": "at_risk", "label": "At risk", "reasons": reasons, "days_left": days_left}
    return {"state": "on_track", "label": "On track", "reasons": [], "days_left": days_left}


def workload(tasks, members, limit):
    counts = owner_open_counts(tasks)
    by_member = defaultdict(lambda: Counter())
    for t in tasks:
        if t.status in OPEN:
            by_member[t.owner_id][t.status] += 1
    rows = []
    for m in members:
        n = counts.get(m.id, 0)
        rows.append(
            {
                "member": m.id,
                "name": m.name,
                "initials": m.initials,
                "color": m.color,
                "role": m.role,
                "open": n,
                "todo": by_member[m.id]["todo"],
                "in_progress": by_member[m.id]["in_progress"],
                "review": by_member[m.id]["review"],
                "above_limit": n > limit,
            }
        )
    rows.sort(key=lambda r: (-r["open"], r["name"]))
    return rows


def health_score(tasks, signals, workload_rows):
    """0-100. Starts at 100 and loses points for delayed and at-risk open work and for overload."""
    open_tasks = [t for t in tasks if t.status in OPEN]
    if not tasks:
        return {"score": 100, "label": "No tasks yet", "parts": []}
    n_open = max(len(open_tasks), 1)
    delayed = sum(1 for t in open_tasks if signals[t.id]["state"] == "delayed")
    risk = sum(1 for t in open_tasks if signals[t.id]["state"] in ("at_risk", "due_today"))
    over = sum(1 for r in workload_rows if r["above_limit"])
    active = max(sum(1 for r in workload_rows if r["open"]), 1)
    p_delay = round(45 * delayed / n_open)
    p_risk = round(20 * risk / n_open)
    p_over = round(20 * over / active)
    done_ratio = sum(1 for t in tasks if t.status == "done") / len(tasks)
    p_progress = round(15 * (1 - done_ratio))
    score = max(0, 100 - p_delay - p_risk - p_over - p_progress)
    label = "Healthy" if score >= 75 else "Needs attention" if score >= 50 else "At risk"
    return {
        "score": score,
        "label": label,
        "parts": [
            {"name": "Delayed open tasks", "value": f"{delayed} of {len(open_tasks)}", "penalty": p_delay},
            {"name": "At risk / due today", "value": f"{risk} of {len(open_tasks)}", "penalty": p_risk},
            {"name": "Members above limit", "value": f"{over} of {active}", "penalty": p_over},
            {"name": "Work not yet done", "value": f"{round((1 - done_ratio) * 100)}%", "penalty": p_progress},
        ],
    }


def project_snapshot(project, tasks, members, ref=None):
    """Everything the dashboard, brief and assistant need, computed in one pass."""
    ref = ref or today()
    limit = project.workload_limit
    counts = owner_open_counts(tasks)
    signals = {t.id: task_signal(t, ref, counts, limit) for t in tasks}
    status_counts = Counter(t.status for t in tasks)
    rows = workload(tasks, members, limit)
    health = health_score(tasks, signals, rows)
    total = len(tasks)
    done = status_counts["done"]
    return {
        "ref": ref,
        "signals": signals,
        "counts": counts,
        "status_counts": {k: status_counts.get(k, 0) for k in ("done", "in_progress", "review", "todo")},
        "total": total,
        "done": done,
        "percent": round(100 * done / total) if total else 0,
        "workload": rows,
        "health": health,
        "late": [t for t in tasks if signals[t.id]["state"] in ("delayed", "at_risk", "due_today")],
    }


def suggest_next_action(task, signal, snapshot, members_by_id):
    """A concrete, rule-based next step for the task page (Figma 'Suggested next action')."""
    if signal["state"] == "done":
        return None
    blockers = [d for d in task.depends_on.all() if d.status != "done"]
    owner_load = snapshot["counts"].get(task.owner_id, 0)
    limit = snapshot.get("limit", 3)
    # Prefer someone under the limit; otherwise the least-loaded teammate if clearly less busy than the owner.
    others = sorted((r for r in snapshot["workload"] if r["member"] != task.owner_id), key=lambda r: r["open"])
    helper = others[0] if others and (others[0]["open"] < limit or others[0]["open"] <= owner_load - 2) else None

    if blockers:
        owners = sorted({members_by_id[b.owner_id].name for b in blockers if b.owner_id in members_by_id})
        who = " and ".join(owners[:2]) or "the owners"
        keys = " and ".join(b.key for b in blockers[:2])
        return {
            "kind": "unblock",
            "headline": f"Ask {who} to finish {keys} first.",
            "detail": f"{task.key} cannot be finished until {keys} {'is' if len(blockers) == 1 else 'are'} done.",
            "new_owner": None,
        }
    if owner_load > limit and helper and signal["state"] in ("delayed", "at_risk", "due_today"):
        return {
            "kind": "reassign",
            "headline": f"Move this task to {helper['name']}, who has {helper['open']} open task{'s' if helper['open'] != 1 else ''}.",
            "detail": f"The current owner has {owner_load} open tasks, above the limit of {limit}.",
            "new_owner": helper["member"],
        }
    if signal["state"] == "delayed":
        return {
            "kind": "replan",
            "headline": "Agree a new deadline today or split the task.",
            "detail": "The deadline has passed. A smaller first step keeps the work visible.",
            "new_owner": None,
        }
    if signal["state"] in ("at_risk", "due_today") and task.status == "todo":
        return {
            "kind": "start",
            "headline": "Start this task today and move it to In progress.",
            "detail": "It is close to the deadline and has not been started.",
            "new_owner": None,
        }
    if signal["state"] in ("at_risk", "due_today"):
        owner = members_by_id.get(task.owner_id)
        name = owner.name if owner else "the owner"
        return {
            "kind": "checkin",
            "headline": f"Check in with {name} today and agree what can still ship by {task.due_date:%d %b}.",
            "detail": "The deadline is close. Cut the scope or move the date now, not after it is missed.",
            "new_owner": None,
        }
    if task.status == "review":
        return {
            "kind": "review",
            "headline": "Ask a teammate to review and close it.",
            "detail": "The work is waiting in Review.",
            "new_owner": None,
        }
    return None


def daily_brief(project, tasks, snapshot, members_by_id):
    """AI Daily Brief: one short, honest status update built from live task data."""
    ref = snapshot["ref"]
    sig = snapshot["signals"]
    delayed = [t for t in tasks if sig[t.id]["state"] == "delayed"]
    risky = [t for t in tasks if sig[t.id]["state"] in ("at_risk", "due_today")]
    over = [r for r in snapshot["workload"] if r["above_limit"]]
    since = ref - timedelta(days=1)
    closed_recent = [t for t in tasks if t.resolved_at and t.resolved_at.date() >= since]
    week_end = ref + timedelta(days=7)
    due_week = [t for t in tasks if t.status != "done" and ref <= t.due_date <= week_end]

    h = snapshot["health"]
    if h["score"] >= 75:
        headline = f"{project.name} is on track: {snapshot['percent']}% done, health {h['score']}/100."
    elif h["score"] >= 50:
        headline = f"{project.name} needs attention: {len(delayed)} delayed and {len(risky)} at-risk tasks."
    else:
        headline = f"{project.name} is behind: {len(delayed)} delayed tasks and {len(over)} overloaded people."

    bullets = []
    if closed_recent:
        bullets.append(f"{len(closed_recent)} task{'s' if len(closed_recent) != 1 else ''} closed since yesterday.")
    if due_week:
        bullets.append(f"{len(due_week)} open task{'s' if len(due_week) != 1 else ''} due in the next 7 days.")
    if delayed:
        top = sorted(delayed, key=lambda t: (t.due_date, -PRIORITY_WEIGHT[t.priority]))[:3]
        bullets.append("Most overdue: " + "; ".join(f"{t.key} ({members_by_id[t.owner_id].name})" for t in top) + ".")
    if risky:
        bullets.append("At risk soon: " + "; ".join(f"{t.key} due {t.due_date:%d %b}" for t in risky[:3]) + ".")
    if over:
        bullets.append(
            "Above the limit of "
            + str(project.workload_limit)
            + ": "
            + ", ".join(f"{r['name']} ({r['open']})" for r in over[:4])
            + "."
        )
    if not bullets:
        bullets.append("No open risks found in the task data.")

    focus = None
    if delayed:
        t = sorted(delayed, key=lambda t: (-PRIORITY_WEIGHT[t.priority], t.due_date))[0]
        focus = f"Today: resolve or replan {t.key} “{t.title[:70]}”."
    elif risky:
        t = risky[0]
        focus = f"Today: make sure {members_by_id[t.owner_id].name} starts {t.key}."
    elif over:
        focus = f"Today: move one task away from {over[0]['name']}."
    return {"date": ref.isoformat(), "headline": headline, "bullets": bullets, "focus": focus, "health": h}

from collections import Counter, defaultdict
from datetime import timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import ai, rules
from .jira_import import KNOWN_PROJECTS, JiraError, color_for, import_project
from .models import Activity, ChatMessage, Comment, Member, Notification, Project, Subtask, Task

# ---------------------------------------------------------------- helpers


def load(project):
    tasks = list(
        project.tasks.select_related("owner").prefetch_related(
            Prefetch("depends_on", queryset=Task.objects.only("id", "key", "status", "owner_id", "title"))
        )
    )
    member_ids = {t.owner_id for t in tasks} | set(project.members.values_list("id", flat=True))
    members = {m.id: m for m in Member.objects.filter(id__in=member_ids)}
    snap = rules.project_snapshot(project, tasks, list(members.values()))
    snap["limit"] = project.workload_limit
    return tasks, members, snap


def sync_notifications(project, tasks, snap):
    """US8: create one 'Delayed' notification per owner and task the first time it becomes delayed."""
    existing = set(
        Notification.objects.filter(task__project=project, kind="delayed").values_list("task_id", flat=True)
    )
    new = [
        Notification(
            member_id=t.owner_id,
            task=t,
            kind="delayed",
            message=f"{t.key} is now Delayed: the deadline {t.due_date:%d %b} has passed.",
        )
        for t in tasks
        if snap["signals"][t.id]["state"] == "delayed" and t.id not in existing
    ]
    Notification.objects.bulk_create(new, ignore_conflicts=True)


def member_json(m):
    return {"id": m.id, "name": m.name, "initials": m.initials, "color": m.color, "role": m.role,
            "has_login": m.user_id is not None}


def task_json(t, snap, members, full=False):
    sig = snap["signals"].get(t.id) or rules.task_signal(t, snap["ref"], snap["counts"], snap["limit"])
    owner = members.get(t.owner_id) or t.owner
    data = {
        "id": t.id,
        "key": t.key,
        "title": t.title,
        "status": t.status,
        "status_label": t.get_status_display(),
        "priority": t.priority,
        "issue_type": t.issue_type,
        "owner": member_json(owner),
        "due_date": t.due_date.isoformat(),
        "due_source": t.due_source,
        "due_source_label": t.get_due_source_display(),
        "signal": sig,
        "depends_on": [{"id": d.id, "key": d.key, "status": d.status, "title": d.title} for d in t.depends_on.all()],
        "external_url": t.external_url,
        "estimate_hours": float(t.estimate_hours) if t.estimate_hours is not None else None,
        "updated_at": t.updated_at.isoformat(),
    }
    if full:
        data.update(
            {
                "description": t.description,
                "fix_version": t.fix_version,
                "components": t.components,
                "jira_status": t.jira_status,
                "created_at": t.created_at.isoformat(),
                "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
                "blocks": [{"id": b.id, "key": b.key, "status": b.status, "title": b.title} for b in t.blocks.all()],
                "subtasks": [
                    {"id": s.id, "title": s.title, "done": s.done, "ai_generated": s.ai_generated} for s in t.subtasks.all()
                ],
                "comments": [
                    {"id": c.id, "author": c.author, "body": c.body, "created_at": c.created_at.isoformat()}
                    for c in t.comments.all()
                ],
                "activity": [
                    {"actor": a.actor, "kind": a.kind, "detail": a.detail, "created_at": a.created_at.isoformat()}
                    for a in t.activity.all()[:20]
                ],
                "suggestion": rules.suggest_next_action(t, sig, snap, members),
                "project": {"id": t.project_id, "name": t.project.name, "key": t.project.key},
            }
        )
    return data


def project_json(p, snap=None):
    data = {
        "id": p.id,
        "key": p.key,
        "name": p.name,
        "description": p.description,
        "goal": p.goal,
        "source": p.source,
        "source_url": p.source_url,
        "workload_limit": p.workload_limit,
        "last_synced": p.last_synced.isoformat() if p.last_synced else None,
    }
    if snap:
        data.update(
            {
                "total": snap["total"],
                "done": snap["done"],
                "percent": snap["percent"],
                "health": snap["health"]["score"],
                "health_label": snap["health"]["label"],
                "late": len(snap["late"]),
                "people": sum(1 for r in snap["workload"] if r["open"]),
            }
        )
    return data


def actor(request):
    m = getattr(request.user, "member", None)
    return m.name if m else request.user.username


def me_json(user):
    m = getattr(user, "member", None)
    return {"username": user.username, "member": member_json(m) if m else None}


# ---------------------------------------------------------------- auth


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    username = (request.data.get("username") or "").strip().lower()
    password = request.data.get("password") or ""
    name = (request.data.get("name") or "").strip()
    if len(username) < 3 or len(password) < 6 or not name:
        return Response({"detail": "Name, a username of 3+ characters and a password of 6+ characters are required."}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "This username is taken."}, status=400)
    with transaction.atomic():
        user = User.objects.create_user(username=username, password=password)
        member = Member.objects.create(name=name, user=user, role=request.data.get("role") or "Team member", color=color_for(name))
        demo = Project.objects.filter(key="PP").first()
        if demo:
            demo.members.add(member)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": me_json(user)}, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(username=(request.data.get("username") or "").strip().lower(), password=request.data.get("password") or "")
    if not user:
        return Response({"detail": "Wrong username or password."}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": me_json(user)})


@api_view(["GET"])
def me(request):
    return Response(me_json(request.user))


@api_view(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=204)


# ---------------------------------------------------------------- projects


@api_view(["GET", "POST"])
def projects(request):
    if request.method == "POST":
        d = request.data
        key = (d.get("key") or "").strip().upper()
        name = (d.get("name") or "").strip()
        if not key.isalnum() or not name:
            return Response({"detail": "A short key (letters/digits) and a name are required."}, status=400)
        if Project.objects.filter(key=key).exists():
            return Response({"detail": "A project with this key already exists."}, status=400)
        p = Project.objects.create(
            key=key, name=name, description=d.get("description", ""), goal=d.get("goal", ""),
            workload_limit=int(d.get("workload_limit") or 3),
        )
        if getattr(request.user, "member", None):
            p.members.add(request.user.member)
        return Response(project_json(p, load(p)[2]), status=201)
    out = []
    for p in Project.objects.all():
        out.append(project_json(p, load(p)[2]))
    return Response(out)


@api_view(["GET", "PATCH", "DELETE"])
def project_detail(request, pk):
    p = get_object_or_404(Project, pk=pk)
    if request.method == "DELETE":
        p.delete()
        return Response(status=204)
    if request.method == "PATCH":
        for f in ("name", "description", "goal"):
            if f in request.data:
                setattr(p, f, request.data[f])
        if "workload_limit" in request.data:
            p.workload_limit = max(1, int(request.data["workload_limit"]))
        p.save()
    tasks, members, snap = load(p)
    data = project_json(p, snap)
    data["members"] = [member_json(m) for m in sorted(members.values(), key=lambda m: m.name)]
    return Response(data)


@api_view(["GET"])
def jira_catalog(request):
    imported = set(Project.objects.filter(source="apache_jira").values_list("key", flat=True))
    return Response([{"key": k, "name": v, "imported": k in imported} for k, v in KNOWN_PROJECTS.items()])


@api_view(["POST"])
def jira_import(request):
    key = (request.data.get("key") or "").strip().upper()
    if not key.isalnum():
        return Response({"detail": "Enter an Apache Jira project key, for example KAFKA."}, status=400)
    try:
        p = import_project(key, max_issues=int(request.data.get("max_issues") or 250), log=lambda *_: None)
    except JiraError as exc:
        return Response({"detail": str(exc)}, status=502)
    return Response(project_json(p, load(p)[2]), status=201)


@api_view(["POST"])
def project_sync(request, pk):
    p = get_object_or_404(Project, pk=pk)
    if p.source != "apache_jira":
        return Response({"detail": "Only imported projects can be synced."}, status=400)
    try:
        import_project(p.key, log=lambda *_: None)
    except JiraError as exc:
        return Response({"detail": str(exc)}, status=502)
    p.refresh_from_db()
    return Response(project_json(p, load(p)[2]))


@api_view(["GET"])
def dashboard(request, pk):
    p = get_object_or_404(Project, pk=pk)
    tasks, members, snap = load(p)
    sync_notifications(p, tasks, snap)
    ref = snap["ref"]
    upcoming = sorted([t for t in tasks if t.status != "done" and t.due_date >= ref], key=lambda t: t.due_date)[:6]
    return Response(
        {
            "project": project_json(p, snap),
            "status_counts": snap["status_counts"],
            "workload": snap["workload"][:8],
            "workload_total": sum(1 for r in snap["workload"] if r["open"]),
            "upcoming": [task_json(t, snap, members) for t in upcoming],
            "late_count": len(snap["late"]),
            "delayed_count": sum(1 for t in tasks if snap["signals"][t.id]["state"] == "delayed"),
            "health": snap["health"],
            "brief": rules.daily_brief(p, tasks, snap, members),
            "today": ref.isoformat(),
        }
    )


@api_view(["GET"])
def brief(request, pk):
    p = get_object_or_404(Project, pk=pk)
    tasks, members, snap = load(p)
    return Response(rules.daily_brief(p, tasks, snap, members))


# ---------------------------------------------------------------- tasks


def _parse_owner(project, value):
    if not value:
        return None
    return Member.objects.filter(pk=value).first()


@api_view(["GET", "POST"])
def project_tasks(request, pk):
    p = get_object_or_404(Project, pk=pk)
    if request.method == "POST":
        d = request.data
        title = (d.get("title") or "").strip()
        owner = _parse_owner(p, d.get("owner"))
        due = parse_date(d.get("due_date") or "")
        errors = {}
        if not title:
            errors["title"] = "Write a short title."
        if not owner:  # US4 AC2: a task without an owner is not saved
            errors["owner"] = "Choose one owner. A task without an owner is not saved."
        if not due:
            errors["due_date"] = "Choose a deadline."
        if errors:
            return Response({"detail": "The task was not saved.", "errors": errors}, status=400)
        with transaction.atomic():
            p = Project.objects.select_for_update().get(pk=p.pk)
            prefix = "T" if p.key == "PP" else p.key + "-"
            n = p.next_task_number
            while Task.objects.filter(project=p, key=f"{prefix}{n}").exists():
                n += 1
            p.next_task_number = n + 1
            p.save(update_fields=["next_task_number"])
            now = timezone.now()
            t = Task.objects.create(
                project=p, key=f"{prefix}{n}", title=title[:300], description=d.get("description", ""),
                status=d.get("status") if d.get("status") in dict(Task.STATUS_CHOICES) else "todo",
                priority=d.get("priority") if d.get("priority") in dict(Task.PRIORITY_CHOICES) else "medium",
                issue_type=d.get("issue_type") or "Task", owner=owner, due_date=due, due_source="manual",
                estimate_hours=d.get("estimate_hours") or None, created_at=now, updated_at=now,
            )
            if d.get("depends_on"):
                t.depends_on.set(Task.objects.filter(project=p, id__in=d["depends_on"]))
            p.members.add(owner)
            Activity.objects.create(task=t, actor=actor(request), kind="created", detail=f"Created and assigned to {owner.name}")
            if owner.user_id != request.user.id:
                Notification.objects.get_or_create(member=owner, task=t, kind="assigned",
                                                   defaults={"message": f"{actor(request)} assigned {t.key} to you, due {due:%d %b}."})
        tasks, members, snap = load(p)
        t = next(x for x in tasks if x.id == t.id)
        return Response(task_json(t, snap, members), status=201)

    tasks, members, snap = load(p)
    q = (request.GET.get("q") or "").lower().strip()
    st = request.GET.get("status")
    owner = request.GET.get("owner")
    sig = request.GET.get("signal")
    prio = request.GET.get("priority")
    out = tasks
    if q:
        out = [t for t in out if q in t.title.lower() or q in t.key.lower()]
    if st:
        allowed = st.split(",")
        out = [t for t in out if t.status in allowed]
    if owner:
        out = [t for t in out if str(t.owner_id) == owner]
    if prio:
        out = [t for t in out if t.priority == prio]
    if sig:
        allowed = sig.split(",")
        out = [t for t in out if snap["signals"][t.id]["state"] in allowed]
    order = request.GET.get("ordering", "due")
    if order == "priority":
        out = sorted(out, key=lambda t: (-rules.PRIORITY_WEIGHT[t.priority], t.due_date))
    elif order == "updated":
        out = sorted(out, key=lambda t: t.updated_at, reverse=True)
    elif order == "risk":
        rank = {"delayed": 0, "due_today": 1, "at_risk": 2, "on_track": 3, "done": 4}
        out = sorted(out, key=lambda t: (rank[snap["signals"][t.id]["state"]], t.due_date))
    return Response([task_json(t, snap, members) for t in out])


def _task_full(t):
    tasks, members, snap = load(t.project)
    t = (
        Task.objects.select_related("owner", "project")
        .prefetch_related("depends_on", "blocks", "subtasks", "comments", "activity")
        .get(pk=t.pk)
    )
    return task_json(t, snap, members, full=True)


@api_view(["GET", "PATCH", "DELETE"])
def task_detail(request, pk):
    t = get_object_or_404(Task.objects.select_related("project", "owner"), pk=pk)
    if request.method == "DELETE":
        t.delete()
        return Response(status=204)
    if request.method == "PATCH":
        d = request.data
        who = actor(request)
        if "owner" in d:
            owner = _parse_owner(t.project, d["owner"])
            if not owner:
                return Response({"detail": "A task must keep one owner.", "errors": {"owner": "Choose one owner."}}, status=400)
            if owner.id != t.owner_id:
                Activity.objects.create(task=t, actor=who, kind="owner", detail=f"Owner changed from {t.owner.name} to {owner.name}")
                Notification.objects.update_or_create(member=owner, task=t, kind="assigned",
                                                      defaults={"message": f"{who} assigned {t.key} to you.", "read": False})
                t.owner = owner
                t.project.members.add(owner)
        if "status" in d and d["status"] in dict(Task.STATUS_CHOICES) and d["status"] != t.status:
            Activity.objects.create(task=t, actor=who, kind="status",
                                    detail=f"Status changed from {t.get_status_display()} to {dict(Task.STATUS_CHOICES)[d['status']]}")
            t.status = d["status"]
            t.resolved_at = timezone.now() if t.status == "done" else None
        if "due_date" in d:
            due = parse_date(d["due_date"] or "")
            if not due:
                return Response({"detail": "A task must keep a deadline.", "errors": {"due_date": "Choose a deadline."}}, status=400)
            if due != t.due_date:
                Activity.objects.create(task=t, actor=who, kind="due", detail=f"Deadline moved from {t.due_date:%d %b} to {due:%d %b}")
                t.due_date, t.due_source = due, "manual"
                Notification.objects.filter(task=t, kind="delayed").delete()
        for f in ("title", "description", "priority", "issue_type"):
            if f in d:
                setattr(t, f, d[f])
        if "estimate_hours" in d:
            t.estimate_hours = d["estimate_hours"] or None
        if "depends_on" in d:
            t.depends_on.set(Task.objects.filter(project=t.project, id__in=d["depends_on"]).exclude(id=t.id))
        t.updated_at = timezone.now()
        t.save()
    return Response(_task_full(t))


@api_view(["POST"])
def task_suggestion(request, pk):
    """Accept or dismiss the 'Suggested next action' card."""
    t = get_object_or_404(Task.objects.select_related("project", "owner"), pk=pk)
    action = request.data.get("action")
    tasks, members, snap = load(t.project)
    t_loaded = next(x for x in tasks if x.id == t.id)
    sug = rules.suggest_next_action(t_loaded, snap["signals"][t.id], snap, members)
    who = actor(request)
    if not sug:
        return Response({"detail": "No suggestion for this task."}, status=400)
    if action == "dismiss":
        Activity.objects.create(task=t, actor=who, kind="suggestion", detail=f"Dismissed suggestion: {sug['headline']}")
    elif action == "accept":
        if sug["kind"] == "reassign" and sug["new_owner"]:
            new = members[sug["new_owner"]]
            Activity.objects.create(task=t, actor=who, kind="owner", detail=f"Owner changed from {t.owner.name} to {new.name} (AI suggestion)")
            t.owner = new
            Notification.objects.update_or_create(member=new, task=t, kind="assigned",
                                                  defaults={"message": f"{who} moved {t.key} to you.", "read": False})
        elif sug["kind"] == "start" and t.status == "todo":
            t.status = "in_progress"
            Activity.objects.create(task=t, actor=who, kind="status", detail="Status changed from To do to In progress (AI suggestion)")
        else:
            Activity.objects.create(task=t, actor=who, kind="suggestion", detail=f"Accepted suggestion: {sug['headline']}")
        t.updated_at = timezone.now()
        t.save()
    else:
        return Response({"detail": "action must be accept or dismiss"}, status=400)
    return Response(_task_full(t))


@api_view(["POST"])
def task_comments(request, pk):
    t = get_object_or_404(Task, pk=pk)
    body = (request.data.get("body") or "").strip()
    if not body:
        return Response({"detail": "Write a comment."}, status=400)
    Comment.objects.create(task=t, author=actor(request), body=body, created_at=timezone.now())
    return Response(_task_full(t), status=201)


@api_view(["POST"])
def task_subtasks(request, pk):
    t = get_object_or_404(Task, pk=pk)
    titles = request.data.get("titles") or [request.data.get("title")]
    titles = [s.strip() for s in titles if s and s.strip()]
    if not titles:
        return Response({"detail": "Write a subtask."}, status=400)
    ai_flag = bool(request.data.get("ai_generated"))
    Subtask.objects.bulk_create([Subtask(task=t, title=s[:300], ai_generated=ai_flag) for s in titles])
    return Response(_task_full(t), status=201)


@api_view(["PATCH", "DELETE"])
def subtask_detail(request, pk):
    s = get_object_or_404(Subtask, pk=pk)
    if request.method == "DELETE":
        s.delete()
    else:
        if "done" in request.data:
            s.done = bool(request.data["done"])
        if "title" in request.data:
            s.title = request.data["title"][:300]
        s.save()
    return Response(_task_full(s.task))


@api_view(["POST"])
def suggest_subtasks(request, pk):
    t = get_object_or_404(Task, pk=pk)
    items, engine = ai.suggest_subtasks(t)
    return Response({"subtasks": items, "engine": engine})


# ---------------------------------------------------------------- workload, timeline, analytics


@api_view(["GET"])
def workload_view(request, pk):
    p = get_object_or_404(Project, pk=pk)
    tasks, members, snap = load(p)
    open_by_member = defaultdict(list)
    for t in sorted(tasks, key=lambda t: t.due_date):
        if t.status != "done":
            open_by_member[t.owner_id].append(task_json(t, snap, members))
    rows = []
    for r in snap["workload"]:
        r = dict(r)
        r["tasks"] = open_by_member.get(r["member"], [])
        r["late"] = sum(1 for x in r["tasks"] if x["signal"]["state"] in ("delayed", "at_risk", "due_today"))
        rows.append(r)
    return Response({"limit": p.workload_limit, "rows": rows})


@api_view(["GET"])
def timeline(request, pk):
    p = get_object_or_404(Project, pk=pk)
    tasks, members, snap = load(p)
    ref = snap["ref"]
    start = parse_date(request.GET.get("from") or "") or ref - timedelta(days=ref.weekday())
    weeks = int(request.GET.get("weeks") or 6)
    end = start + timedelta(days=7 * weeks - 1)
    include_done = request.GET.get("done") == "1"
    owner = request.GET.get("owner")
    items = [
        t for t in tasks
        if start <= t.due_date <= end and (include_done or t.status != "done") and (not owner or str(t.owner_id) == owner)
    ]
    overdue = [t for t in tasks if t.status != "done" and t.due_date < start and (not owner or str(t.owner_id) == owner)]
    return Response(
        {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "today": ref.isoformat(),
            "tasks": [task_json(t, snap, members) for t in sorted(items, key=lambda t: t.due_date)],
            "overdue_before": len(overdue),
        }
    )


@api_view(["GET"])
def analytics(request, pk):
    p = get_object_or_404(Project, pk=pk)
    tasks, members, snap = load(p)
    ref = snap["ref"]
    weeks = 12
    start = ref - timedelta(days=ref.weekday()) - timedelta(weeks=weeks - 1)
    created = Counter()
    resolved = Counter()
    for t in tasks:
        cd = t.created_at.date()
        if cd >= start:
            created[(cd - start).days // 7] += 1
        if t.resolved_at and t.resolved_at.date() >= start:
            resolved[(t.resolved_at.date() - start).days // 7] += 1
    flow = [
        {"week": (start + timedelta(weeks=i)).isoformat(), "created": created[i], "resolved": resolved[i]} for i in range(weeks)
    ]
    cycle = [(t.resolved_at - t.created_at).total_seconds() / 86400 for t in tasks if t.resolved_at]
    cycle.sort()
    done_on_time = [t for t in tasks if t.resolved_at and t.resolved_at.date() <= t.due_date]
    resolved_n = sum(1 for t in tasks if t.resolved_at)
    by_member = Counter(t.owner_id for t in tasks if t.status == "done")
    signal_counts = Counter(snap["signals"][t.id]["state"] for t in tasks)
    return Response(
        {
            "flow": flow,
            "by_priority": [{"key": k, "label": lbl, "open": sum(1 for t in tasks if t.priority == k and t.status != "done"),
                             "done": sum(1 for t in tasks if t.priority == k and t.status == "done")} for k, lbl in Task.PRIORITY_CHOICES],
            "by_type": [{"label": k, "count": v} for k, v in Counter(t.issue_type for t in tasks).most_common(6)],
            "by_status": snap["status_counts"],
            "signals": {k: signal_counts.get(k, 0) for k in ("delayed", "due_today", "at_risk", "on_track", "done")},
            "due_sources": [{"key": k, "label": lbl, "count": sum(1 for t in tasks if t.due_source == k)} for k, lbl in Task.DUE_SOURCE_CHOICES],
            "cycle_days_median": round(cycle[len(cycle) // 2], 1) if cycle else None,
            "on_time_rate": round(100 * len(done_on_time) / resolved_n) if resolved_n else None,
            "top_closers": [{"name": members[m].name, "count": n} for m, n in by_member.most_common(6) if m in members],
            "health": snap["health"],
            "total": snap["total"],
        }
    )


# ---------------------------------------------------------------- AI chat, notifications


@api_view(["GET", "POST", "DELETE"])
def chat(request, pk):
    p = get_object_or_404(Project, pk=pk)
    history = ChatMessage.objects.filter(project=p, user=request.user)
    if request.method == "DELETE":
        history.delete()
        return Response(status=204)
    if request.method == "POST":
        question = (request.data.get("message") or "").strip()
        if not question:
            return Response({"detail": "Ask a question."}, status=400)
        tasks, members, snap = load(p)
        past = list(history)
        text, engine = ai.answer(question, p, tasks, snap, members, past)
        ChatMessage.objects.create(project=p, user=request.user, role="user", content=question[:4000])
        ChatMessage.objects.create(project=p, user=request.user, role="assistant", content=text, engine=engine)
        history = ChatMessage.objects.filter(project=p, user=request.user)
    return Response(
        {
            "engine": ai.engine_name(),
            "messages": [{"id": m.id, "role": m.role, "content": m.content, "engine": m.engine, "created_at": m.created_at.isoformat()} for m in history],
        }
    )


@api_view(["GET"])
def ai_status(request):
    return Response({"engine": ai.engine_name(), "model": ai.MODEL if ai.claude_available() else None})


@api_view(["GET", "POST"])
def notifications(request):
    m = getattr(request.user, "member", None)
    if not m:
        return Response({"unread": 0, "items": []})
    qs = Notification.objects.filter(member=m).select_related("task", "task__project")
    if request.method == "POST":
        qs.update(read=True)
    items = [
        {"id": n.id, "kind": n.kind, "message": n.message, "read": n.read, "created_at": n.created_at.isoformat(),
         "task": {"id": n.task_id, "key": n.task.key, "project": n.task.project_id}}
        for n in qs[:40]
    ]
    return Response({"unread": qs.filter(read=False).count(), "items": items})


@api_view(["GET"])
def all_members(request):
    return Response([member_json(m) for m in Member.objects.filter(projects__isnull=False).distinct()])

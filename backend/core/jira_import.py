"""Live import of real issues from the public Apache Software Foundation Jira (issues.apache.org).

No login is needed: the ASF Jira REST API is public. Each issue keeps its real key, title, description,
assignee, status, priority, type, dates, comments and blocking links.

Deadlines: ProjectPulse requires one per task (US4). We use, in order:
  1. the Jira "Due date" field, when set;
  2. the release date of the earliest fix version that has one;
  3. otherwise an estimate: created date + a service window by priority. Such tasks are marked "estimated".
"""
import hashlib
from datetime import datetime, timedelta

import requests
from django.db import transaction
from django.utils import timezone
import html

from django.utils.dateparse import parse_date, parse_datetime
from django.utils.html import strip_tags

from .models import Comment, Member, Project, Task

BASE = "https://issues.apache.org/jira"
FIELDS = (
    "summary,description,status,assignee,priority,duedate,fixVersions,created,updated,"
    "resolutiondate,issuetype,components,comment,issuelinks"
)
PRIORITY_MAP = {"Blocker": "highest", "Critical": "high", "Major": "medium", "Minor": "low", "Trivial": "lowest"}
ESTIMATE_DAYS = {"highest": 14, "high": 21, "medium": 45, "low": 75, "lowest": 90}
REVIEW_STATUSES = {"patch available", "in review", "reviewable", "review", "under review", "pr open"}
PALETTE = ["#6D86B1", "#06B57C", "#D35268", "#E0A526", "#8B6CC1", "#2A9DB5", "#C1683C", "#4F7A5A", "#B5527F"]

KNOWN_PROJECTS = {
    "KAFKA": "Apache Kafka",
    "FLINK": "Apache Flink",
    "SPARK": "Apache Spark",
    "CASSANDRA": "Apache Cassandra",
    "HIVE": "Apache Hive",
    "HADOOP": "Apache Hadoop",
    "IGNITE": "Apache Ignite",
    "SOLR": "Apache Solr",
}


class JiraError(Exception):
    pass


def color_for(name):
    return PALETTE[int(hashlib.md5(name.encode()).hexdigest(), 16) % len(PALETTE)]


def map_status(status):
    cat = (status.get("statusCategory") or {}).get("key")
    name = (status.get("name") or "").lower()
    if cat == "done":
        return "done"
    if name in REVIEW_STATUSES:
        return "review"
    if cat == "indeterminate":
        return "in_progress"
    return "todo"


def _get(session, path, params=None):
    try:
        r = session.get(BASE + path, params=params, timeout=40)
    except requests.RequestException as exc:
        raise JiraError(f"Apache Jira is not reachable: {exc}") from exc
    if r.status_code == 400 or r.status_code == 404:
        raise JiraError(f"Apache Jira rejected the request ({r.status_code}). Check the project key.")
    r.raise_for_status()
    return r.json()


def fetch_project(key, max_issues=250, days=90):
    session = requests.Session()
    session.headers["Accept"] = "application/json"
    meta = _get(session, f"/rest/api/2/project/{key}")
    versions = {v["name"]: v.get("releaseDate") for v in _get(session, f"/rest/api/2/project/{key}/versions")}
    issues = []
    jql = f"project = {key} AND assignee is not EMPTY AND updated >= -{days}d ORDER BY updated DESC"
    while len(issues) < max_issues:
        page = _get(
            session,
            "/rest/api/2/search",
            {"jql": jql, "fields": FIELDS, "startAt": len(issues), "maxResults": min(100, max_issues - len(issues))},
        )
        batch = page.get("issues", [])
        issues.extend(batch)
        if not batch or len(issues) >= page.get("total", 0):
            break
    return meta, versions, issues


def _dt(value):
    return parse_datetime(value) if value else None


def _due(fields, versions, priority, created):
    if fields.get("duedate"):
        return parse_date(fields["duedate"]), "jira_due"
    dates = sorted(
        parse_date(versions.get(v["name"]) or v.get("releaseDate"))
        for v in fields.get("fixVersions") or []
        if versions.get(v["name"]) or v.get("releaseDate")
    )
    if dates:
        return dates[0], "release"
    return (created + timedelta(days=ESTIMATE_DAYS[priority])).date(), "estimated"


@transaction.atomic
def import_project(key, max_issues=250, days=90, log=print):
    key = key.strip().upper()
    meta, versions, issues = fetch_project(key, max_issues=max_issues, days=days)
    name = KNOWN_PROJECTS.get(key) or meta.get("name") or key
    project, _ = Project.objects.update_or_create(
        key=key,
        defaults={
            "name": name,
            "description": " ".join(html.unescape(strip_tags(meta.get("description") or "")).split())[:1000]
            or f"Live issues from the public {name} Jira tracker.",
            "goal": f"Ship the next {name} releases with no delayed work.",
            "source": "apache_jira",
            "source_url": f"{BASE}/projects/{key}",
        },
    )

    members = {}
    by_key = {}
    for raw in issues:
        f = raw["fields"]
        assignee = f.get("assignee") or {}
        aname = assignee.get("displayName") or assignee.get("name")
        if not aname:
            continue
        if aname not in members:
            m = Member.objects.filter(jira_name=aname).first() or Member.objects.create(
                name=aname, jira_name=aname, role="Contributor", color=color_for(aname)
            )
            members[aname] = m
        created = _dt(f.get("created")) or timezone.now()
        priority = PRIORITY_MAP.get((f.get("priority") or {}).get("name"), "medium")
        due, due_source = _due(f, versions, priority, created)
        status = map_status(f.get("status") or {})
        task, _ = Task.objects.update_or_create(
            project=project,
            key=raw["key"],
            defaults={
                "title": (f.get("summary") or raw["key"])[:300],
                "description": (f.get("description") or "")[:6000],
                "status": status,
                "jira_status": (f.get("status") or {}).get("name", ""),
                "priority": priority,
                "issue_type": (f.get("issuetype") or {}).get("name", "Task"),
                "owner": members[aname],
                "due_date": due,
                "due_source": due_source,
                "fix_version": ", ".join(v["name"] for v in f.get("fixVersions") or [])[:60],
                "components": ", ".join(c["name"] for c in f.get("components") or [])[:200],
                "external_url": f"{BASE}/browse/{raw['key']}",
                "created_at": created,
                "updated_at": _dt(f.get("updated")) or created,
                "resolved_at": _dt(f.get("resolutiondate")) if status == "done" else None,
            },
        )
        by_key[raw["key"]] = (task, f)
        task.comments.all().delete()
        Comment.objects.bulk_create(
            [
                Comment(
                    task=task,
                    author=(c.get("author") or {}).get("displayName", "Unknown"),
                    body=(c.get("body") or "")[:3000],
                    created_at=_dt(c.get("created")) or created,
                )
                for c in ((f.get("comment") or {}).get("comments") or [])[-8:]
            ]
        )

    # Blocking links: "is blocked by" / "depends upon" become dependencies inside the imported set.
    for task, f in by_key.values():
        deps = []
        for link in f.get("issuelinks") or []:
            inward = (link.get("type") or {}).get("inward", "").lower()
            other = link.get("inwardIssue")
            if other and ("blocked" in inward or "depend" in inward) and other["key"] in by_key:
                deps.append(by_key[other["key"]][0])
        task.depends_on.set(deps)

    project.members.add(*members.values())
    project.last_synced = timezone.now()
    project.save(update_fields=["last_synced"])
    log(f"{key}: imported {len(by_key)} issues, {len(members)} people")
    return project

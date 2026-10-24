"""Seed ProjectPulse with the team's own project and live Apache Jira data.

    python manage.py seed_data            # team project + KAFKA, FLINK, SPARK, CASSANDRA from issues.apache.org
    python manage.py seed_data --offline  # team project only

The team project "ProjectPulse MVP" uses the real tasks, owners, dates and hours from our course reports
(A3 Weekly Plan & Fact, A4 competencies plan, A5 charter, A6/A7 Sprint 1 backlog).
"""
from datetime import date, datetime, time

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.jira_import import JiraError, import_project
from core.models import Activity, Member, Project, Subtask, Task

DEMO_PASSWORD = "pulse2026"

TEAM = [
    # username, name, role, color
    ("aisha", "Aisha", "Product Owner · UX", "#6D86B1"),
    ("talshyn", "Talshyn", "Scrum Master · Frontend", "#06B57C"),
    ("marzhan", "Marzhan", "Backend Developer", "#D35268"),
    ("ayaulym", "Ayaulym", "AI Developer · Deployment", "#8B6CC1"),
    ("sagynysh", "Sagynysh", "Coordination Lead", "#E0A526"),
]

D = lambda m, d: date(2026, m, d)  # noqa: E731

# key, title, owner, due, status, priority, type, hours, depends_on, description
TASKS = [
    ("T1", "Create the survey for target users", "aisha", D(9, 22), "done", "high", "Research", 3, [], "Screening questions and open questions; shared with 24 respondents (A3)."),
    ("T2", "Analyse the survey responses and project brief", "aisha", D(9, 23), "done", "high", "Research", 3, ["T1"], "24 responses received, R1–R24 coded (A3)."),
    ("T3", "Research synthesis: insights and current alternatives", "marzhan", D(9, 24), "done", "high", "Research", 3, ["T2"], "Insight matrix with five insights E1–E5 and respondent IDs."),
    ("T4", "Revised problem statement and decision log", "marzhan", D(9, 24), "done", "medium", "Research", 2, ["T3"], "Problem statement confirmed with four decisions."),
    ("T5", "Idea list and initial feature list with priorities", "ayaulym", D(9, 24), "done", "high", "Product", 3, ["T4"], "Nine features F1–F9 with IDs, priorities and evidence links."),
    ("T6", "User stories US1–US3 with acceptance criteria", "sagynysh", D(9, 24), "done", "high", "Product", 2, ["T5"], "Stories for F2, F4 and F5, each with two acceptance criteria."),
    ("T7", "MVP scope, five-step user journey and postponed items", "sagynysh", D(9, 24), "done", "medium", "Product", 2, ["T5", "T6"], "MVP confirmed as F1–F5."),
    ("T8", "Assignment 2 presentation with evidence appendix", "talshyn", D(9, 24), "done", "medium", "Docs", 3, ["T7"], "Compiled from T1–T7."),
    ("K5", "One-page comparison of AI API cost per 100 requests", "ayaulym", D(10, 7), "done", "medium", "Learning", 2, [], "Input for the F4 decision D5 (A4)."),
    ("K3", "Table of AI tasks and subtasks for 3 real projects", "ayaulym", D(10, 3), "in_progress", "high", "Learning", 3, ["K5"], "Original target 3 Oct. Not met yet: needed for the F4 50% acceptance rule."),
    ("K2", "Two Figma screens linked to journey steps 2 and 4", "talshyn", D(10, 10), "done", "high", "Design", 2, [], "Task card and task list screens (accepted, EV11)."),
    ("K4", "Rerun the F4 prompt: one valid output in the schema", "marzhan", D(10, 14), "done", "medium", "Learning", 1.5, ["K5"], ""),
    ("K1", "F2/F5 screens linked into journey steps 3 and 5", "aisha", D(10, 16), "done", "high", "Design", 3, ["K2"], "Workload view and deadline warning screens in Figma."),
    ("T16", "Board upkeep, A4 slides and appendix", "talshyn", D(10, 16), "done", "medium", "Docs", 2, [], ""),
    ("K6", "Usability test script with 3 tasks traced to US1–US3 and a pilot run", "talshyn", D(10, 18), "review", "high", "Research", 2, ["K1"], "Script waiting for review by Aisha before T14."),
    ("T13", "Prepare five example F5 warnings from the US3 rules", "marzhan", D(10, 19), "in_progress", "high", "Product", 1.5, [], "Examples for the 2-day, 3-day and passed-deadline cases."),
    ("T11", "Low-fidelity clickable prototype of the five-step journey", "sagynysh", D(10, 20), "in_progress", "highest", "Design", 4, ["K1", "K2"], "Base Figma file with all five journey steps linked."),
    ("K7", "Notes from two test sessions with every criterion", "marzhan", D(10, 22), "todo", "medium", "Research", 2, ["K6"], ""),
    ("T14", "Usability test with 5–6 respondents", "aisha", D(10, 22), "todo", "highest", "Research", 3, ["T11", "K6"], "3 sessions by Aisha, the rest by Talshyn and Marzhan."),
    ("T21", "Charter revisit after the usability test", "aisha", D(10, 23), "todo", "low", "Docs", 0.5, ["T14"], ""),
    ("ACT1", "Confirm Sprint 1 availability of every member", "sagynysh", D(10, 23), "todo", "medium", "Coordination", 0.5, [], "Check that each member keeps 12 h for 26 Oct – 8 Nov."),
    ("T12", "Test F4 on 3 real course projects and decide Must/Should", "ayaulym", D(10, 24), "in_progress", "medium", "Product", 3, ["K3"], "Decision D5: F4 stays in the first release only if at least 50% of AI subtasks are accepted."),
    ("T15", "Synthesis of test notes into an insight matrix", "marzhan", D(10, 24), "todo", "medium", "Research", 2, ["T14"], ""),
    ("T17", "Plan/Fact report for 5–16 Oct (A3 format)", "sagynysh", D(10, 25), "todo", "low", "Docs", 1.5, [], ""),
    ("K8", "Two interview notes coded with IDs and counts", "talshyn", D(10, 30), "todo", "low", "Learning", 1.5, ["T14"], "Deferred from A4."),
    ("K9", "Coding spike: Django model, form and hosted page", "marzhan", D(10, 29), "todo", "highest", "Learning", 2, [], "Gate for T22. If K9 fails, Sprint 1 scope is reduced (A5)."),
    ("T22", "Build the Task model and form with a required owner", "marzhan", D(10, 30), "todo", "highest", "Story", 2.5, ["K9"], "US4: a task with an owner and a deadline is saved; a task without an owner is not saved."),
    ("T23", "Configure deployment settings on the free hosting tier", "ayaulym", D(10, 31), "todo", "high", "Story", 1, ["K9"], "US4."),
    ("T24", "Check both US4 criteria on the hosted URL", "sagynysh", D(11, 2), "todo", "high", "Test", 0.5, ["T22", "T23"], ""),
    ("T25", "Build the workload view template from the K1 screen", "aisha", D(11, 2), "todo", "high", "Story", 3, ["K1"], "US1: every member's name and number of open tasks; above 3 is shown as 'above limit'."),
    ("T26", "Write and test the open-task count query", "marzhan", D(11, 3), "todo", "high", "Story", 1, ["T22"], "US1."),
    ("T27", "Review the workload view against both US1 criteria", "talshyn", D(11, 4), "todo", "medium", "Test", 0.5, ["T25", "T26"], ""),
    ("T28", "Write the rule function and boundary tests (2 days, 3 days, passed)", "ayaulym", D(11, 4), "todo", "high", "Story", 3, ["T22"], "US3."),
    ("T29", "Show warning and 'Delayed' labels in the task list and workload view", "talshyn", D(11, 5), "todo", "medium", "Story", 1.5, ["T28"], "US3. First item to drop if Sprint 1 runs out of time."),
    ("T30", "Review the rules and check both US3 criteria", "sagynysh", D(11, 6), "todo", "medium", "Test", 0.5, ["T28", "T29"], ""),
    ("K10", "Coaching session: code review for non-coding members", "marzhan", D(11, 6), "todo", "low", "Learning", 0.5, [], ""),
    ("T18", "Plan/Fact report for Sprint 1 and the Review on 6 Nov", "sagynysh", D(11, 6), "todo", "medium", "Docs", 1.5, [], ""),
    ("T20", "Board upkeep and deployment check", "talshyn", D(11, 8), "todo", "low", "Coordination", 1.5, [], ""),
    ("ACT3", "Seed the pilot with our real tasks", "sagynysh", D(11, 8), "todo", "low", "Coordination", 1, ["T22"], ""),
    ("T31", "US5: task owner changes the status of their task", "marzhan", D(11, 16), "todo", "medium", "Story", 2, ["T22"], "Sprint 2."),
    ("T32", "US6: open a member's task list from the workload view", "aisha", D(11, 18), "todo", "medium", "Story", 2, ["T25"], "Sprint 2."),
    ("T33", "US7: project timeline with all deadlines (F3)", "talshyn", D(11, 20), "todo", "medium", "Story", 3, ["T22"], "Sprint 2."),
    ("T34", "US8: notify the owner when a task becomes Delayed", "ayaulym", D(11, 22), "todo", "medium", "Story", 2, ["T28"], "Sprint 2."),
]

SUBTASKS = {
    "T11": [("Share the base Figma file", True), ("Link steps 1–3", True), ("Link steps 4–5", False), ("Ask Aisha and Talshyn to check K1 and K2 links", False)],
    "T22": [("Task model with owner FK and deadline", False), ("Form validation: owner is required", False), ("Unit test for both US4 criteria", False)],
}


def aware(d):
    return timezone.make_aware(datetime.combine(d, time(10, 0)))


class Command(BaseCommand):
    help = "Seed the team project and import live Apache Jira projects."

    def add_arguments(self, parser):
        parser.add_argument("--offline", action="store_true", help="Skip the Apache Jira import")
        parser.add_argument("--projects", default="KAFKA,FLINK,SPARK,CASSANDRA")
        parser.add_argument("--max-issues", type=int, default=250)

    def handle(self, *args, **opts):
        members = {}
        for username, name, role, color in TEAM:
            user, created = User.objects.get_or_create(username=username)
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
            m, _ = Member.objects.update_or_create(user=user, defaults={"name": name, "role": role, "color": color})
            members[username] = m
        admin, created = User.objects.get_or_create(username="admin", defaults={"is_staff": True, "is_superuser": True})
        if created:
            admin.set_password(DEMO_PASSWORD)
            admin.save()

        p, _ = Project.objects.update_or_create(
            key="PP",
            defaults={
                "name": "ProjectPulse MVP",
                "description": "Our own course project: an all-in-one PM platform with an AI Project Assistant. "
                "Pilot 1.0 (F1, F2, F5, F3) is built in three two-week Sprints, 26 Oct – 6 Dec 2026.",
                "goal": "Launch Pilot 1.0 on 7 Dec 2026: every task has one owner and a deadline, the workload view "
                "shows who is overloaded, and late tasks are flagged before the deadline.",
                "workload_limit": 3,
                "source": "manual",
                "next_task_number": 35,
            },
        )
        p.members.set(members.values())
        by_key = {}
        for key, title, owner, due, st, prio, typ, hours, deps, desc in TASKS:
            created_on = date(2026, 9, 15) if due.month == 9 else date(2026, 10, 1)
            t, _ = Task.objects.update_or_create(
                project=p,
                key=key,
                defaults=dict(
                    title=title, owner=members[owner], due_date=due, status=st, priority=prio, issue_type=typ,
                    estimate_hours=hours, description=desc, due_source="manual", created_at=aware(created_on),
                    updated_at=aware(min(due, date(2026, 10, 19))), resolved_at=aware(due) if st == "done" else None,
                ),
            )
            by_key[key] = (t, deps)
            if not t.activity.exists():
                Activity.objects.create(task=t, actor="Sagynysh", kind="created", detail=f"Created and assigned to {members[owner].name}")
        for t, deps in by_key.values():
            t.depends_on.set([by_key[d][0] for d in deps])
        for key, items in SUBTASKS.items():
            t = by_key[key][0]
            if not t.subtasks.exists():
                Subtask.objects.bulk_create([Subtask(task=t, title=s, done=done) for s, done in items])
        self.stdout.write(self.style.SUCCESS(f"PP: {len(by_key)} team tasks, {len(members)} members"))

        if opts["offline"]:
            return
        for key in [k.strip() for k in opts["projects"].split(",") if k.strip()]:
            try:
                import_project(key, max_issues=opts["max_issues"], log=lambda msg: self.stdout.write(self.style.SUCCESS(msg)))
            except JiraError as exc:
                self.stdout.write(self.style.WARNING(f"{key}: {exc}"))

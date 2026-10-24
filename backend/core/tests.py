"""Tests for the acceptance criteria in the A6/A7 report (US4, US1, US3, US8) and the AI assistant."""
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from . import ai, rules
from .models import Member, Notification, Project, Task


class Base(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.user = User.objects.create_user("lead", password="secret123")
        self.lead = Member.objects.create(name="Aisha", user=self.user)
        self.m2 = Member.objects.create(name="Marzhan")
        self.p = Project.objects.create(key="PP", name="ProjectPulse MVP", workload_limit=3)
        self.p.members.add(self.lead, self.m2)
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.create(user=self.user).key)

    def task(self, key, owner=None, days=5, status="todo", **kw):
        now = timezone.now()
        return Task.objects.create(
            project=self.p, key=key, title=f"Task {key}", owner=owner or self.m2, status=status,
            due_date=self.today + timedelta(days=days), created_at=now, updated_at=now, **kw
        )


class US4CreateTask(Base):
    def test_task_with_owner_and_deadline_is_saved_and_listed(self):
        r = self.api.post(f"/api/projects/{self.p.id}/tasks", {"title": "Build model", "owner": self.m2.id,
                                                                "due_date": str(self.today + timedelta(days=4))}, format="json")
        self.assertEqual(r.status_code, 201)
        keys = [t["key"] for t in self.api.get(f"/api/projects/{self.p.id}/tasks").json()]
        self.assertIn(r.json()["key"], keys)

    def test_task_without_owner_is_not_saved(self):
        r = self.api.post(f"/api/projects/{self.p.id}/tasks", {"title": "No owner", "due_date": str(self.today)}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("owner", r.json()["errors"])
        self.assertFalse(Task.objects.filter(title="No owner").exists())

    def test_owner_cannot_be_removed_later(self):
        t = self.task("T1")
        r = self.api.patch(f"/api/tasks/{t.id}", {"owner": None}, format="json")
        self.assertEqual(r.status_code, 400)


class US1Workload(Base):
    def test_each_member_and_open_count_and_above_limit(self):
        for i in range(4):
            self.task(f"A{i}", owner=self.m2)
        self.task("D1", owner=self.m2, status="done")
        self.task("B1", owner=self.lead)
        rows = {r["name"]: r for r in self.api.get(f"/api/projects/{self.p.id}/workload").json()["rows"]}
        self.assertEqual(rows["Marzhan"]["open"], 4)
        self.assertTrue(rows["Marzhan"]["above_limit"])
        self.assertEqual(rows["Aisha"]["open"], 1)
        self.assertFalse(rows["Aisha"]["above_limit"])

    def test_exactly_limit_is_not_above(self):
        for i in range(3):
            self.task(f"A{i}")
        rows = rules.workload(list(self.p.tasks.all()), [self.m2], 3)
        self.assertFalse(rows[0]["above_limit"])


class US3DelayWarnings(Base):
    def sig(self, t):
        return rules.task_signal(t, self.today)

    def test_not_started_due_in_two_days_warns_with_reason(self):
        s = self.sig(self.task("T1", days=2))
        self.assertEqual(s["state"], "at_risk")
        self.assertTrue(any("not started" in r for r in s["reasons"]))

    def test_three_days_is_on_track(self):
        self.assertEqual(self.sig(self.task("T1", days=3))["state"], "on_track")

    def test_passed_deadline_not_done_is_delayed(self):
        self.assertEqual(self.sig(self.task("T1", days=-1, status="in_progress"))["label"], "Delayed")

    def test_passed_deadline_done_is_not_delayed(self):
        self.assertEqual(self.sig(self.task("T1", days=-1, status="done"))["state"], "done")

    def test_due_today(self):
        self.assertEqual(self.sig(self.task("T1", days=0))["state"], "due_today")


class US8Notifications(Base):
    def test_owner_notified_once_when_task_becomes_delayed(self):
        self.task("T1", days=-2)
        self.api.get(f"/api/projects/{self.p.id}/dashboard")
        self.api.get(f"/api/projects/{self.p.id}/dashboard")
        self.assertEqual(Notification.objects.filter(member=self.m2, kind="delayed").count(), 1)


class Assistant(Base):
    def test_analyst_answers_who_is_overloaded(self):
        for i in range(5):
            self.task(f"A{i}")
        with mock.patch.object(ai, "claude_available", return_value=False):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Who is overloaded?"}, format="json")
        reply = r.json()["messages"][-1]
        self.assertEqual(reply["engine"], "analyst")
        self.assertIn("Marzhan: 5 open", reply["content"])

    def test_analyst_explains_why_behind(self):
        self.task("T7", days=-3)
        with mock.patch.object(ai, "claude_available", return_value=False):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Почему мы отстаём?"}, format="json")
        self.assertIn("T7", r.json()["messages"][-1]["content"])

    def test_suggestion_reassigns_overloaded_owner(self):
        for i in range(4):
            self.task(f"A{i}", days=10)
        risky = self.task("R1", days=1)
        r = self.api.get(f"/api/tasks/{risky.id}").json()
        self.assertEqual(r["suggestion"]["kind"], "reassign")
        r = self.api.post(f"/api/tasks/{risky.id}/suggestion", {"action": "accept"}, format="json").json()
        self.assertEqual(r["owner"]["name"], "Aisha")

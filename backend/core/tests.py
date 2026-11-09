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
        self.lead = Member.objects.create(name="Aisha", user=self.user, is_lead=True)
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


class GeminiAssistant(Base):
    def test_gemini_chosen_when_key_present(self):
        self.task("G1")
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", return_value="Gemini answer about the project"):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Status?"}, format="json")
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data["engine"], "gemini")
            reply = data["messages"][-1]
            self.assertEqual(reply["engine"], "gemini")
            self.assertEqual(reply["content"], "Gemini answer about the project")

    def test_gemini_fallback_to_claude_on_exception(self):
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", side_effect=RuntimeError("429 Resource has been exhausted")), \
             mock.patch.object(ai, "claude_available", return_value=True), \
             mock.patch.object(ai, "ask_claude", return_value="Claude fallback response"):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Any blockers?"}, format="json")
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data["engine"], "claude")
            reply = data["messages"][-1]
            self.assertEqual(reply["engine"], "claude")
            self.assertEqual(reply["content"], "Claude fallback response")

    def test_gemini_fallback_to_analyst_on_exception(self):
        self.task("T10", days=-2)
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", side_effect=Exception("Connection timeout")), \
             mock.patch.object(ai, "claude_available", return_value=False):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Почему мы отстаём?"}, format="json")
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data["engine"], "analyst")
            reply = data["messages"][-1]
            self.assertEqual(reply["engine"], "analyst")
            self.assertIn("T10", reply["content"])

    def test_suggest_subtasks_gemini_json_with_fences(self):
        t = self.task("S1", issue_type="story")
        gemini_response = (
            "```json\n"
            "{\n"
            '  "subtasks": [\n'
            '    "Create user model and migration",\n'
            '    "Write registration API view",\n'
            '    "Add email validation tests"\n'
            "  ]\n"
            "}\n"
            "```"
        )
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", return_value=gemini_response):
            r = self.api.post(f"/api/tasks/{t.id}/suggest-subtasks", format="json")
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data["engine"], "gemini")
            self.assertEqual(data["subtasks"], [
                "Create user model and migration",
                "Write registration API view",
                "Add email validation tests",
            ])

    def test_suggest_subtasks_fallback_on_gemini_error(self):
        t = self.task("B1", issue_type="bug")
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", side_effect=Exception("Gemini quota exceeded")), \
             mock.patch.object(ai, "claude_available", return_value=False):
            items, engine = ai.suggest_subtasks(t)
            self.assertEqual(engine, "analyst")
            self.assertIn("Fix the root cause", items)

    def test_suggest_subtasks_fallback_on_malformed_json(self):
        t = self.task("B2", issue_type="bug")
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", return_value="Here are the tasks: 1. test, 2. fix"), \
             mock.patch.object(ai, "claude_available", return_value=False):
            items, engine = ai.suggest_subtasks(t)
            self.assertEqual(engine, "analyst")
            self.assertIn("Fix the root cause", items)

    def test_gemini_empty_response_falls_back(self):
        self.task("T11")
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", return_value=None), \
             mock.patch.object(ai, "claude_available", return_value=False):
            r = self.api.post(f"/api/projects/{self.p.id}/chat", {"message": "Who is overloaded?"}, format="json")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["engine"], "analyst")

    def test_suggest_subtasks_empty_response_falls_back(self):
        t = self.task("B3", issue_type="bug")
        with mock.patch.object(ai, "gemini_available", return_value=True), \
             mock.patch.object(ai, "ask_gemini", return_value=""), \
             mock.patch.object(ai, "claude_available", return_value=False):
            items, engine = ai.suggest_subtasks(t)
            self.assertEqual(engine, "analyst")
            self.assertIn("Fix the root cause", items)


class FigmaAuthAndAccount(Base):
    """Sign in / Create account / Personal settings screens from the Figma file."""

    def setUp(self):
        super().setUp()
        self.anon = APIClient()

    def test_register_with_email_and_role_starts_with_no_projects(self):
        r = self.anon.post("/api/auth/register", {"name": "Talshyn Rakhatkyzy", "email": "Talshyn@Example.com",
                                                  "password": "secret123", "role": "Team lead"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.json()["user"]["is_lead"])
        u = User.objects.get(email="talshyn@example.com")
        self.assertEqual(u.member.role, "Team lead")
        self.assertFalse(self.p.members.filter(pk=u.member.pk).exists())
        new = APIClient()
        new.credentials(HTTP_AUTHORIZATION="Token " + r.json()["token"])
        self.assertEqual(new.get("/api/projects").json(), [])
        self.assertEqual(new.get(f"/api/projects/{self.p.id}").status_code, 404)

    def test_register_password_needs_8_chars_and_a_number(self):
        for pw in ("short1", "longpassword"):
            r = self.anon.post("/api/auth/register", {"name": "X", "email": "x@ex.com", "password": pw}, format="json")
            self.assertEqual(r.status_code, 400)
            self.assertIn("password", r.json()["errors"])

    def test_register_duplicate_email_is_refused(self):
        self.user.email = "lead@ex.com"
        self.user.save()
        r = self.anon.post("/api/auth/register", {"name": "X", "email": "LEAD@ex.com", "password": "secret123"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_login_with_email_or_username(self):
        self.user.email = "lead@ex.com"
        self.user.save()
        for ident in ("lead@ex.com", "LEAD@EX.COM", "lead"):
            r = self.anon.post("/api/auth/login", {"email": ident, "password": "secret123"}, format="json")
            self.assertEqual(r.status_code, 200, ident)
        r = self.anon.post("/api/auth/login", {"email": "lead@ex.com", "password": "wrong"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_personal_settings_update_profile(self):
        r = self.api.patch("/api/auth/me", {"name": "Aisha A.", "email": "a@ex.com", "role": "Product Owner"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.lead.refresh_from_db()
        self.assertEqual((self.lead.name, self.lead.role), ("Aisha A.", "Product Owner"))
        self.assertEqual(r.json()["email"], "a@ex.com")

    def test_password_change_returns_new_token(self):
        r = self.api.patch("/api/auth/me", {"password": "newpass99"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("token", r.json())
        r = self.anon.post("/api/auth/login", {"username": "lead", "password": "newpass99"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_personal_settings_rejects_bad_values(self):
        User.objects.create_user("other", email="taken@ex.com", password="x")
        for body in ({"email": "taken@ex.com"}, {"name": " "}, {"password": "abc"}):
            self.assertEqual(self.api.patch("/api/auth/me", body, format="json").status_code, 400, body)


class InputValidation(Base):
    """Bad input gives a 400 with a message, never a server error."""

    def test_owner_must_be_a_project_member(self):
        outsider = Member.objects.create(name="Outsider")
        for owner in ("abc", outsider.id, 999999):
            r = self.api.post(f"/api/projects/{self.p.id}/tasks", {"title": "X", "owner": owner,
                                                                    "due_date": str(self.today)}, format="json")
            self.assertEqual(r.status_code, 400, owner)

    def test_bad_estimate_is_refused(self):
        r = self.api.post(f"/api/projects/{self.p.id}/tasks", {"title": "X", "owner": self.m2.id, "due_date": str(self.today),
                                                                "estimate_hours": "abc"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_patch_rejects_unknown_priority_status_and_empty_title(self):
        t = self.task("T1")
        for body in ({"priority": "zzz"}, {"status": "zzz"}, {"title": "  "}):
            self.assertEqual(self.api.patch(f"/api/tasks/{t.id}", body, format="json").status_code, 400, body)
        t.refresh_from_db()
        self.assertEqual(t.priority, "medium")

    def test_project_workload_limit_must_be_1_to_50(self):
        for v in ("abc", 0, 99):
            self.assertEqual(self.api.patch(f"/api/projects/{self.p.id}", {"workload_limit": v}, format="json").status_code, 400)
        r = self.api.patch(f"/api/projects/{self.p.id}", {"workload_limit": "4"}, format="json")
        self.assertEqual(r.json()["workload_limit"], 4)


class Roles(Base):
    """Only the team lead creates tasks and projects and deletes projects; new accounts see nothing."""

    def setUp(self):
        super().setUp()
        self.mu = User.objects.create_user("member", password="secret123")
        self.mm = Member.objects.create(name="Talshyn", user=self.mu, role="Team member")
        self.p.members.add(self.mm)
        self.member_api = APIClient()
        self.member_api.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.create(user=self.mu).key)

    def test_member_cannot_create_task(self):
        r = self.member_api.post(f"/api/projects/{self.p.id}/tasks", {"title": "X", "owner": self.mm.id,
                                                                       "due_date": str(self.today)}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Task.objects.filter(title="X").exists())

    def test_member_cannot_delete_project_or_task_but_lead_can(self):
        t = self.task("T1")
        self.assertEqual(self.member_api.delete(f"/api/tasks/{t.id}").status_code, 403)
        self.assertEqual(self.member_api.delete(f"/api/projects/{self.p.id}").status_code, 403)
        self.assertTrue(Project.objects.filter(pk=self.p.id).exists())
        self.assertEqual(self.api.delete(f"/api/projects/{self.p.id}").status_code, 204)

    def test_member_can_still_update_their_task_status(self):
        t = self.task("T1", owner=self.mm)
        r = self.member_api.patch(f"/api/tasks/{t.id}", {"status": "in_progress"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_member_cannot_create_project(self):
        r = self.member_api.post("/api/projects", {"key": "WEB", "name": "Web"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_lead_creates_project_and_adds_member_by_email(self):
        r = self.api.post("/api/projects", {"key": "WEB", "name": "Web"}, format="json")
        self.assertEqual(r.status_code, 201)
        pid = r.json()["id"]
        self.assertEqual(self.member_api.get(f"/api/projects/{pid}").status_code, 404)
        self.mu.email = "member@ex.com"
        self.mu.save()
        r = self.api.post(f"/api/projects/{pid}/members", {"email": "member@ex.com"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.member_api.get(f"/api/projects/{pid}").status_code, 200)
        self.assertEqual(self.member_api.post(f"/api/projects/{pid}/members", {"email": "lead"}, format="json").status_code, 403)

    def test_projects_list_only_shows_visible_projects(self):
        hidden = Project.objects.create(key="HID", name="Hidden")
        keys = [p["key"] for p in self.member_api.get("/api/projects").json()]
        self.assertIn("PP", keys)
        self.assertNotIn("HID", keys)
        t = Task.objects.create(project=hidden, key="H1", title="h", owner=self.m2, due_date=self.today,
                                created_at=timezone.now(), updated_at=timezone.now())
        self.assertEqual(self.member_api.get(f"/api/tasks/{t.id}").status_code, 404)

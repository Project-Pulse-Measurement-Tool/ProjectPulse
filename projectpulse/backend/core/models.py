from django.conf import settings
from django.db import models


class Member(models.Model):
    """A person who can own tasks. Imported Jira assignees are Members without a login."""

    name = models.CharField(max_length=120)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="member"
    )
    role = models.CharField(max_length=60, blank=True)
    jira_name = models.CharField(max_length=120, blank=True, db_index=True)
    color = models.CharField(max_length=9, default="#6D86B1")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def initials(self):
        parts = [p for p in self.name.replace("-", " ").split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or "?"


class Project(models.Model):
    SOURCE_CHOICES = [("manual", "Created in ProjectPulse"), ("apache_jira", "Apache Jira (live import)")]

    key = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    goal = models.TextField(blank=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="manual")
    source_url = models.URLField(blank=True)
    workload_limit = models.PositiveSmallIntegerField(default=3)
    members = models.ManyToManyField(Member, related_name="projects", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_synced = models.DateTimeField(null=True, blank=True)
    next_task_number = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.name


class Task(models.Model):
    STATUS_CHOICES = [("todo", "To do"), ("in_progress", "In progress"), ("review", "Review"), ("done", "Done")]
    PRIORITY_CHOICES = [
        ("highest", "Highest"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("lowest", "Lowest"),
    ]
    DUE_SOURCE_CHOICES = [
        ("manual", "Set by the team"),
        ("jira_due", "Jira due date"),
        ("release", "Fix-version release date"),
        ("estimated", "Estimated from priority"),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    key = models.CharField(max_length=32, db_index=True)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="todo", db_index=True)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    issue_type = models.CharField(max_length=40, default="Task")
    # US4: every task has exactly one owner and a deadline.
    owner = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="tasks")
    due_date = models.DateField()
    due_source = models.CharField(max_length=12, choices=DUE_SOURCE_CHOICES, default="manual")
    estimate_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    depends_on = models.ManyToManyField("self", symmetrical=False, related_name="blocks", blank=True)
    fix_version = models.CharField(max_length=60, blank=True)
    components = models.CharField(max_length=200, blank=True)
    external_url = models.URLField(blank=True)
    jira_status = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["due_date", "id"]
        unique_together = [("project", "key")]

    def __str__(self):
        return f"{self.key} {self.title}"


class Subtask(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="subtasks")
    title = models.CharField(max_length=300)
    done = models.BooleanField(default=False)
    ai_generated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class Comment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    author = models.CharField(max_length=120)
    body = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["created_at"]


class Activity(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="activity")
    actor = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=30)  # created, status, owner, due, suggestion
    detail = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class Notification(models.Model):
    """US8: owners are notified when their task becomes Delayed (and when it is assigned to them)."""

    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="notifications")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=20)  # delayed, at_risk, assigned
    message = models.CharField(max_length=300)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("member", "task", "kind")]


class ChatMessage(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="chat")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat")
    role = models.CharField(max_length=10)  # user / assistant
    content = models.TextField()
    engine = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

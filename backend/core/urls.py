from django.urls import path

from . import views

urlpatterns = [
    path("auth/register", views.register),
    path("auth/login", views.login),
    path("auth/logout", views.logout),
    path("auth/me", views.me),
    path("ai/status", views.ai_status),
    path("members", views.all_members),
    path("notifications", views.notifications),
    path("jira/catalog", views.jira_catalog),
    path("jira/import", views.jira_import),
    path("projects", views.projects),
    path("projects/<int:pk>", views.project_detail),
    path("projects/<int:pk>/sync", views.project_sync),
    path("projects/<int:pk>/dashboard", views.dashboard),
    path("projects/<int:pk>/brief", views.brief),
    path("projects/<int:pk>/tasks", views.project_tasks),
    path("projects/<int:pk>/workload", views.workload_view),
    path("projects/<int:pk>/timeline", views.timeline),
    path("projects/<int:pk>/analytics", views.analytics),
    path("projects/<int:pk>/chat", views.chat),
    path("tasks/<int:pk>", views.task_detail),
    path("tasks/<int:pk>/suggestion", views.task_suggestion),
    path("tasks/<int:pk>/comments", views.task_comments),
    path("tasks/<int:pk>/subtasks", views.task_subtasks),
    path("tasks/<int:pk>/suggest-subtasks", views.suggest_subtasks),
    path("subtasks/<int:pk>", views.subtask_detail),
]

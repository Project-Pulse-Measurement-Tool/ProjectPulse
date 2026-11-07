from django.contrib import admin

from .models import Member, Project


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    """Tick "is lead" here to make an account a team lead."""
    list_display = ("name", "role", "is_lead", "user")
    list_editable = ("is_lead",)
    list_filter = ("is_lead",)
    search_fields = ("name", "user__username", "user__email")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("key", "name", "source", "workload_limit")
    filter_horizontal = ("members", "viewers")

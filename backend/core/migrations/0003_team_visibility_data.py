from django.db import migrations

TEAM = ["aisha", "talshyn", "marzhan", "ayaulym", "sagynysh", "admin"]
LEADS = ["sagynysh"]


def forwards(apps, schema_editor):
    """Our team accounts keep seeing every existing project; new accounts start empty. Middle dots become hyphens."""
    User = apps.get_model("auth", "User")
    Member = apps.get_model("core", "Member")
    Project = apps.get_model("core", "Project")
    team = set(User.objects.filter(username__in=TEAM).values_list("id", flat=True))
    team |= set(User.objects.filter(is_staff=True).values_list("id", flat=True))
    for p in Project.objects.all():
        ids = set(team) | set(p.members.exclude(user=None).values_list("user_id", flat=True))
        if ids:
            p.viewers.add(*ids)
    Member.objects.filter(user__username__in=LEADS).update(is_lead=True)
    Member.objects.filter(role__iexact="team lead").update(is_lead=True)
    for m in Member.objects.filter(role__contains="\u00b7"):
        m.role = m.role.replace(" \u00b7 ", " - ").replace("\u00b7", "-")
        m.save(update_fields=["role"])


class Migration(migrations.Migration):

    dependencies = [("core", "0002_roles_and_visibility")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

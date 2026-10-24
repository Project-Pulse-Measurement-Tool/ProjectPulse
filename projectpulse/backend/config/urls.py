from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, HttpResponse
from django.urls import include, path, re_path

INDEX = settings.BASE_DIR.parent / "frontend" / "dist" / "index.html"


def spa(request, *args, **kwargs):
    """Serve the built React app for every non-API route."""
    if INDEX.exists():
        return FileResponse(open(INDEX, "rb"), content_type="text/html")
    return HttpResponse("Frontend is not built yet. Run: cd frontend && npm run build", status=503)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    re_path(r"^(?!api/|admin/|static/).*$", spa),
]

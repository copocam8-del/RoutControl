from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView

api_v1 = [
    path("auth/", include("apps.accounts.urls")),
    path("workdays/", include("apps.workdays.urls")),
    path("drivers/", include("apps.drivers.urls")),
    path("tracking/", include("apps.tracking.urls")),
    path("packages/", include("apps.packages.urls")),
    path("imports/", include("apps.packages.import_urls")),
    path("", include("apps.packages.delivery_urls")),
    path("", include("apps.alerts.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
]

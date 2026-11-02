from django.urls import path

from . import views
from .delivery_views import PackageVisitsView

urlpatterns = [
    path("", views.PackageListView.as_view(), name="package-list"),
    path("assign", views.PackageBulkAssignView.as_view(), name="package-bulk-assign"),
    path("<uuid:package_id>", views.PackageDetailView.as_view(), name="package-detail"),
    path("<uuid:package_id>/assign", views.PackageAssignView.as_view(), name="package-assign"),
    path("<uuid:package_id>/status", views.PackageStatusView.as_view(), name="package-status"),
    path("<uuid:package_id>/events", views.PackageEventsView.as_view(), name="package-events"),
    path("<uuid:package_id>/visits", PackageVisitsView.as_view(), name="package-visits"),
]

from django.urls import path

from . import delivery_views as views
from . import panel_views
from . import views as package_views

urlpatterns = [
    path("visits", views.VisitCreateView.as_view(), name="visit-create"),
    path("evidence", views.EvidenceCreateView.as_view(), name="evidence-create"),
    path("evidence/<uuid:evidence_id>/file", views.EvidenceFileView.as_view(), name="evidence-file"),
    path("communications", views.CommunicationCreateView.as_view(), name="communication-create"),
    path("route", views.RouteView.as_view(), name="route"),
    path("deliveries", panel_views.DeliveryListView.as_view(), name="delivery-list"),
    path("incidents", panel_views.IncidentListView.as_view(), name="incident-list"),
    path("incidents/<uuid:incident_id>/resolve", panel_views.IncidentResolveView.as_view(), name="incident-resolve"),
    path("addresses/<uuid:address_id>", panel_views.AddressDetailView.as_view(), name="address-detail"),
    path("second-attempts", package_views.SecondAttemptListView.as_view(), name="second-attempt-list"),
    path("second-attempts/<uuid:request_id>/decide", package_views.SecondAttemptDecideView.as_view(), name="second-attempt-decide"),
    path("route/optimize", views.RouteOptimizeView.as_view(), name="route-optimize"),
]

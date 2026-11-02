from django.urls import path

from . import delivery_views as views

urlpatterns = [
    path("visits", views.VisitCreateView.as_view(), name="visit-create"),
    path("evidence", views.EvidenceCreateView.as_view(), name="evidence-create"),
    path("evidence/<uuid:evidence_id>/file", views.EvidenceFileView.as_view(), name="evidence-file"),
    path("communications", views.CommunicationCreateView.as_view(), name="communication-create"),
]

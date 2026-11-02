from django.urls import path

from . import import_views as views

urlpatterns = [
    path("", views.ImportCreateView.as_view(), name="import-create"),
    path("<uuid:import_id>", views.ImportDetailView.as_view(), name="import-detail"),
    path("<uuid:import_id>/preview", views.ImportPreviewView.as_view(), name="import-preview"),
    path("<uuid:import_id>/confirm", views.ImportConfirmView.as_view(), name="import-confirm"),
]

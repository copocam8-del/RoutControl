from django.urls import path

from . import views

urlpatterns = [
    path("notifications", views.NotificationListView.as_view(), name="notification-list"),
    path("notifications/seen", views.NotificationSeenView.as_view(), name="notification-seen"),
    path("settings", views.OrganizationSettingsView.as_view(), name="organization-settings"),
]

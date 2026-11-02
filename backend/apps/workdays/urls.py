from django.urls import path

from . import views

urlpatterns = [
    path("", views.WorkdayListView.as_view(), name="workday-list"),
    path("start", views.StartWorkdayView.as_view(), name="workday-start"),
    path("current", views.CurrentWorkdayView.as_view(), name="workday-current"),
    path("<uuid:workday_id>/end", views.EndWorkdayView.as_view(), name="workday-end"),
    path("<uuid:workday_id>/track", views.WorkdayTrackView.as_view(), name="workday-track"),
]

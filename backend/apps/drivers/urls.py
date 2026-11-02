from django.urls import path

from .views import DriverListView

urlpatterns = [
    path("", DriverListView.as_view(), name="driver-list"),
]

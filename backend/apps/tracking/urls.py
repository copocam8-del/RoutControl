from django.urls import path

from .views import TrackingBatchView

urlpatterns = [
    path("batch", TrackingBatchView.as_view(), name="tracking-batch"),
]

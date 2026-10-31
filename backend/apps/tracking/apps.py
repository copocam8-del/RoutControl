from django.apps import AppConfig


class TrackingConfig(AppConfig):
    name = "apps.tracking"
    label = "tracking"

    def ready(self):
        from . import signals  # noqa: F401

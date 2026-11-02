from celery import shared_task

from .services import check_no_signal


@shared_task(name="alerts.check_no_signal")
def check_no_signal_task() -> int:
    return check_no_signal()

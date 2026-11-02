from celery import shared_task

from .autoclose import close_forgotten_workdays


@shared_task(name="workdays.close_forgotten_workdays")
def close_forgotten_workdays_task() -> int:
    return len(close_forgotten_workdays())

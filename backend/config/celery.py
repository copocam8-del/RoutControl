"""Celery (tareas periódicas). Ver docs/adr/ADR-010-seguridad-etapa-1.md.

Corre como el rol de la aplicación (rc_app), igual que la API: las tareas que recorren varias
empresas usan funciones SECURITY DEFINER acotadas para encontrar qué hacer y después trabajan
dentro del contexto de cada empresa, con RLS.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("routcontrol")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

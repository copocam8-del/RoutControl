"""Indicador de recepción del domicilio (planificación §7.3, ADR-022).

- Solo cuentan los éxitos (entregado) y las fallas atribuibles al destinatario (ausente, nadie
  responde, pidió reprogramar). Las fallas de logística (dirección incorrecta, acceso imposible)
  no dicen nada de si el domicilio "suele recibir", así que no cuentan.
- "Cliente solicita reprogramación" pesa la mitad que una ausencia (§7.2: "peso menor").
- Peso por antigüedad: 0,5 ^ (días / 30): una visita de hace un mes vale la mitad que una de hoy.
- Gris con menos de 3 visitas computables; verde ≥ 80 %; amarillo 40–80 %; rojo < 40 %.
  Los umbrales se configuran por empresa (organization.settings["reception"]).
- Es informativo: nunca descarta ni bloquea una entrega.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from django.utils import timezone

from .models import Visit

O = Visit.Outcome
A = Visit.Attribution

DEFAULTS = {"green": 0.8, "yellow": 0.4, "min_visits": 3, "half_life_days": 30, "reschedule_weight": 0.5}


def config(organization) -> dict:
    custom = (organization.settings or {}).get("reception", {}) if organization is not None else {}
    cfg = {**DEFAULTS, **{k: v for k, v in custom.items() if k in DEFAULTS}}
    # Coherencia: el umbral verde no puede quedar por debajo del amarillo.
    cfg["green"] = max(float(cfg["green"]), float(cfg["yellow"]))
    return cfg


def compute(rows, now: datetime | None = None, cfg: dict | None = None) -> dict:
    """rows: (outcome, attribution, started_at) de las visitas no anuladas del domicilio."""
    cfg = cfg or DEFAULTS
    now = now or timezone.now()
    weight_sum = success_sum = 0.0
    computable = delivered = recipient_failures = 0
    last = None
    for outcome, attribution, started_at in rows:
        last = started_at if last is None or started_at > last else last
        if outcome == O.DELIVERED:
            success = True
        elif attribution == A.RECIPIENT:
            success = False
        else:
            continue  # logística, sin resultado o sin atribución: no dice nada del domicilio
        days = max(0.0, (now - started_at).total_seconds() / 86400)
        w = 0.5 ** (days / float(cfg["half_life_days"]))
        if outcome == O.RESCHEDULE_REQUESTED:
            w *= float(cfg["reschedule_weight"])
        weight_sum += w
        if success:
            success_sum += w
            delivered += 1
        else:
            recipient_failures += 1
        computable += 1
    score = success_sum / weight_sum if weight_sum else None
    if computable < int(cfg["min_visits"]) or score is None:
        level = "gray"
    elif score >= float(cfg["green"]):
        level = "green"
    elif score >= float(cfg["yellow"]):
        level = "yellow"
    else:
        level = "red"
    return {
        "level": level,
        "score": round(score, 3) if score is not None else None,
        "computable": computable,
        "delivered": delivered,
        "recipient_failures": recipient_failures,
        "last_visit_at": last,
    }


def for_addresses(address_ids, organization, now: datetime | None = None) -> dict:
    """Indicador de varios domicilios con una sola consulta (listas de paquetes)."""
    ids = {a for a in address_ids if a}
    if not ids:
        return {}
    rows = defaultdict(list)
    for address_id, outcome, attribution, started_at in Visit.objects.filter(address_id__in=ids, voided=False).values_list(
        "address_id", "outcome", "outcome_attribution", "started_at"
    ):
        rows[address_id].append((outcome, attribution, started_at))
    cfg = config(organization)
    return {a: compute(rows.get(a, []), now, cfg) for a in ids}


def summary(stats: dict) -> dict:
    """Lo que va en cada paquete (app y panel)."""
    return {"level": stats["level"], "score": stats["score"], "computable": stats["computable"]}

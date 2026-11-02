from .models import AuditLog


def client_ip(request) -> str | None:
    # Detrás del proxy de producción se toma el primer X-Forwarded-For; en desarrollo, REMOTE_ADDR.
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() or request.META.get("REMOTE_ADDR")) or None


def record(request, action: str, object_type: str, object_id, **metadata) -> AuditLog:
    """Dentro del contexto de la empresa (la request ya lo tiene): la fila queda en esa empresa."""
    return AuditLog.objects.create(
        actor_id=request.user.id,
        action=action,
        object_type=object_type,
        object_id=object_id,
        ip=client_ip(request),
        user_agent=request.headers.get("User-Agent", "")[:200],
        metadata=metadata,
    )

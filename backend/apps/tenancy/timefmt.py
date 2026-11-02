from datetime import UTC, datetime


def iso_utc(value: datetime | None) -> str | None:
    """Formato único de fechas en la API: ISO 8601 en UTC con "Z".

    Sin esto, el mismo instante salía como -03:00 (recién recibido) o como +00:00 (leído de la base).
    """
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

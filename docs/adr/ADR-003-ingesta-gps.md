# ADR-003 — Ingesta de lotes GPS (`POST /api/v1/tracking/batch`)

- **Estado:** aprobado el 31/10/2026, con las condiciones de la sección "Ventana y período de gracia" (todas implementadas y con pruebas en `tests/tracking/test_token_lifecycle.py`). La elección del plugin nativo queda para la fase 2.
- **Contexto:** §5.4 y §7.2 (LocationPoint, TrackingToken, TrackingGap) de la planificación.

## Decisión

- **Autenticación:** `Authorization: Tracking <token>`. Al iniciar la jornada se emite un token aleatorio. Se guarda solo su SHA-256 y sirve únicamente para este endpoint, para esa jornada, esa empresa y ese dispositivo. La empresa, la jornada y el dispositivo salen del token; los campos del cuerpo con esos datos se ignoran. El token se resuelve con `rc_resolve_tracking_token` (ver ADR-001).
- **Idempotencia:** `INSERT … ON CONFLICT (organization_id, point_id) DO NOTHING RETURNING point_id`. Los insertados van a `accepted` y los que ya existían a `duplicates`, incluso si se repiten dentro del mismo lote. El mismo `point_id` en dos empresas no se considera un duplicado.
- **Dos horas:** `recorded_at` (la del teléfono) y `received_at` (la del servidor). Si el lote trae `sent_at`, se guarda `Device.clock_offset_ms`, el desfase del reloj del teléfono.
- **Huecos:** con cada lote se recalculan todos los huecos de la jornada (inicio, puntos y fin, si ya terminó). Hay hueco cuando pasa más de `gap_threshold_seconds` sin puntos (por defecto 300 s; se puede configurar por empresa). Recalcular todo permite que un lote que llega tarde borre el hueco que rellena.

## Ventana y período de gracia (condiciones de aprobación)

1. **Ventana estricta:** solo se aceptan puntos con `started_at ≤ recorded_at ≤ ended_at`. Los dos extremos están incluidos y las dos horas son del teléfono, así que el desfase del reloj no afecta. No hay tolerancia antes del inicio. Mientras la jornada está activa, el límite superior es la hora del servidor más 10 minutos.
2. **Período de gracia configurable:** al finalizar la jornada, el token sigue aceptando, durante un tiempo, puntos grabados **dentro de la ventana**. Sirve para subir los que quedaron offline; sin esto se perderían, en contra del criterio "puntos perdidos: 0". La duración se toma, en este orden:
   - `Organization.settings["tracking_token_grace_hours"]` (por empresa);
   - la variable de entorno `TRACKING_TOKEN_GRACE_AFTER_END_HOURS`;
   - 72 h por defecto.
3. **Revocación por desactivación:** desactivar el dispositivo (`Device.status = DISABLED`), el perfil de repartidor o la membresía revoca los tokens abiertos, con `revoked_at` y `revoked_reason`. Además, `rc_resolve_tracking_token` exige que la empresa, el dispositivo, el perfil, la membresía y el usuario estén activos. Así el token deja de servir aunque el cambio se haya hecho con un `UPDATE` masivo que no dispara las señales, o aunque lo desactivado sea el usuario de plataforma. Un dispositivo desactivado tampoco puede iniciar una jornada nueva (`403 device_disabled`).
4. **Motivos claros:** cada rechazo es `{id, reason, detail}`. `reason` es un código estable para la app y `detail` es un texto en español para soporte y para el panel. Un punto rechazado no se va a aceptar nunca, así que el teléfono lo puede descartar.

| `reason` | Cuándo |
|---|---|
| `before_workday_start` | `recorded_at` < inicio de la jornada |
| `after_workday_end` | `recorded_at` > fin de la jornada |
| `recorded_in_future` | Jornada activa y `recorded_at` más de 10 min por delante del servidor (reloj del teléfono adelantado) |
| `invalid:<campo>` | Campo faltante o fuera de rango (lat, lng, precisión, batería, fecha sin zona horaria…). `detail` dice cuál y por qué |

## Límites de la etapa 0

- Máximo 500 puntos por lote.
- La ingesta es síncrona. Pasarla a Celery queda para cuando haya volumen.
- No hay particionado (lo pide §7.2).
- El cierre automático por duración máxima solo deja de aceptar puntos, porque el token vence a las 14 h. Marcar la jornada como `AUTO_CLOSED` requiere una tarea periódica (Celery, etapa 1).

# ADR-010: Seguridad pendiente de la etapa 0

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** cuatro puntos que quedaron en `docs/pendientes-etapa-1.md` al cerrar la etapa 0.

## 1. RLS en `accounts_user`
- **Problema:** antes, el rol de la aplicación (`rc_app`) podía leer el email y el hash de contraseña de todos los usuarios.
- **Política (`sql/rls/functions.sql`):** `rc_app` ve y modifica solo:
  - al usuario del contexto, `app.current_user` (`rc_current_user()`), que lo fija `user_context()`;
  - a los **miembros de la empresa del contexto**, `app.current_org`.
- **Altas y bajas:** puede **dar de alta** usuarios (invitaciones, seed), pero **no puede borrar**.
- **Login:** el email se busca con `rc_auth_lookup(email)`, `SECURITY DEFINER`.
  - Recibe un solo email y devuelve una fila con `id`, el hash de la contraseña y `status`. No sirve para listar: compara por igualdad, sin patrones.
  - La contraseña se verifica en Python (Argon2). Después, el usuario se lee "como él mismo" (`user_context`).
  - `last_login` se actualiza dentro del contexto de la empresa elegida.
- **Cambio de comportamiento:** un JWT con una empresa donde el usuario ya no tiene membresía activa (o el usuario está desactivado) ahora responde **401** en vez de 403.
  - El motivo: sin contexto, el usuario ni siquiera es visible, así que el token no autentica.
  - La PWA y el panel tratan el 401 intentando renovar la sesión; como la renovación también falla, vuelven al login.
- **Pruebas** (`tests/accounts/test_user_rls.py`), con SQL directo como `rc_app`:
  - sin contexto no se ve ningún usuario;
  - cada empresa ve solo a sus miembros;
  - no se pueden modificar usuarios de otra empresa ni borrar ninguno;
  - `rc_app` no puede desactivar el RLS;
  - la función de login devuelve solo esas tres columnas.

## 2. Cierre automático de jornadas olvidadas (Celery)
- **Celery** (`config/celery.py`), con Redis como broker.
  - Beat corre `workdays.close_forgotten_workdays` cada 15 minutos.
  - En desarrollo el worker no arranca por defecto, para cuidar la memoria: `docker compose --profile workers up worker`.
- **Cómo encuentra las jornadas:** `rc_stale_workdays(max_horas)`, `SECURITY DEFINER`, devuelve solo `(organization_id, workday_id)` de las jornadas `ACTIVE` que pasaron la duración máxima de su empresa (`settings.max_workday_hours`, 14 h por defecto). El cierre se hace **dentro del contexto de cada empresa**, con RLS.
- **Cómo queda la jornada:**
  - `AUTO_CLOSED`, con motivo `max_duration`;
  - **`ended_at` = inicio + duración máxima**, no "ahora". Así se aceptan, durante la gracia del token, los puntos grabados dentro de la jornada que todavía estén en el teléfono;
  - los puntos posteriores se rechazan (`after_workday_end`).

## 3. Recuperar puntos trabados (token nuevo dentro de la gracia)
- **Endpoint:** `POST /api/v1/workdays/{id}/tracking-token`, con el JWT del repartidor. Emite un token nuevo para **esa** jornada y revoca el anterior.
- **Solo procede si:**
  - la jornada es del repartidor que lo pide (si no, 404);
  - el dispositivo está activo (si no, 403 `device_disabled`);
  - la jornada está activa o cerró hace menos de la gracia (`tracking_token_grace_hours`, 72 h). Si no, 409 `grace_expired`.
- **Qué no cambia:**
  - el token nuevo de una jornada cerrada vence cuando vence la gracia;
  - la ventana de puntos (inicio ≤ hora del punto ≤ fin) sigue igual.
- **PWA (`BatchSender`):** ante un 401 del lote pide el token nuevo y reintenta en la misma pasada.
  - Una jornada que quedó marcada en una sesión anterior también se recupera.
  - Si el servidor lo niega (403, 404 o 409), marca `recovery_failed`, conserva los puntos, muestra "Hay ubicaciones que no se van a poder enviar…" y no insiste.

## 4. Auditoría de accesos a recorridos
- **Qué se registra:** `AuditLog` (app `audit`, `TenantModel` con RLS) registra cada `GET /workdays/{id}/track` que responde 200, también cuando el repartidor mira su propio recorrido. Guarda quién (`actor`), qué (`view_track`, la jornada y su repartidor), cuándo, la IP y el user-agent.
- **Solo se agrega:** después de cada `migrate` se le quitan a `rc_app` `UPDATE`, `DELETE` y `TRUNCATE` sobre la tabla.
- **Un acceso denegado (404) no se registra como visto.**
- **Pendiente:** la pantalla para consultar la auditoría en el panel (quedó en `pendientes-etapa-1.md`).

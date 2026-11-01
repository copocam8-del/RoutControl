# Pendientes para la etapa 1

Lo que se decidió dejar para la etapa 1 durante la etapa 0. Cada punto remite al ADR donde está el detalle.

## Seguridad y multitenancy

- **RLS en `accounts_user`** (ADR-001). Hoy el rol de la aplicación puede leer los emails y los hashes de contraseña de todos los usuarios. La propuesta tiene dos partes:
  - una función `SECURITY DEFINER` para el login por email;
  - RLS que deje ver solo al propio usuario (`app.current_user`) y a los miembros de la empresa del contexto.
- **Acceso de soporte entre empresas**, explícito y auditado, y un **rol de base separado para Celery** (ADR-001).
- **Revocación inmediata del access token** (ADR-005). Hoy, cuando se revoca una sesión, su access sigue sirviendo hasta 15 min (salvo que se desactive la membresía o el usuario). Opción: incluir el `jti` de la sesión en el access y revisarlo en el middleware.
- **Varias pestañas del panel renovando la sesión a la vez** (ADR-005): coordinar el refresh entre pestañas (`BroadcastChannel`). Si no, una se toma como reuso y cierra todas las sesiones.

## Tracking

- **Recuperar los puntos trabados cuando el token de seguimiento queda inválido.**
  - *Problema:* si `POST /tracking/batch` responde 401 (el token venció, por ejemplo porque el teléfono estuvo offline más que la gracia, o se emitió otro), la PWA marca la jornada con `token_invalid` y sus puntos quedan **trabados en el teléfono para siempre**.
  - *Propuesta:*
    1. Endpoint nuevo `POST /api/v1/workdays/{id}/tracking-token`, con el JWT del repartidor. Emite un token nuevo para **esa** jornada y revoca el anterior.
    2. Solo procede si:
       - la jornada es del repartidor;
       - todavía está dentro de la ventana de gracia (activa, o finalizada hace menos de `tracking_token_grace_hours`);
       - el dispositivo, el perfil, la membresía y el usuario siguen activos.
    3. **No** recupera tokens revocados por desactivación: si el dispositivo o el repartidor se dieron de baja, los puntos no se aceptan.
    4. La ventana estricta de puntos (`started_at ≤ recorded_at ≤ ended_at`) no cambia.
    5. En la PWA: al volver a iniciar sesión (y también al abrir la app con sesión), por cada jornada local con `token_invalid` y puntos pendientes, pedir el token nuevo. Si el servidor lo da, guardarlo, sacar la marca y reintentar el envío. Si lo rechaza, mostrar en el diagnóstico que esos puntos no se van a poder enviar.
  - *Pruebas:* recuperación dentro de la gracia, rechazo fuera de la gracia, rechazo con el dispositivo desactivado, y que el token viejo deje de servir.
- **Cierre automático por duración máxima** (`AUTO_CLOSED`) con una tarea periódica de Celery (ADR-003). Hoy el token vence a las 14 h, pero la jornada queda `ACTIVE`.
- **Ingesta asíncrona y particionado** de `LocationPoint` cuando el volumen lo justifique (ADR-003).

- **Auditar el acceso a los recorridos** (§8 y §11): `GET /workdays/{id}/track` ya respeta los permisos por rol, pero todavía no deja registro en `AuditLog`, que no existe aún.
- **Recorridos muy largos:** `track` devuelve todos los puntos de la jornada. Si una jornada supera unos miles de puntos, conviene simplificarlos (`ST_Simplify`) o paginarlos.

## Datos

- `DriverProfile.document_number` cifrado (§7.2): se dejó fuera de la etapa 0.

# Pendientes para la etapa 1

Lo que se decidió dejar para la etapa 1 durante la etapa 0. Cada punto remite al ADR donde está el detalle.

## Seguridad y multitenancy

- ~~**RLS en `accounts_user`**~~ Hecho en la etapa 1 (ADR-010).
- **Acceso de soporte entre empresas**, explícito y auditado, y un **rol de base separado para Celery** (ADR-001).
- **Revocación inmediata del access token** (ADR-005). Hoy, cuando se revoca una sesión, su access sigue sirviendo hasta 15 min (salvo que se desactive la membresía o el usuario). Opción: incluir el `jti` de la sesión en el access y revisarlo en el middleware.
- **Varias pestañas del panel renovando la sesión a la vez** (ADR-005): coordinar el refresh entre pestañas (`BroadcastChannel`). Si no, una se toma como reuso y cierra todas las sesiones.

## Tracking

- ~~**Recuperar los puntos trabados cuando el token de seguimiento queda inválido.**~~ Hecho en la etapa 1 (ADR-010).
- ~~**Cierre automático por duración máxima** (`AUTO_CLOSED`) con Celery~~ Hecho en la etapa 1 (ADR-010).
- **Ingesta asíncrona y particionado** de `LocationPoint` cuando el volumen lo justifique (ADR-003).

- ~~**Auditar el acceso a los recorridos**~~ Hecho en la etapa 1 (ADR-010). Falta la pantalla del panel para consultar la auditoría.
- **Recorridos muy largos:** `track` devuelve todos los puntos de la jornada. Si una jornada supera unos miles de puntos, conviene simplificarlos (`ST_Simplify`) o paginarlos.

## Datos

- `DriverProfile.document_number` cifrado (§7.2): se dejó fuera de la etapa 0.

## Panel

- Pasar el ruteo por `#hash` a TanStack Router (§1), cuando haya más pantallas.
- Panel instalable como PWA de escritorio (§1).
- ~~Mapa en vivo con WebSocket (§9.1 `/operaciones/mapa`).~~ Hecho en la etapa 1 (ADR-017), en el inicio del panel.
- Que "hoy" en el dashboard sea la fecha en la zona horaria de la empresa, no la del navegador.

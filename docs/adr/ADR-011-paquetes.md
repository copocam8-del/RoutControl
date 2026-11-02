# ADR-011: Paquetes en el backend

- **Estado:** aceptado
- **Fecha:** 02/11/2026

## Decisión
- **Modelos de §7.2** (app `packages`): `Address`, `Package`, `PackageEvent`, `Visit`, `Incident`, `Evidence` y `Communication`.
  - Todos son `TenantModel`: tienen RLS por empresa y FK compuestas con `organization_id`.
  - Lo que nace en el teléfono (visita, evidencia, comunicación, incidencia) usa un id UUID generado en el teléfono, para que reintentar no duplique, y guarda las dos horas: la del teléfono y la del servidor.
- **Código de seguimiento:** único **por empresa** (`organization_id, tracking_code`). Dos empresas pueden tener el mismo código sin enterarse una de la otra.
- **Dirección:**
  - se guarda el texto tal cual y una clave normalizada (minúsculas, sin acentos ni signos), con la que se reutiliza el mismo domicilio escrito distinto;
  - las coordenadas son opcionales (`lat` y `lng`, proveedor `manual`).
  - **Todavía no hay geocodificación:** Georef queda pendiente, porque sin direcciones reales no se puede probar bien.
- **Estados y transiciones** (`services.TRANSITIONS`): `CREATED → ASSIGNED → IN_ROUTE → DELIVERED | FAILED | RESCHEDULED | RETURNED`. `CANCELLED` vale desde cualquier estado no final.
  - Los estados finales (`DELIVERED`, `RETURNED`, `CANCELLED`) no se editan ni se reasignan.
  - Desasignar devuelve el paquete a `CREATED`.
  - Desde el panel el personal solo puede **cancelar** o marcar **devuelto**. El resto de los estados los cambia la calle: "En camino" al cargar el paquete y el resultado de la visita.
- **Concurrencia optimista:** cada cambio suma 1 a `version`. Editar, asignar o cambiar el estado exige la versión actual; si no coincide, responde 409 `version_conflict`.
- **Trazabilidad:** cada alta, edición (con el antes y el después), asignación, desasignación y cambio de estado deja un `PackageEvent`, con el actor y la hora. La aplicación solo puede agregar eventos: se le quitan `UPDATE`, `DELETE` y `TRUNCATE` sobre la tabla.
- **Permisos:**
  - **dueño, admin y supervisor:** dan de alta, editan y asignan (también en forma masiva);
  - **repartidor:** ve solo los paquetes asignados a él.
  - Asignar a un repartidor de otra empresa es imposible: por RLS, para la empresa del contexto ese repartidor no existe (400 `driver_not_found`).

## Endpoints
| Método y ruta | Quién | Qué |
|---|---|---|
| `GET /packages/?status=&driver=&q=` | todos (el repartidor, solo los suyos) | Lista, hasta 500, la más nueva primero |
| `POST /packages/` | personal | Alta manual (opcionalmente ya asignado) |
| `GET /packages/{id}` | todos | Detalle |
| `PATCH /packages/{id}` | personal | Edición con `version` |
| `POST /packages/{id}/assign` | personal | Asignar o desasignar (`driver_id: null`) |
| `POST /packages/assign` | personal | Asignación masiva, con el resultado de cada paquete |
| `POST /packages/{id}/status` | personal | Cancelar o marcar devuelto |
| `GET /packages/{id}/events` | todos | Trazabilidad |

Cada endpoint tiene su prueba de aislamiento entre empresas (`tests/tenancy/test_isolation_endpoints.py`).

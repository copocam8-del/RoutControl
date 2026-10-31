# RouteControl

SaaS multitenant de gestión de repartos de última milla: app para repartidores + panel administrativo web.

**Fuente de verdad:** `docs/01-planificacion-routecontrol.md` (versión 0.5 o posterior). Leerla antes de cualquier cambio grande. Si este archivo y la planificación se contradicen, manda la planificación. Cualquier otro documento de planificación anterior (por ejemplo `RouteControl-planificacion.md`) queda reemplazado y no debe usarse.

## Decisiones definitivas (no cambiar sin aprobación explícita del cliente)

1. **Multitenant desde el día 1.** Esquema compartido con `organization_id NOT NULL` en todas las tablas operativas. Aislamiento en tres capas: middleware que toma la empresa de la membresía del usuario autenticado, `TenantModel` cuyo manager falla si no hay contexto, y **Row Level Security** en PostgreSQL con `SET LOCAL app.current_org`. Claves foráneas compuestas con `organization_id`. Nunca confiar en un `organization_id` enviado por el cliente.
2. **App del repartidor: primero PWA, después app de tiendas.** Se arranca con una **PWA** (React + TypeScript + Service Worker + IndexedDB/Dexie) en `apps/driver`, para no publicar en Google Play ni App Store al principio. Más adelante el mismo código se empaqueta con **Capacitor** para las tiendas. Todo acceso al dispositivo pasa por `DeviceServices` (por ahora solo la implementación `web`; la `native` se agrega en la fase 2). **No usar Expo ni React Native. Por ahora no agregar Capacitor.**
3. **Backend Django + Django REST Framework + PostgreSQL 16 + PostGIS.** Celery + Redis, Channels para tiempo real. **No usar NestJS ni Prisma.**
4. **GPS por etapas:** en la PWA, ubicación en cada evento y mientras la app está abierta, con huecos marcados. No prometer recorrido con la pantalla bloqueada hasta la app nativa. Siempre solo durante la jornada.

## Estado actual

**Etapa 0: fundaciones + validación de la PWA en teléfonos reales** (§14 de la planificación). Alcance:
- Monorepo mínimo + `infra/docker-compose.yml` (postgis/postgis:16, redis).
- `backend/`: Django multitenant (`tenancy` con RLS, dos empresas de prueba), login, inicio y fin de jornada, `POST /api/v1/tracking/batch` idempotente, pruebas de aislamiento sobre estos endpoints.
- `apps/driver/`: PWA instalable con Service Worker, Dexie, `DeviceServices` web, login, Iniciar/Finalizar jornada, ubicación por evento y con la app abierta, cola de envío con reintentos, indicador de sincronización.
- Página simple con MapLibre para ver el recorrido de una jornada (con huecos).
- Pruebas en teléfonos reales: varios Android, iPhone 15 y 13. Para probar en el teléfono hace falta HTTPS (túnel con Cloudflare Tunnel o ngrok).
- Fuera de alcance de la etapa 0: paquetes, visitas, fotos completas, panel completo, Capacitor, particionado de tablas, Turborepo.

## Reglas del dominio

- IDs generados en el cliente (UUID) para todo lo que crea el teléfono.
- Idempotencia: `point_id` / `client_op_id` únicos por empresa; `ON CONFLICT DO NOTHING`. Reintentar nunca duplica.
- Doble marca de tiempo: `recorded_at` / `occurred_at` (teléfono) y `received_at` (servidor). Medir el desfase del reloj del dispositivo.
- Respuesta de `POST /tracking/batch`: `{accepted: [ids], duplicates: [ids], rejected: [{id, reason}]}`. El teléfono borra los aceptados y los duplicados.
- La empresa de un lote GPS se deriva del `TrackingToken` (jornada + dispositivo), nunca de un campo del lote.
- Los eventos de campo son inmutables; las correcciones son eventos nuevos.
- Offline primero: guardar localmente y después sincronizar.

## Convenciones

- **"RouteControl" es un nombre provisorio y no hay dominio todavía.** Nombre del producto, textos de marca, manifiesto de la PWA y URLs (`APP_NAME`, `APP_URL`, `PANEL_URL`, `API_URL`) se leen de variables de entorno; no escribirlos fijos en el código.
- Repo en ruta corta sin espacios (por ejemplo `C:\dev\routecontrol`) para evitar fallas de Gradle/CMake en Windows.
- pnpm workspaces para el código TypeScript; Python con entorno virtual en `backend/`.
- API versionada en `/api/v1/`, documentada con OpenAPI (drf-spectacular).
- Pruebas: pytest + factory_boy (backend), Vitest (front). Las pruebas de aislamiento entre empresas son obligatorias para cada endpoint nuevo.
- Decisiones técnicas nuevas → un ADR en `docs/adr/`.
- No simular GPS, mapas ni sincronización como si fueran reales; los datos de demostración se marcan como tales.
- Al terminar cada paso: resumen con qué se hizo, archivos, qué funciona, qué falta, credenciales necesarias, pruebas y siguiente paso.

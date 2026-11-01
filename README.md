# RoutControl

SaaS multitenant de gestión de repartos de última milla. "RouteControl" es un nombre provisorio: la marca y las URLs se leen de variables de entorno (`APP_NAME`, `APP_URL`, `PANEL_URL`, `API_URL`).

- Planificación (fuente de verdad): [`docs/01-planificacion-routecontrol.md`](docs/01-planificacion-routecontrol.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr/) · Pendientes: [`docs/pendientes-etapa-1.md`](docs/pendientes-etapa-1.md) · Último resumen: [`docs/etapa0-resumen-2026-11-01.md`](docs/etapa0-resumen-2026-11-01.md)
- Contexto para sesiones de desarrollo: [`CLAUDE.md`](CLAUDE.md)

## Requisitos

- **Docker Desktop**. El backend, PostGIS y Redis corren en contenedores ([ADR-004](docs/adr/ADR-004-django-en-docker.md)), así que no hace falta instalar Python, GDAL ni PostgreSQL en Windows.
- **pnpm 10** (necesario para el front, y para los atajos `pnpm …`). Dos formas:
  - `corepack enable`, en una terminal como administrador, porque escribe en la carpeta de Node;
  - o `npm install -g pnpm@10`, sin permisos de administrador.

  La versión exacta la fija `packageManager` en `package.json`.
- El repo tiene que estar en una ruta corta y sin espacios (por ejemplo `C:\dev\routcontrol`).

## Correr las pruebas (un solo comando)

```bash
pnpm test:backend
```

O, sin pnpm:

```bash
docker compose -f infra/docker-compose.yml run --rm backend pytest
```

El comando levanta PostGIS si no está corriendo y construye la imagen la primera vez. Django crea una base de pruebas descartable con el rol dueño de las tablas (`rc_owner`), y **todas las pruebas se conectan con el rol de la aplicación (`rc_app`)**, que no es superusuario, no tiene `BYPASSRLS` y no es dueño de ninguna tabla. Así el RLS se prueba de verdad. Ver [ADR-001](docs/adr/ADR-001-multitenant-rls.md).

Para pasarle argumentos a pytest: `pnpm test:backend -k rls -v`.

## Desarrollo

```bash
cp .env.example .env              # opcional: todos los valores tienen un default de desarrollo
pnpm backend:dev                  # PostGIS + migraciones + runserver en http://localhost:8000
pnpm backend:seed                 # dos empresas de DEMOSTRACIÓN con usuarios de prueba
```

Si cambian los `requirements*.txt`: `docker compose -f infra/docker-compose.yml build backend`.

Si cambia `infra/postgres/20-routcontrol-roles.sh`, ese script corre solo al crear el volumen. Para empezar de cero: `docker compose -f infra/docker-compose.yml down -v`.

### Usuarios de demostración (`pnpm backend:seed`)

Contraseña: el valor de `DEMO_PASSWORD` (por defecto `routcontrol-demo`).

| Empresa | Usuarios |
|---|---|
| Demo Norte | `duenio@norte.demo`, `repartidor1@norte.demo` … `repartidor5@norte.demo` |
| Demo Sur | `duenio@sur.demo`, `repartidor1@sur.demo` |
| Las dos | `supervisor@ambas.demo` (al hacer login tiene que elegir empresa) |

## App del repartidor (PWA, `apps/driver`)

No necesita Docker para desarrollar ni para correr sus pruebas.

```bash
pnpm install
pnpm test:front          # Vitest: packages/domain + apps/driver
pnpm typecheck
pnpm driver:dev          # http://localhost:5173 (con el backend corriendo, /api va por proxy a :8000)
```

- **Contra el Django real** (por el proxy de Vite): con `pnpm backend:dev`, `pnpm backend:seed` y `pnpm driver:dev` corriendo, `pnpm --filter @routcontrol/driver test:real`. Usa las piezas reales de la app (cliente, cola de envío y jornada) y simula solo el teléfono.
- **Proxy, solo en desarrollo:** Vite reenvía `/api` a Django (`VITE_API_PROXY_TARGET`, por defecto `http://localhost:8000`). La PWA y la API quedan en el mismo origen. En producción la API está en `API_URL` (`https://api.<dominio>`) y no hay proxy ([ADR-005](docs/adr/ADR-005-sesion-web.md)).
- **En el teléfono:** guía completa, con la lista de pruebas, en [`docs/etapa0-prueba-en-telefonos.md`](docs/etapa0-prueba-en-telefonos.md). La geolocalización y el Service Worker exigen HTTPS. Resumen:
  1. Compilar y servir con `pnpm driver:build && pnpm driver:preview` (puerto 4173).
  2. Abrir un túnel: `cloudflared tunnel --url http://localhost:4173`.
  3. Abrir en el teléfono la URL `https://…trycloudflare.com` que muestra cloudflared. No hace falta tocar `CSRF_TRUSTED_ORIGINS`: en desarrollo Django toma el esquema de `X-Forwarded-Proto`.
- **Íconos:** `pnpm --filter @routcontrol/driver icons` los regenera desde `public/favicon.svg`.
- Qué se guarda en el teléfono y por qué: [ADR-006](docs/adr/ADR-006-almacenamiento-local-pwa.md).

## Panel administrativo (`apps/admin`)

Para dueños, administradores y supervisores (los repartidores no entran: usan la app del teléfono).

```bash
pnpm admin:dev                    # http://localhost:5174 (con el backend corriendo; /api por proxy)
pnpm --filter @routcontrol/admin test
pnpm --filter @routcontrol/admin test:real   # contra el Django real (backend, seed y admin:dev corriendo)
```

Pantallas: inicio (jornadas de hoy), jornadas por día con su recorrido en el mapa, y repartidores. Usuario de demo: `duenio@norte.demo` / `routcontrol-demo`.

## Sistema de diseño (`packages/ui`)

Tokens (paleta azul y violeta, tipografía, espaciados) y componentes base compartidos por la PWA y el panel. Ver [ADR-007](docs/adr/ADR-007-paleta-y-sistema-de-diseno.md).

## API (etapa 0)

Base: `/api/v1/`. Esquema OpenAPI en `/api/v1/schema/`.

| Método y ruta | Autenticación | Qué hace |
|---|---|---|
| `POST auth/login` | — | `{email, password, organization_id?}` → `{access, user, organization, role}` + cookie `rc_refresh` (httpOnly). Si el usuario está en varias empresas: `409 choose_organization` |
| `POST auth/refresh` | cookie | Rota el refresh → `{access}` |
| `POST auth/logout` | cookie | Invalida el refresh y borra la cookie |
| `GET auth/me` | Bearer | Usuario, empresa (con `is_demo`) y rol |
| `POST workdays/start` | Bearer (repartidor) | `{workday_id, started_at, device: {id, runtime, ...}, location?}` → jornada + `tracking_token`. Idempotente por `workday_id` |
| `GET workdays/current` | Bearer (repartidor) | Jornada activa o `null` |
| `POST workdays/{id}/end` | Bearer (repartidor) | `{ended_at, location?}`. Idempotente |
| `GET workdays/?date=AAAA-MM-DD` | Bearer | Jornadas visibles (repartidor: las propias), con `point_count` y `last_point_at` |
| `GET workdays/{id}/track` | Bearer | Recorrido en GeoJSON, partido en tramos por los huecos |
| `GET drivers/` | Bearer (dueño, admin, supervisor) | Repartidores con su jornada en curso y la última |
| `POST tracking/batch` | `Tracking <token>` | `[{point_id, recorded_at, lat, lng, accuracy, ...}]` o `{sent_at, points}` → `{accepted, duplicates, rejected, server_time}`. Ver [ADR-003](docs/adr/ADR-003-ingesta-gps.md) |

Todas las fechas van en ISO 8601 con zona horaria (`Z` u offset).

## Estructura

```
backend/            Django 5.2 + DRF + GeoDjango
  apps/tenancy/     Organization, Membership, TenantModel, middleware, RLS (db.py)
  apps/accounts/    User, login JWT + cookie de refresh
  apps/drivers/     DriverProfile, Device
  apps/workdays/    Workday (inicio y fin de jornada)
  apps/tracking/    TrackingToken, LocationPoint, TrackingGap, ingesta de lotes
  sql/rls/          funciones SQL de soporte del RLS
  tests/            pytest (tests/tenancy: aislamiento entre empresas)
infra/              docker-compose (PostGIS, Redis, backend) y script de roles
apps/, packages/    front-ends y paquetes compartidos (próximos pasos)
docs/               planificación y ADRs
```

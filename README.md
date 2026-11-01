# RoutControl

SaaS multitenant de gestión de repartos de última milla. "RouteControl" es un nombre provisorio: la marca y las URLs se leen de variables de entorno (`APP_NAME`, `APP_URL`, `PANEL_URL`, `API_URL`).

- Planificación (fuente de verdad): [`docs/01-planificacion-routecontrol.md`](docs/01-planificacion-routecontrol.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr/) · Pendientes: [`docs/pendientes-etapa-1.md`](docs/pendientes-etapa-1.md)
- Contexto para sesiones de desarrollo: [`CLAUDE.md`](CLAUDE.md)

## Requisitos

- **Docker Desktop**. El backend, PostGIS y Redis corren en contenedores ([ADR-004](docs/adr/ADR-004-django-en-docker.md)), así que no hace falta instalar Python, GDAL ni PostgreSQL en Windows.
- **pnpm** (opcional, para los atajos): `corepack enable && corepack prepare pnpm@latest --activate`.
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
| Demo Norte | `duenio@norte.demo`, `repartidor1@norte.demo`, `repartidor2@norte.demo` |
| Demo Sur | `duenio@sur.demo`, `repartidor1@sur.demo` |
| Las dos | `supervisor@ambas.demo` (al hacer login tiene que elegir empresa) |

## API (etapa 0)

Base: `/api/v1/`. Esquema OpenAPI en `/api/v1/schema/`.

| Método y ruta | Autenticación | Qué hace |
|---|---|---|
| `POST auth/login` | — | `{email, password, organization_id?}` → `{access, user, organization, role}` + cookie `rc_refresh` (httpOnly). Si el usuario está en varias empresas: `409 choose_organization` |
| `POST auth/refresh` | cookie | Rota el refresh → `{access}` |
| `POST auth/logout` | cookie | Invalida el refresh y borra la cookie |
| `GET auth/me` | Bearer | Usuario, empresa y rol |
| `POST workdays/start` | Bearer (repartidor) | `{workday_id, started_at, device: {id, runtime, ...}, location?}` → jornada + `tracking_token`. Idempotente por `workday_id` |
| `GET workdays/current` | Bearer (repartidor) | Jornada activa o `null` |
| `POST workdays/{id}/end` | Bearer (repartidor) | `{ended_at, location?}`. Idempotente |
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

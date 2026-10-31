# ADR-001 — Multitenancy: esquema compartido, `organization_id` y Row Level Security

- **Estado:** aceptado
- **Fecha:** 31/10/2026
- **Contexto:** D1 de la planificación (§0, §3).

## Decisión

Una base y un esquema compartidos, con `organization_id NOT NULL` en todas las tablas operativas. El aislamiento tiene varias capas independientes, para que una falla en una sola no exponga datos.

1. **Contexto de empresa por request** (`apps/tenancy/middleware.py`). La empresa sale de credenciales que emite el servidor:
   - JWT del usuario: el claim `org` lo agrega el servidor en el login, después de verificar la membresía. En cada request se vuelve a comprobar, dentro del contexto de esa empresa, que la membresía siga activa.
   - `TrackingToken` (lotes GPS): se resuelve con la función `rc_resolve_tracking_token`.
   - Nunca se toma un `organization_id` que mande el cliente.
2. **ORM que falla cerrado** (`TenantModel` / `TenantManager`). Sin contexto, cualquier consulta lanza `TenantContextMissing`. Guardar o borrar un registro de otra empresa también lanza error.
3. **RLS en PostgreSQL**: `ENABLE` + `FORCE ROW LEVEL SECURITY` y la política `tenant_isolation` (`organization_id = rc_current_org()`), tanto para leer (`USING`) como para escribir (`WITH CHECK`). El contexto se fija con `set_config('app.current_org', …, true)`, que equivale a `SET LOCAL`. Así dura solo la transacción y es compatible con PgBouncer en modo transacción.
4. **FK compuestas** `(organization_id, fk) → destino(organization_id, id)`, para que sea imposible relacionar filas de empresas distintas.

## Dos roles de base de datos

| Rol | Atributos | Uso |
|---|---|---|
| `rc_owner` (`DB_OWNER_USER`) | Dueño de las tablas, `CREATEDB`, `BYPASSRLS`. **No** es superusuario | Migraciones, creación de la base de pruebas y dueño de las funciones `SECURITY DEFINER` |
| `rc_app` (`DB_APP_USER`) | Sin superusuario, sin `BYPASSRLS`, sin `CREATEDB`, no es dueño de nada. Solo tiene permisos DML | **Toda** la aplicación y **todas las pruebas** |

Django tiene dos alias sobre la misma base: `default` (`rc_owner`) y `app` (`rc_app`). `AppUserRouter` manda todas las lecturas y escrituras a `app` y permite migrar solo en `default`.

En las pruebas, Django crea la base de pruebas con `default` y le aplica el `migrate`. Como los dos alias apuntan al mismo servidor y a la misma base, el alias `app` queda apuntando a esa misma base de pruebas, pero conectado como `rc_app`. `tests/tenancy/test_db_roles.py` verifica en cada corrida, en el catálogo de PostgreSQL, que el rol de las pruebas no es superusuario, no tiene `BYPASSRLS`, no hereda roles privilegiados y no es dueño de ninguna tabla. Si alguien cambia la configuración y las pruebas pasan a correr con un rol que ignora el RLS, esas pruebas fallan.

## Por qué las políticas se generan desde los modelos

`apps/tenancy/db.py` se ejecuta al final de cada `migrate` (`post_migrate`), es idempotente y genera el RLS, los `UNIQUE (organization_id, id)`, las FK compuestas y los `GRANT` para cada subclase de `TenantModel`. Escribirlo a mano por tabla deja margen para olvidarse una. Las pruebas verifican el resultado en `pg_class`, `pg_policies` y `pg_constraint`.

## Búsquedas previas al contexto

Solo dos búsquedas ocurren antes de conocer la empresa. Las dos son funciones `SECURITY DEFINER` acotadas (`sql/rls/functions.sql`): una sola clave de entrada, `search_path` fijo, `EXECUTE` revocado a `PUBLIC` y otorgado solo a `rc_app`, y dueño `rc_owner`. **La API nunca se conecta como `rc_owner`**, y una prueba lo verifica con un flujo completo que no hace ninguna consulta por el alias `default`.

| Momento | Función | Devuelve | Lo demás se lee… |
|---|---|---|---|
| Login y refresh | `rc_user_memberships(user_id)` | `(organization_id, membership_id)` | El rol de la membresía se lee dentro del contexto de cada empresa, con RLS. El nombre sale de `Organization` (tabla de plataforma) |
| Cada request con JWT | — (no hace falta) | — | La empresa viene en el claim `org` firmado. Con ella se fija el contexto y la membresía se vuelve a leer **con RLS** |
| `tracking/batch` | `rc_resolve_tracking_token(hash)` | `(organization_id, workday_id)` | El token y su dispositivo se leen dentro del contexto, con RLS |

`rc_resolve_tracking_token` además exige que la empresa, el dispositivo, el perfil de repartidor, la membresía y el usuario estén activos.

No se le saca el RLS a ninguna tabla. `tests/tenancy/test_pre_context_lookups.py` verifica:

- la forma de las funciones en `pg_proc`;
- que, por fuera de ellas, `rc_app` no puede leer membresías ni tokens de otra empresa, ni sin contexto, ni con el contexto propio, ni buscando por hash.

## Consecuencias

- Toda request autenticada corre dentro de una transacción en `app`. Si la respuesta es un error (≥ 400), el middleware hace rollback, porque DRF convierte las excepciones en respuestas y el `atomic` no se enteraría.
- Un endpoint nuevo tiene que figurar en `tests/tenancy/test_isolation_endpoints.py` (o en `EXEMPT`, con el motivo). Si no, la prueba de cobertura falla.
- Pendiente para la etapa 1: el acceso explícito y auditado entre empresas (soporte de plataforma) y un rol separado para las tareas de Celery.

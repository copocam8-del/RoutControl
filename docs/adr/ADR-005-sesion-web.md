# ADR-005 — Sesión web: access token en memoria y refresh en una cookie httpOnly

- **Estado:** aceptado
- **Fecha:** 31/10/2026
- **Contexto:** §5.6 de la planificación. Tiene que funcionar con el proxy de Vite en desarrollo y con `api.<dominio>` en producción.

## Decisión

- `POST /api/v1/auth/login` devuelve el **access token** (15 min) en el cuerpo. La PWA lo guarda **solo en memoria**, nunca en `localStorage`.
- El **refresh token** (14 días, rotativo, con lista negra después de usarse) va solo en la cookie `rc_refresh`: `HttpOnly`, `Path=/api/v1/auth/`, con `Secure`, `SameSite` y `Domain` configurables por entorno. Nunca aparece en el cuerpo de la respuesta.
- `POST /auth/refresh` lee la cookie, la rota y vuelve a comprobar que la membresía siga activa. `POST /auth/logout` pone el refresh en la lista negra y borra la cookie.
- La empresa va en el claim `org` del refresh, y el access se deriva de él. Si el usuario pertenece a varias empresas, el login responde `409 choose_organization` y el cliente repite el login con `organization_id`. Ese valor se valida contra las membresías del usuario.
- **Defensa CSRF** de los endpoints que usan la cookie: `SameSite` más una comprobación del `Origin`, que tiene que ser el mismo origen o uno de `CSRF_TRUSTED_ORIGINS`.

## Cómo funciona en cada entorno

| | Desarrollo (proxy de Vite) | Producción |
|---|---|---|
| Orígenes | La PWA en `localhost:5173` (o el túnel HTTPS) y `/api` por proxy hacia Django: **mismo origen** | `app.<dominio>` / `panel.<dominio>` → `api.<dominio>`: distinto origen, **mismo sitio** |
| Cookie | `Secure=0` (HTTP local; con el túnel puede ser 1), `SameSite=Lax`, sin `Domain` | `Secure=1`, `SameSite=Lax`, sin `Domain` (cookie solo de `api.`) |
| CORS | No hace falta | `CORS_ALLOWED_ORIGINS=https://app.<dominio>,https://panel.<dominio>`, con credenciales. El cliente usa `fetch(..., {credentials: "include"})` |
| `CSRF_TRUSTED_ORIGINS` | No hace falta (mismo origen) | Los mismos orígenes de `app.` y `panel.` |

`SameSite=Lax` alcanza en producción porque `app.` y `api.` son el **mismo sitio** (el mismo dominio registrable). Si en algún momento la API quedara en otro dominio, habría que pasar a `SameSite=None; Secure`.

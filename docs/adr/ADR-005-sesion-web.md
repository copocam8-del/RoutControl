# ADR-005 — Sesión web: access token en memoria y refresh en una cookie httpOnly

- **Estado:** aceptado
- **Fecha:** 31/10/2026
- **Contexto:** §5.6 de la planificación. Tiene que funcionar con el proxy de Vite en desarrollo y con `api.<dominio>` en producción.

## Decisión

- `POST /api/v1/auth/login` devuelve el **access token** (15 min) en el cuerpo. La PWA lo guarda **solo en memoria**, nunca en `localStorage`.
- El **refresh token** (14 días, rotativo) va solo en la cookie `rc_refresh`: `HttpOnly`, `Path=/api/v1/auth/`, con `Secure`, `SameSite` y `Domain` configurables por entorno. Nunca aparece en el cuerpo de la respuesta.
- `POST /auth/refresh` y `POST /auth/logout` trabajan con las sesiones propias que se describen abajo.
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

## Sesiones de refresh (`RefreshSession`)

La app `token_blacklist` de simplejwt **no se usa**: guardaba el refresh completo de cada sesión en una tabla sin RLS, y cualquiera con acceso de lectura podía renovar la sesión de otra persona.

En su lugar, `accounts.RefreshSession` es un `TenantModel` con RLS por empresa que guarda **solo**:

- `jti`;
- usuario;
- vencimiento;
- revocación (`revoked_at` y `revoked_reason`).

Nunca guarda el token. Una prueba recorre todas las columnas de texto y JSON de la base y confirma que ningún refresh, ni siquiera su firma, aparece en ninguna.

**Refresh** (`accounts/sessions.py`), sin funciones `SECURITY DEFINER`:

1. Se verifica la **firma** y el vencimiento del refresh con la clave del servidor. Un token adulterado se rechaza sin mirar la base, así que no puede disparar revocaciones.
2. La empresa sale del claim `org` del token firmado.
3. Se entra al contexto de esa empresa y la sesión se busca por `jti` **con RLS** (`SELECT … FOR UPDATE`).
4. Se comprueba que la membresía, el usuario y la empresa sigan activos. Si no, se revocan las sesiones (`access_lost`).
5. Se **rota**: la sesión vieja queda revocada como `rotated` y se crea una nueva, con un `jti` nuevo.

**Detección de reuso:** si llega un refresh cuya sesión ya está `rotated`, alguien más tiene ese token. Puede ser que lo robaron y el dueño ya lo usó, o que el ladrón lo usó primero. Se revocan **todas** las sesiones de ese usuario en esa empresa (`reuse_detected`) y la respuesta es `401` con `code: refresh_reuse_detected`.

**Logout:** revoca solo esa sesión. Reusar un refresh cerrado con logout no se trata como robo y no afecta las demás sesiones.

**Límites conocidos:**

- **Alcance de la revocación por reuso:** solo la empresa del token, porque las sesiones del mismo usuario en otras empresas no son visibles con RLS. Alcanza, porque el token robado solo sirve en esa empresa.
- **Dos pestañas que renuevan a la vez con el mismo refresh:** la segunda se toma como reuso y se cierran todas las sesiones. La PWA lo evita porque todos los refresh pasan por una sola promesa compartida (`ApiClient.refresh`). Un panel con varias pestañas va a necesitar coordinarlas (por ejemplo, con `BroadcastChannel`) en la etapa 1.
- **El access token** (15 min) de una sesión revocada sigue sirviendo hasta que vence, salvo que se desactive la membresía o el usuario, que el middleware revisa en cada request. Si hace falta cortarlo en el momento, se puede agregar el `jti` de la sesión al access y revisarlo en el middleware, con una consulta más por request.

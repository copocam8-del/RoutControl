# ADR-021: Despliegue en un servidor Linux genérico

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** Oracle Cloud rechazó la cuenta y, por ahora, se sigue desarrollando en esta compu. El pedido es dejar el despliegue listo para cualquier servidor Linux (x86 o ARM), de modo que, el día que se contrate uno, sea solo correr un comando.

## Decisión
- **Docker Compose** (`infra/prod/docker-compose.yml`). Es suficiente para un servidor, se entiende sin conocimientos de orquestación y es lo mismo que se usa en desarrollo.
- **Caddy** como único punto de entrada:
  - HTTPS automático con Let's Encrypt, que también lo renueva;
  - tres sitios, como en la planificación (§5.6 y ADR-005): `app.`, `panel.` y `api.`;
  - sirve compiladas la app y el panel (`infra/prod/web.Dockerfile`, que compila con Node y deja solo Caddy con los archivos), y además el mapa (`/map`) con rangos;
  - pasa `api.` (API y WebSocket) al backend;
  - HSTS, y sin caché para el Service Worker y el `index.html`, para que una versión nueva llegue enseguida a los teléfonos.
- **Backend:**
  - imagen propia (`backend/Dockerfile.prod`) sin las dependencias de desarrollo, con un usuario sin privilegios;
  - **Daphne** sirve HTTP y WebSocket;
  - migra al arrancar;
  - `config/settings/prod.py` no arranca si falta un secreto o si quedó el valor de desarrollo.
- **Multiarquitectura:** todas las imágenes tienen arm64; se verificó con `docker manifest`. La excepción es `postgis/postgis`, que solo se publica para x86; en producción se usa `imresamu/postgis:16-3.5`, la misma imagen publicada para las dos arquitecturas, y se puede cambiar con `POSTGIS_IMAGE`.
- **Variables:** todo lo que cambia entre servidores está en `infra/prod/.env`, que no va a git. Lo genera el instalador con contraseñas aleatorias. Hay un ejemplo en `infra/prod/env.example`.
- **Copias diarias:** las hace un contenedor `backup` con la misma imagen de la base, para que `pg_dump` sea de la misma versión.
  - Corre una vez por día, a una hora fija, sin cron: un bucle que duerme hasta la próxima ejecución.
  - Copia la base (formato custom) y las fotos, y borra las viejas.
  - `restore.sh` restaura todo menos la extensión PostGIS, que ya trae la base nueva, así que el restore termina sin errores (`--exit-on-error`).
- **Instalación de un solo comando** (`infra/prod/install.sh`):
  1. instala Docker si falta;
  2. genera `.env`;
  3. avisa si falta el DNS o el mapa;
  4. construye y levanta todo;
  5. espera al backend;
  6. opcionalmente, crea la primera empresa.

  Se puede volver a correr. `update.sh` hace una copia, `git pull` y reinicia.
- **Alta de empresas:** el comando `create_company` crea la empresa y su dueño. Es idempotente por slug y muestra la contraseña inicial una sola vez. Por ahora reemplaza al registro autogestionado, que está en la etapa 2 de la planificación y no se hizo.

## Verificado
- **Stack completa en esta compu** con `*.localhost` (Caddy con certificado propio):
  - páginas, rutas de la SPA, mapa por rangos, HSTS, CORS;
  - login y renovación de la sesión con la cookie;
  - WebSocket (101 desde el panel, 403 desde otro origen);
  - el worker con el beat;
  - una copia y su restauración.

  Uso de memoria: unos 450 MB sin el ruteo.
- **Pruebas:** `create_company` (alta, que el dueño pueda entrar, sin duplicar y reutilizando un usuario existente).

## Pendiente
- Probarlo en un servidor real con dominio y en ARM.
- Una copia fuera del servidor (rclone a S3, R2 o Drive): falta elegir el destino.
- Monitoreo y avisos si el servidor se cae (por ejemplo, Uptime Kuma o un servicio externo).
- El correo transaccional (invitaciones, recuperación de contraseña, alertas por email): falta el proveedor.

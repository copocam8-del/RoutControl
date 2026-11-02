# ADR-009: Integración continua y ramas de la etapa 1

- **Estado:** aceptado
- **Fecha:** 02/11/2026

## CI (GitHub Actions, `.github/workflows/ci.yml`)
- **Cuándo corre:** en cada pull request (contra cualquier rama base) y en cada push a `main`.
- **Backend:** las mismas pruebas que `pnpm test:backend`, con `docker compose` y la imagen `postgis/postgis:16-3.5`.
  - El script `infra/postgres/20-routcontrol-roles.sh` crea `rc_owner` y `rc_app`.
  - Las pruebas de aislamiento se conectan como `rc_app`, sin superusuario, sin `BYPASSRLS` y sin ser dueño de las tablas, como en desarrollo.
  - Además se verifica que no falten migraciones (`makemigrations --check`).
- **Front:** `pnpm typecheck`, `pnpm test:front` y la compilación de la PWA y del panel.
- **Lo que no corre en CI:**
  - las pruebas contra el Django real (`test:real`), porque necesitan los servidores de Vite levantados;
  - el archivo PMTiles, porque no está en git: la compilación copia solo lo que exista en `map-data/`.

**Por qué con `docker compose`:** es la misma configuración que en desarrollo, con los roles reales. Un servicio de Postgres de Actions no puede montar el script de roles antes de arrancar.

## Ramas de la etapa 1
- Una rama y un pull request por parte: `etapa-1/<parte>`, sin fusionar nada sin revisión.
- **Las partes se apilan:** cada rama sale de la anterior y su pull request apunta a la anterior. Por ejemplo, `etapa-1/seguridad` sale de `etapa-1/ci`.
  - Muchas partes dependen de las anteriores: la app de paquetes necesita los modelos de paquetes.
  - Así cada pull request muestra solo su parte, y la CI de la primera ya corre en todas.
- **Para fusionar:** en orden, empezando por la primera. Al fusionar una rama y borrarla, GitHub cambia la base del pull request siguiente a `main`.

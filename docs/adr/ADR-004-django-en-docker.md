# ADR-004 — El backend corre en Docker para desarrollo y pruebas

- **Estado:** aceptado
- **Fecha:** 31/10/2026

## Contexto

GeoDjango necesita las bibliotecas nativas GDAL, GEOS y PROJ. En Windows hay que instalarlas aparte (con OSGeo4W o similar) y configurar `GDAL_LIBRARY_PATH` y `GEOS_LIBRARY_PATH`. Eso es frágil y cambia en cada máquina. Además, el `CLAUDE.md` pedía un entorno virtual en `backend/`.

## Decisión

- `runserver`, `migrate`, `pytest` y los comandos de gestión corren en un contenedor Linux (`backend/Dockerfile`, Python 3.13 y Django 5.2 LTS), definido en `infra/docker-compose.yml` junto con PostGIS y Redis.
- El código se monta como volumen (`../backend:/app`), así que los cambios se ven sin reconstruir la imagen.
- Un entorno virtual local en `backend/.venv` es **opcional** y sirve solo para que el editor tenga autocompletado y análisis. No se usa para ejecutar nada.
- Las pruebas se corren con un solo comando: `pnpm test:backend`, o sin pnpm `docker compose -f infra/docker-compose.yml run --rm backend pytest`.

## Consecuencias

- Hace falta Docker Desktop. No hace falta instalar Python, GDAL ni PostgreSQL en Windows.
- La imagen solo hay que reconstruirla cuando cambian los `requirements*.txt` (`docker compose … build backend`).
- CI (GitHub Actions) puede usar la misma imagen.

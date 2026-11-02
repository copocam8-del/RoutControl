#!/usr/bin/env bash
# Restaura una copia de infra/prod/backups (ADR-021). REEMPLAZA los datos actuales.
#
#   sudo ./infra/prod/restore.sh 2026-11-03_0300
set -euo pipefail
cd "$(dirname "$0")"
[[ $EUID -eq 0 ]] || { echo "Corrélo con sudo." >&2; exit 1; }
COPY=${1:?Indicá la copia, por ejemplo: sudo ./infra/prod/restore.sh 2026-11-03_0300 (ver infra/prod/backups)}
[[ -f backups/$COPY/base.dump ]] || { echo "No existe backups/$COPY/base.dump" >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.yml --env-file .env)
# shellcheck disable=SC1091
set -a; source .env; set +a

read -r -p "Esto reemplaza la base y las fotos actuales por la copia $COPY. ¿Seguir? (escribí SI) " ok
[[ $ok == SI ]] || { echo "Cancelado."; exit 1; }

echo "==> Deteniendo la app…"
"${COMPOSE[@]}" stop backend worker web
echo "==> Restaurando la base…"
"${COMPOSE[@]}" exec -T backup bash -c "
  set -e
  psql -d postgres -v ON_ERROR_STOP=1 -c \"DROP DATABASE IF EXISTS ${DB_NAME:-routcontrol} WITH (FORCE)\"
  psql -d postgres -v ON_ERROR_STOP=1 -c \"CREATE DATABASE ${DB_NAME:-routcontrol} OWNER ${DB_OWNER_USER:-rc_owner} TEMPLATE template1\"
  # PostGIS ya viene en la base nueva (template1): se restaura todo menos la extensión y su tabla.
  pg_restore -l /backups/$COPY/base.dump | grep -viE ' EXTENSION |spatial_ref_sys' > /tmp/lista
  pg_restore --exit-on-error --no-owner --role=${DB_OWNER_USER:-rc_owner} --use-list=/tmp/lista --dbname=${DB_NAME:-routcontrol} /backups/$COPY/base.dump
"
echo "==> Restaurando las fotos…"
"${COMPOSE[@]}" run --rm --no-deps -v "$(pwd)/backups/$COPY:/copia:ro" --entrypoint sh backend \
  -c "find /app/media -mindepth 1 -delete; tar -xzf /copia/fotos.tar.gz -C /app/media"
echo "==> Levantando la app (las migraciones y los permisos de la base se aplican al arrancar)…"
"${COMPOSE[@]}" up -d
echo "==> Listo."

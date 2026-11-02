#!/usr/bin/env bash
# Actualiza a la última versión del repositorio (ADR-021): copia de seguridad, git pull,
# reconstruir y reiniciar. Las migraciones corren solas al arrancar el backend.
set -euo pipefail
cd "$(dirname "$0")"
[[ $EUID -eq 0 ]] || { echo "Corrélo con sudo." >&2; exit 1; }
[[ -f .env ]] || { echo "Falta infra/prod/.env: corré primero install.sh" >&2; exit 1; }
PROFILES=()
[[ ${ROUTING:-0} == 1 ]] && PROFILES=(--profile routing)
COMPOSE=(docker compose -f docker-compose.yml --env-file .env "${PROFILES[@]}")

echo "==> Copia de seguridad antes de actualizar…"
"${COMPOSE[@]}" exec -T backup bash /backup.sh now
echo "==> Bajando la última versión…"
git -C ../.. pull --ff-only
echo "==> Construyendo y reiniciando…"
"${COMPOSE[@]}" build --pull
"${COMPOSE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null
echo "==> Listo."

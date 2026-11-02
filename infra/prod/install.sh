#!/usr/bin/env bash
# Instala RouteControl en un servidor Linux (x86 o ARM) con un solo comando (ADR-021):
#
#   sudo DOMAIN=midominio.com EMAIL=yo@midominio.com ./infra/prod/install.sh
#
# Opcionales: COMPANY_NAME, COMPANY_SLUG y OWNER_EMAIL para crear la primera empresa y su dueño;
# APP_NAME (por defecto RouteControl); ROUTING=1 para levantar también OSRM y VROOM.
# Se puede volver a correr: no pisa infra/prod/.env ni los datos.
set -euo pipefail

cd "$(dirname "$0")"
PROD_DIR=$(pwd)
REPO_DIR=$(cd ../.. && pwd)
ENV_FILE="$PROD_DIR/.env"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $(uname -s) == Linux ]] || fail "Este instalador es para Linux."
[[ $EUID -eq 0 ]] || fail "Corrélo con sudo."

# 1. Docker -------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker (script oficial get.docker.com)…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "Falta el plugin 'docker compose'."
systemctl enable --now docker >/dev/null 2>&1 || true

# 2. Configuración (infra/prod/.env) -------------------------------------------------------------
secret() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }
if [[ ! -f $ENV_FILE ]]; then
  : "${DOMAIN:?Falta DOMAIN (por ejemplo: sudo DOMAIN=midominio.com EMAIL=yo@midominio.com ./infra/prod/install.sh)}"
  : "${EMAIL:?Falta EMAIL (para el certificado HTTPS)}"
  say "Generando $ENV_FILE con contraseñas aleatorias…"
  umask 077
  cat >"$ENV_FILE" <<EOF
# Generado por install.sh el $(date -I). No se sube al repositorio: guardalo en un lugar seguro.
APP_NAME=${APP_NAME:-RouteControl}
APP_DOMAIN=app.$DOMAIN
PANEL_DOMAIN=panel.$DOMAIN
API_DOMAIN=api.$DOMAIN
ACME_EMAIL=$EMAIL
DJANGO_SECRET_KEY=$(secret 64)
POSTGRES_PASSWORD=$(secret)
DB_OWNER_PASSWORD=$(secret)
DB_APP_PASSWORD=$(secret)
BACKUP_HOUR=3
BACKUP_KEEP_DAYS=14
TZ=America/Argentina/Buenos_Aires
EOF
else
  say "Usando la configuración existente: $ENV_FILE"
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# 3. Comprobaciones ------------------------------------------------------------------------------
say "Arquitectura: $(uname -m)"
for host in "$APP_DOMAIN" "$PANEL_DOMAIN" "$API_DOMAIN"; do
  if ! getent hosts "$host" >/dev/null; then
    echo "  Aviso: $host todavía no apunta a ningún lado. Creá el registro DNS (A o AAAA) hacia este servidor;"
    echo "         el certificado HTTPS se pide solo cuando el nombre resuelva."
  fi
done
if [[ ! -f $REPO_DIR/map-data/amba.pmtiles ]]; then
  echo "  Aviso: falta map-data/amba.pmtiles. La app funciona, pero los mapas no se van a ver hasta copiarlo"
  echo "         (ver docs/despliegue.md, \"Mapas\")."
fi
mkdir -p "$PROD_DIR/backups"

# 4. Construir y levantar ------------------------------------------------------------------------
PROFILES=()
[[ ${ROUTING:-0} == 1 ]] && PROFILES=(--profile routing)
COMPOSE=(docker compose -f "$PROD_DIR/docker-compose.yml" --env-file "$ENV_FILE" "${PROFILES[@]}")
say "Construyendo las imágenes (la primera vez tarda varios minutos)…"
"${COMPOSE[@]}" build --pull
say "Levantando los servicios…"
"${COMPOSE[@]}" up -d

say "Esperando al backend (migraciones)…"
# El login sin datos responde 400: el backend está arriba (y migrado).
WAIT_PY='
import urllib.request, urllib.error
req = urllib.request.Request("http://127.0.0.1:8000/api/v1/auth/login", data=b"{}", headers={"Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=3)
except urllib.error.HTTPError as e:
    raise SystemExit(0 if e.code < 500 else 1)
'
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T backend python -c "$WAIT_PY" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 5
done
[[ ${ok:-0} == 1 ]] || fail "El backend no respondió. Mirá: docker compose -f infra/prod/docker-compose.yml logs backend"

# 5. Primera empresa (opcional) ------------------------------------------------------------------
if [[ -n ${COMPANY_NAME:-} && -n ${OWNER_EMAIL:-} ]]; then
  say "Creando la empresa $COMPANY_NAME…"
  slug=${COMPANY_SLUG:-}
  if [[ -z $slug ]]; then
    slug=$(printf '%s' "$COMPANY_NAME" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')
  fi
  "${COMPOSE[@]}" exec -T backend python manage.py create_company \
    --name "$COMPANY_NAME" --slug "$slug" --owner-email "$OWNER_EMAIL"
fi

say "Listo."
cat <<EOF
  App del repartidor: https://$APP_DOMAIN
  Panel:              https://$PANEL_DOMAIN
  API:                https://$API_DOMAIN
  Copias diarias:     $PROD_DIR/backups (a las ${BACKUP_HOUR}:00, se guardan ${BACKUP_KEEP_DAYS} días)
  Actualizar:         sudo ./infra/prod/update.sh
EOF

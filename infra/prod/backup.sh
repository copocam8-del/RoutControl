#!/usr/bin/env bash
# Copia diaria de la base (pg_dump, formato custom) y de las fotos (ADR-021).
# Corre dentro del contenedor "backup": espera hasta BACKUP_HOUR (hora local, TZ), hace la copia y
# borra las de más de BACKUP_KEEP_DAYS días. Con "now" como argumento hace una copia en el acto.
set -euo pipefail

: "${DB_NAME:?}" "${BACKUP_HOUR:=3}" "${BACKUP_KEEP_DAYS:=14}"
DEST=/backups

backup_once() {
  local stamp tmp
  stamp=$(date +%Y-%m-%d_%H%M)
  tmp="$DEST/.parcial-$stamp"
  mkdir -p "$tmp"
  echo "[$(date -Is)] Copia $stamp: base…"
  pg_dump --format=custom --no-owner --dbname="$DB_NAME" --file="$tmp/base.dump"
  # Los roles (rc_owner, rc_app) se recrean con infra/postgres; solo se guardan los datos.
  echo "[$(date -Is)] Copia $stamp: fotos…"
  tar -czf "$tmp/fotos.tar.gz" -C /media .
  mv "$tmp" "$DEST/$stamp"
  echo "[$(date -Is)] Copia lista: $DEST/$stamp ($(du -sh "$DEST/$stamp" | cut -f1))"
  find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$BACKUP_KEEP_DAYS" -print -exec rm -rf {} +
}

if [[ "${1:-}" == "now" ]]; then
  backup_once
  exit 0
fi

echo "Copias diarias a las ${BACKUP_HOUR}:00 (${TZ:-UTC}), se guardan ${BACKUP_KEEP_DAYS} días."
while true; do
  now=$(date +%s)
  next=$(date -d "today ${BACKUP_HOUR}:00" +%s)
  ((next <= now)) && next=$(date -d "tomorrow ${BACKUP_HOUR}:00" +%s)
  sleep $((next - now))
  backup_once || echo "[$(date -Is)] ERROR: la copia falló; se reintenta mañana." >&2
done

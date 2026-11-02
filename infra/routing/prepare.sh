#!/usr/bin/env bash
# Prepara los datos de ruteo de la zona AMBA para OSRM (ADR-015). Una sola vez (o para actualizar).
# Usa el recorte de OpenStreetMap de BBBike (Buenos Aires, ~40 MB) y la imagen oficial de OSRM.
# Necesita unos 1,5 GB de memoria libre para Docker durante el procesamiento.
set -euo pipefail
# Git Bash en Windows convierte "/opt/..." en rutas de Windows: acá son rutas del contenedor.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."
DATA=map-data/routing
IMAGE=ghcr.io/project-osrm/osrm-backend:v6.0.0
SOURCE=${ROUTING_SOURCE:-https://download.bbbike.org/osm/bbbike/BuenosAires/BuenosAires.osm.pbf}
mkdir -p "$DATA"
if [ ! -s "$DATA/amba.osm.pbf" ]; then
  echo "Bajando el recorte de OpenStreetMap: $SOURCE"
  curl -fL --retry 3 -o "$DATA/amba.osm.pbf" "$SOURCE"
fi
run() { docker run --rm -v "$PWD/$DATA:/data" "$IMAGE" "$@"; }
echo "OSRM: extraer (perfil auto)…"
run osrm-extract -p /opt/car.lua /data/amba.osm.pbf
echo "OSRM: particionar y personalizar (MLD)…"
run osrm-partition /data/amba.osrm
run osrm-customize /data/amba.osrm
echo "Listo. Levantar con: docker compose -f infra/docker-compose.yml --profile routing up -d osrm vroom"

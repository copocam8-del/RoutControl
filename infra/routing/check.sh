#!/usr/bin/env bash
# Prueba contra los servicios reales: una ruta de 3 paradas en CABA (VROOM + OSRM levantados).
set -euo pipefail
curl -fsS -X POST "${VROOM_URL:-http://localhost:3000}" -H 'Content-Type: application/json' -d '{
  "vehicles": [{"id": 1, "profile": "car", "start": [-58.3816, -34.6037]}],
  "jobs": [
    {"id": 1, "location": [-58.4370, -34.6118], "service": 180},
    {"id": 2, "location": [-58.3960, -34.5875], "service": 180},
    {"id": 3, "location": [-58.4600, -34.5600], "service": 180}
  ]
}'

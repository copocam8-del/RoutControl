# ADR-015: "Armar mi ruta" con OSRM y VROOM autoalojados

- **Estado:** aceptado (decisión del cliente en ADR-008: pasa de la etapa 2 a la etapa 1)
- **Fecha:** 02/11/2026

## Infraestructura (`infra/routing`, perfil `routing` de docker compose)
- **OSRM** (`ghcr.io/project-osrm/osrm-backend:v6.0.0`, algoritmo MLD, perfil auto) da los tiempos y distancias por calle.
- **VROOM** (`ghcr.io/vroom-project/vroom-docker:v1.14.0`) ordena las paradas usando la matriz de OSRM.
- **Datos:** el recorte de OpenStreetMap de **BBBike, Buenos Aires** (unos 40 MB), procesado con `infra/routing/prepare.sh`.
  - El procesamiento tuvo un pico de unos 700 MB de memoria.
  - Queda en `map-data/routing/`, fuera de git, porque se regenera.
- **Arranque:** no arrancan por defecto, para cuidar la memoria: `docker compose -f infra/docker-compose.yml --profile routing up -d osrm vroom`.
- **Verificado el 02/11/2026 con los servicios reales:** una ruta de 3 paradas en CABA, desde el backend por la red de compose (`ROUTING_REAL=1 pytest tests/packages/test_route.py`) y con `infra/routing/check.sh`.

## Backend
- **`RouteStop`** (§7.2): jornada, paquete, orden, origen (`OPTIMIZED` o `MANUAL`), y el tiempo y la distancia del tramo. Se reemplaza entero cada vez que se arma o se edita la ruta.
- **`POST /route/optimize {lat, lng}`** (repartidor, con la jornada iniciada): manda a VROOM los pendientes con coordenadas, con el inicio en la ubicación actual.
  - **No hay punto final:** el repartidor no vuelve al depósito.
  - **Servicio:** 3 minutos por parada (`settings.service_seconds` por empresa).
  - **Sin coordenadas:** los paquetes sin coordenadas, o que OSRM no puede alcanzar, van al final en el orden de carga.
  - **Si el servicio no responde:** 503 `routing_unavailable`, con un mensaje para el repartidor.
- **`GET /route`** y **`PUT /route {package_ids}`**: la ruta de la jornada y el orden a mano. Los pendientes que no vinieron en la lista quedan al final.
- **Aislamiento:** cada endpoint tiene su prueba entre empresas. En las pruebas, VROOM se reemplaza por una respuesta armada a mano; la prueba contra el servicio real corre con `ROUTING_REAL=1`.

## PWA
- **En Paquetes › Pendientes**, con la jornada iniciada y más de un pendiente: "Armar mi ruta" y "Editar orden".
- **El orden** se aplica a la lista y a la **próxima parada** de la jornada. Se muestra el resumen: "Ruta armada · 4,5 km · unos 15 min de manejo".
- **Editar orden:** botones Subir y Bajar, accesibles y sin arrastrar. El orden a mano queda en el teléfono y se envía por la cola, aunque no haya señal; vale el último.
- **Sin señal no se puede armar la ruta, porque se calcula en el servidor:** la app lo dice y ofrece ordenar a mano.

## Pendiente
- **Producción:** un servidor para OSRM y VROOM con los datos de la región de cada empresa. Para Argentina entera hacen falta varios GB de memoria al procesar.
- **Ventanas horarias y capacidad del vehículo:** VROOM las soporta, pero faltan los datos.
- **Re-armar la ruta en el camino:** hoy se arma cuando el repartidor la pide.

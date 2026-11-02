# Resumen de la noche — 02/11/2026

Etapa 1 completa, desde `main`: las 9 partes del pedido, una rama y un pull request por parte. **No se fusionó nada.**

## Pull requests

Las ramas están **apiladas**: cada una sale de la anterior y su PR apunta a la anterior. Así cada PR muestra solo su parte (ADR-009). Se revisan y fusionan en orden, de #2 a #11. Al fusionar uno, el siguiente se cambia de base a `main`.

| # | Parte | Rama | ADR | CI |
|---|---|---|---|---|
| [#2](https://github.com/copocam8-del/RoutControl/pull/2) | CI (GitHub Actions) | `etapa-1/ci` | 009 | ✅ |
| [#3](https://github.com/copocam8-del/RoutControl/pull/3) | Seguridad: RLS en usuarios, login SECURITY DEFINER, cierre automático con Celery, recuperación del token, auditoría | `etapa-1/seguridad` | 010 | ✅ |
| [#4](https://github.com/copocam8-del/RoutControl/pull/4) | Paquetes en el backend | `etapa-1/paquetes` | 011 | ✅ |
| [#5](https://github.com/copocam8-del/RoutControl/pull/5) | Importación CSV/Excel | `etapa-1/importacion` | 012 | ✅ |
| [#6](https://github.com/copocam8-del/RoutControl/pull/6) | App: Mis paquetes y ficha (foto sin conexión, Llamar, WhatsApp, Navegar, cronómetro) | `etapa-1/app-entregas` | 013 | ✅ |
| [#7](https://github.com/copocam8-del/RoutControl/pull/7) | Carga con escaneo continuo (varios códigos por cuadro, sin repetir, carga manual) | `etapa-1/escaneo` | 014 | ✅ |
| [#8](https://github.com/copocam8-del/RoutControl/pull/8) | "Armar mi ruta" con OSRM + VROOM (recorte AMBA), orden editable | `etapa-1/ruta` | 015 | ✅ |
| [#9](https://github.com/copocam8-del/RoutControl/pull/9) | Panel: paquetes (alta, importación, asignación), entregas e incidencias con fotos | `etapa-1/panel-paquetes` | 016 | ✅ |
| [#10](https://github.com/copocam8-del/RoutControl/pull/10) | Panel: mapa en vivo por WebSocket | `etapa-1/mapa-en-vivo` | 017 | ✅ |
| [#11](https://github.com/copocam8-del/RoutControl/pull/11) | App: mapa sin conexión de la zona de los paquetes | `etapa-1/mapa-sin-conexion` | 018 | ver el PR |

La parte 8 se partió en dos PR (#9 y #10) para que el mapa en vivo, que suma Channels y Redis, se revise aparte. Este resumen va en la rama de #11.

## Cómo quedó

- **Pruebas antes de cada push:**

  | Parte | Pruebas |
  |---|---|
  | Backend | 256 pasadas, 1 omitida: la que necesita OSRM/VROOM reales, que se corrió aparte y pasó |
  | domain | 36 |
  | ui | 253 |
  | admin | 42 |
  | driver | 151 |

  El typecheck y las dos builds pasan.
- **Aislamiento entre empresas:** cada endpoint nuevo tiene su prueba en `tests/tenancy/test_isolation_endpoints.py`, y la prueba falla si aparece una URL sin cubrir. El WebSocket tiene las suyas en `tests/live`.
- **Maquetas:** las pantallas nuevas siguen las de `docs/diseno/` (tarjetas, chips, tablas, progreso), en oscuro y en claro con los tokens del tema. Lo que no tenía maqueta se armó con esas mismas piezas y está anotado en cada ADR.
- **Datos:** no se inventaron datos. Las pruebas usan datos marcados "(prueba)" o "(demo)". Las mediciones de mapa y ruta usan puntos públicos de referencia (Obelisco, Congreso, etc.), no direcciones de clientes.
- **Probado de verdad**, levantando los servidores y apagándolos al terminar:
  - **OSRM + VROOM con el recorte de AMBA:** VROOM ordenó paradas reales de CABA, también desde el backend por la red de compose.
  - **Mapa en vivo:** con Redis y daphne. El dueño de Norte recibió la ubicación de un repartidor de Norte y el de Sur no recibió nada. Un repartidor que intentó suscribirse recibió el cierre 4403.
  - **Mapa sin conexión:** descarga con el `amba.pmtiles` del proyecto.

    | Zona | Teselas | Tamaño |
    |---|---|---|
    | Microcentro | 49 | 3,6 MB |
    | CABA de punta a punta | 214 | 11,4 MB |
- **Servidores:** al terminar no queda ningún servidor ni túnel prendido. Solo sigue la base `db` de Docker, que ya estaba levantada.

## Lo que hay que saber

- **Base local:** la primera corrida de la prueba del WebSocket **cerró una jornada que estaba abierta** de `repartidor1@norte.demo`. Había empezado a las 21:32 del 01/11 y se cerró a las 05:43.
  - **Qué pasó:** el script pidió iniciar una jornada, el servidor respondió que ya había una en curso, y el script cerró esa en lugar de la propia.
  - **Alcance:** es solo la base de desarrollo, no se tocó nada más. La segunda corrida usó `repartidor4@norte.demo`, con una jornada propia que abrió y cerró.
  - **Qué hacer:** si esa jornada importaba para alguna prueba tuya, quedó cerrada con cierre manual ("driver"). No la reabrí a mano.
- **Directorio vacío borrado:** en `map-data/` había un directorio vacío `routing;C`, que quedó de una conversión de rutas de Git Bash al preparar OSRM. Lo borré.
- **CI:** al preparar la seguridad apareció una prueba que fallaba cerca de la medianoche, por la fecha. Se corrigió en `etapa-1/ci` con un commit normal, sin forzar el push.

## Pendiente y por qué

**Necesita un teléfono o un navegador real** (esta noche no hubo dispositivo):
- Probar en Android y iPhone físicos:
  - el escaneo con etiquetas y luz reales (ADR-014);
  - la foto sin conexión (ADR-013);
  - el mapa sin conexión en modo avión (ADR-018), incluido que Safari no borre IndexedDB.
- La revisión visual, en oscuro y en claro, de las pantallas nuevas del panel (paquetes, importación, entregas, incidencias y el chip "En vivo"). Están verificadas con pruebas, no a ojo (ADR-016 y 017).

**Necesita una decisión o datos del cliente:**
- Plantillas de mapeo de la importación: primero hay que ver archivos reales (ADR-012).
- Tipos de incidencia que el repartidor reporta por su cuenta. Hoy una visita "No entregado" abre la incidencia (ADR-016).
- Ventanas horarias y capacidad del vehículo para la ruta (ADR-015).
- Firma de quien recibe, si la piden (ADR-013).
- Un mapa con las paradas del día en la app. Necesita maqueta (ADR-018).

**Infraestructura para producción:**
- Almacenamiento de fotos (S3 o R2) y su retención (ADR-013).
- Servidor de OSRM/VROOM con los datos de cada región (ADR-015).
- Servidor ASGI (daphne/uvicorn) con un proxy que deje pasar WebSocket; hoy la imagen corre `runserver` (ADR-017).
- Celery worker + beat corriendo, para el cierre automático de jornadas (ADR-010).

**Mejoras anotadas, sin urgencia:**
- Paginación de paquetes en el panel (hoy, los últimos 500) y edición del paquete desde el panel (ADR-016).
- Geocodificación de las direcciones importadas e importaciones grandes en segundo plano (ADR-012).
- Limpieza de los datos locales de la app al cerrar sesión (ADR-018).
- Lo que ya estaba en `docs/pendientes-etapa-1.md`: acceso de soporte auditado, revocación inmediata del access token, refresh entre pestañas, particionado de puntos, etc. Las partes hechas esta noche están tachadas.

# ADR-018: Mapa sin conexión (las calles de la zona de los paquetes del día)

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:**
  - el mapa de la app es autoalojado (ADR-008): un PMTiles de AMBA servido por rangos, que necesita red;
  - en la calle la señal se corta;
  - el pedido es guardar en el teléfono las calles de la zona de los paquetes del día;
  - no hay maqueta para esto.

## Decisión
- **Qué zona:**
  - el rectángulo que contiene las direcciones de "Mis paquetes" que tienen ubicación, con **1 km de margen** para cada lado, recortado a los límites del mapa (AMBA);
  - las teselas van de zoom 0 a **15**, el máximo del archivo; a ese zoom se ven las calles con nombre;
  - si la zona es muy grande, se baja el zoom máximo hasta entrar en **1000 teselas**. Medido con `amba.pmtiles`, una tesela pesa unos 53 KB, así que el tope es de unos 50 MB.
  - la cuenta está en `packages/domain/src/tiles.ts`, con sus pruebas.
- **Dónde se guarda:**
  - en IndexedDB (`mapTiles`, Dexie v3), por `z/x/y`;
  - el TileJSON (los límites del mapa) se guarda con la información de la zona.
  - **no** se usa el caché del Service Worker: las teselas se piden por rango (ADR-008) y así la app puede reemplazarlas o borrarlas sin riesgo.
- **Cómo lo usa el mapa:** el protocolo `pmtiles://` de MapLibre está envuelto (`packages/ui/src/map/offline.ts`):
  - **primero busca la tesela guardada** y, si no está, va a la red. Así además ahorra datos móviles;
  - sin red, el TileJSON sale de lo guardado.
  - el almacén se registra antes de cargar el mapa (`loadMapModule`), así que hasta la primera tesela sale del teléfono.
- **Lo demás que el mapa necesita sin red:**
  - las fuentes (Noto Sans Regular, Medium e Italic, en los rangos de caracteres del español) y los íconos (oscuro y claro) se piden al guardar, y quedan en el caché del Service Worker (`rc-map-assets`, CacheFirst);
  - el código del mapa (MapLibre, su worker y TrackMap) ahora también se guarda (`rc-map-code`, CacheFirst). Sigue sin ir en la instalación (ADR-008: datos móviles).
- **Una sola zona:** al guardar otra, se borran las teselas que ya no entran.
- **Cuándo:**
  - **lo pide el repartidor**, con el botón "Guardar el mapa de la zona", porque puede estar con datos móviles. La tarjeta recomienda hacerlo con Wi-Fi;
  - si después le asignan paquetes fuera de la zona, la tarjeta lo avisa ("Hay N paquetes fuera de la zona guardada") y ofrece "Actualizar el mapa guardado".
- **Interfaz:**
  - una tarjeta "Mapa sin conexión" al final de "Mis paquetes", con el mismo lenguaje que las tarjetas de la jornada (`stop-card` y la barra de progreso de Jornada.dc.html), en oscuro y en claro con los tokens del tema;
  - muestra el avance con "Cancelar" y, al terminar, "Guardado a las hh:mm · N MB. Funciona sin señal.";
  - si ningún paquete tiene ubicación, no aparece.

## Verificado
- **Pruebas:**
  - cuenta de teselas;
  - protocolo con lo guardado primero y el TileJSON sin red;
  - descarga, cancelación y reemplazo de la zona;
  - aviso de paquetes fuera de la zona;
  - error sin señal sin perder lo guardado;
  - la tarjeta en "Mis paquetes".
- **Medición real** con el `amba.pmtiles` del proyecto, el mismo código de descarga y puntos públicos de referencia:

  | Zona | Teselas | Tamaño | Tiempo de lectura local |
  |---|---|---|---|
  | Microcentro | 49 | 3,6 MB | 0,2 s |
  | Palermo–Belgrano | 66 | 3,8 MB | 0,1 s |
  | CABA de Retiro a Liniers | 214 | 11,4 MB | 0,3 s |

## Pendiente
- **Probarlo en un teléfono real en modo avión**, en Android y iPhone. Esta noche no hubo dispositivo. En particular falta confirmar que Safari no borre IndexedDB: con la PWA instalada no debería.
- **Un mapa con los paquetes del día.** Hoy el único mapa de la app es "Mis recorridos" (que ya usa lo guardado). Las paradas en un mapa necesitan maqueta.
- Las teselas se guardan sin comprimir, que es como las entrega `pmtiles`. Guardarlas comprimidas ocuparía menos, a cambio de descomprimir al mostrar.
- Ni el mapa ni los paquetes se borran al cerrar sesión. Hay que definir una limpieza general de los datos locales.

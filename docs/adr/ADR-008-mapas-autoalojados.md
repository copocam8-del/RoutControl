# ADR-008: Mapas de OpenStreetMap autoalojados, navegación externa y optimización de ruta propia

- **Estado:** aceptado (decisiones del cliente del 01/11/2026)
- **Fecha:** 01/11/2026
- **Contexto:**
  - El mapa de "Mi recorrido" no cargaba en Android: mostraba "No se pudo cargar el mapa".
  - El estilo y las teselas venían de `tiles.openfreemap.org`, otro dominio que los bloqueadores (como el de Brave) pueden frenar y que no sirve sin conexión.
  - §5.5 y §15.3 ya proponían PMTiles de OSM autoalojado.

## Decisiones del cliente
1. **El mapa de las apps usa OpenStreetMap servido desde nuestro propio origen** (PMTiles autoalojado), sin depender de `tiles.openfreemap.org` ni de otro dominio. Con esto se arregla el mapa en Android con Brave y queda listo para funcionar sin conexión.
2. **El botón "Navegar" abre Google Maps o Waze con la dirección** mediante enlaces externos, sin API de Google (no hay clave ni costo). Llega con las paradas en la etapa 1.
3. **La optimización de ruta ("Armar mi ruta") pasa de la etapa 2 a la etapa 1**, con **OSRM** (ruteo) y **VROOM** (optimización) autoalojados.

## Implementación del punto 1 (etapa 0)

| Pieza | Dónde | Cómo |
|---|---|---|
| Teselas | `/map/amba.pmtiles` | Recorte de la zona AMBA (oeste −58,75, sur −34,90, este −58,20, norte −34,45; zoom 0–15; unos 31 MB) del build diario de OpenStreetMap de Protomaps, hecho con `scripts/map/extract-region.mjs`. No va en git: se regenera (`scripts/map/README.md`) |
| Fuentes del mapa | `/map/fonts/` | Glifos Noto Sans (latín), en git (alrededor de 1 MB) |
| Íconos | `/map/sprites/dark*` | Sprites del estilo oscuro de Protomaps, en git |
| Estilo | En el navegador | `@protomaps/basemaps` con los colores de las maquetas (`packages/ui/src/map/style.ts`) |
| Lectura | En el navegador | Librería `pmtiles` (protocolo `pmtiles://`, pedidos por rango) |
| Worker de MapLibre | `/assets/maplibre-gl-worker-[hash].mjs` | Se publica con la app y se indica con `setWorkerUrl` |
| Servidor | Vite (desarrollo y vista previa) | `scripts/map/vite-plugin.ts` sirve `/map/` con soporte de rangos. Al compilar, copia `map-data/` a `dist/map/`. En producción lo sirve el mismo hosting estático o nginx |

### Causa real del error en Android
MapLibre v6 busca su worker en un archivo aparte, junto a su propio código. Al empaquetar, ese archivo no se copiaba a la compilación.
- El pedido a `/assets/maplibre-gl-worker.mjs` devolvía la página de la app (HTML, código 200) en lugar del JavaScript.
- Por eso el mapa no podía arrancar en **ningún** navegador. Se verificó por el túnel: `200 text/html`.
- Ahora el worker se publica con su propio nombre con hash, así que nunca puede quedar una versión vieja.

### Service Worker de la PWA
- **El mapa no se guarda al instalar:** no se precachean ni `map/**` ni el worker de MapLibre.
- **Fuentes e íconos:** se guardan la primera vez que se usan (`CacheFirst`, caché `rc-map-assets`). Su URL no cambia sin cambiar el contenido.
- **Teselas (`.pmtiles`):** se piden por rango y van siempre a la red. El Service Worker no las intercepta, así que no puede devolver una versión vieja o rota.
- **`/map/` queda fuera del `navigateFallback`:** no se responde con la página de la app.
- **Pendiente para el uso sin conexión completo:** guardar la zona del recorrido (§5.5, etapa 1).

### Errores, para soporte
- **Registro:** cada error del mapa (mensaje, recurso, URL y código HTTP) queda en `localStorage` (`rc-map-errors`, los últimos 10). Se ve en **Perfil › Diagnóstico › Mapa** y se puede borrar.
- **Recursos:** el recurso se nombra en palabras: teselas (PMTiles), fuentes del mapa, íconos del mapa, worker de MapLibre o WebGL del navegador.
- **El mensaje distingue dos casos:**
  - **"Sin conexión":** el teléfono no tiene red, o ni nuestro propio servidor responde.
  - **"No se pudo cargar el mapa":** el servidor responde, pero algo falló (bloqueo, archivo roto, error HTTP, sin WebGL).

  El detalle técnico se puede abrir en la misma pantalla.

### Verificación
- **Pruebas automáticas:**
  - el estilo no tiene URLs de otros dominios, salvo el enlace a la licencia de OSM;
  - las fuentes que pide el estilo existen en `map-data/fonts`;
  - el servidor de `/map/` responde rangos (206) y no deja salir de la carpeta;
  - la clasificación de "sin conexión" y el registro de errores;
  - la pantalla de Diagnóstico muestra el error.
- **Chrome de escritorio en modo celular Android, por el túnel:** login, "Recorridos" y un recorrido con mapa. Se ven calles y nombres de OpenStreetMap y no hay errores. En el panel, la tabla de jornadas con su mapa.

### iPhone (Safari / WebKit), revisado el 01/11/2026
Se probó con WebKit de Playwright emulando un iPhone 15, por el túnel, con el Service Worker ya activo y controlando la página, como la PWA instalada:

| Causa típica de Safari | Resultado |
|---|---|
| Pedidos por rango del PMTiles | `206` con `Content-Range` y `Accept-Ranges` por el túnel. Van a la red: el Service Worker no los intercepta |
| Worker de MapLibre y CSP | El worker es un módulo del mismo origen (sin `blob:`). La app no manda `Content-Security-Policy` |
| WebGL | WebGL y WebGL2 disponibles. Sin WebGL (por ejemplo, con el Modo de aislamiento de iOS), el error dice "WebGL del navegador" |
| Altura del contenedor | 359 × 360 px (alto fijo en línea) |

**Causa probable en el iPhone:** seguía corriendo la versión vieja guardada por el Service Worker, la del worker roto.
- La versión nueva solo se instalaba si se aceptaba un `confirm()`.
- En iOS la PWA instalada casi nunca se cierra del todo, así que la versión vieja podía quedar indefinidamente.

**Cambio:**
- Sin jornada en curso, la versión nueva se instala sola.
- Durante la jornada, un aviso ofrece "Actualizar", y se instala sola al finalizar.
- También se buscan versiones nuevas al volver a la app y cada 30 minutos.
- En Diagnóstico se ve la fecha de la "Versión instalada".

## Consecuencias
- **Sin terceros:** no hay dependencia de un proveedor de teselas ni de su disponibilidad o sus condiciones de uso.
- **Zona cubierta:** el mapa muestra solo la zona recortada. Para otra ciudad hay que generar su PMTiles y configurar `VITE_MAP_PMTILES_URL`. En la etapa 1 conviene un PMTiles por región de cada empresa, o uno de Argentina, de unos pocos GB.
- **Atribución obligatoria:** "© OpenStreetMap" se muestra en el mapa (licencia ODbL).
- **OSRM y VROOM (etapa 1):** son dos servicios más en Docker, con los datos de OSM de la misma región. Ruteo y optimización sin costo por pedido.

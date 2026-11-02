# ADR-019: Mapa de entregas en la app

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:**
  - para ver dónde quedan las entregas del día, la app mandaba a Google Maps o Waze;
  - el pedido es un mapa propio, con el OpenStreetMap autoalojado (ADR-008), que funcione sin conexión con la zona guardada (ADR-018);
  - el pedido nombra `docs/diseno/Ruta.dc.html` como referencia para los pines numerados. **Ese archivo no está en el repositorio ni en las carpetas del proyecto**, así que se siguieron las maquetas más cercanas:
    - `Recorrido.dc.html`: el mapa, las píldoras de la leyenda y el botón cuadrado;
    - `Jornada.dc.html`: el número de parada en un cuadrado redondeado, la tarjeta de la próxima parada y los botones Llamar, WhatsApp y Navegar.

## Decisión
- **Pestaña "Mapa"** en la barra inferior: Inicio, Paquetes, **Mapa**, Recorridos y Perfil. Recorridos pasa a un ícono de recorrido, y el del mapa queda para Mapa.
  - Con cinco pestañas, el texto baja a 11 px para que "Recorridos" entre en un teléfono de 360 px.
- **Casitas:** una por domicilio (techo a dos aguas y una punta abajo que marca el lugar), con el **número de parada** adentro.
  - **Colores:**

    | Estado | Color | Estados del paquete |
    |---|---|---|
    | Pendiente | violeta | `ASSIGNED` o `IN_ROUTE` |
    | Entregado | verde | `DELIVERED` |
    | No entregado | amarillo | `FAILED` |
    | Segundo intento | violeta claro | `RESCHEDULED` (reprogramado, vuelve a salir) |

    Cada color tiene su par para oscuro y para claro, y el número usa un color de texto con contraste sobre cada uno.
  - **Número:** es el mismo orden que la lista de "Mis paquetes": primero las paradas de la ruta y después el resto. Un paquete sin ubicación no tiene casita, pero cuenta para el número, así que coincide con la lista.
  - Los paquetes cancelados y los devueltos no se muestran.
- **Filtro rápido:** "Pendientes · N" (lo que falta visitar: pendientes y segundos intentos) y "Todas · N". Por defecto, Pendientes.
- **Línea de la ruta:** si hay ruta armada, se dibuja **por las calles** en el orden sugerido.
  - El backend ya le pedía la geometría a VROOM (`g: true`), pero no la guardaba. Ahora cada parada guarda el tramo desde la anterior (`RouteStop.path`, una polilínea codificada; migración `0004`). El tramo sale de cortar la línea de VROOM en el punto más cercano a cada parada, buscando siempre hacia adelante.
  - `GET /route` devuelve `path` por parada. La app lo guarda con la ruta, así que la línea **también se ve sin conexión**.
  - Si el orden se armó a mano, no hay tramo por calles: se dibuja una **recta punteada** entre paradas, como pista del orden y no del camino.
  - Las rutas armadas antes de este cambio no tienen tramos: se ven punteadas hasta que se vuelvan a armar.
- **Mi ubicación** es un punto azul con un halo, y **solo aparece con la jornada en curso**. La regla del producto es que la ubicación se usa desde que se inicia hasta que se finaliza la jornada (CLAUDE.md), y se aplica también a mostrarla.
  - Sin jornada, "Centrar en mi ubicación" queda deshabilitado y la leyenda lo explica.
  - La ubicación del mapa no se guarda ni se envía: eso lo hace el seguimiento de la jornada.
- **Tarjeta:** al tocar una casita, sube una tarjeta abajo con el estilo de la "Próxima parada" de Jornada.dc.html. Muestra:
  - el número;
  - la dirección;
  - el destinatario;
  - el estado;
  - la distancia en línea recta desde mi ubicación, si hay ("a 650 m"; no es la distancia de manejo);
  - los botones **Ver ficha** y **Navegar**.

  El mapa se corre para que la casita quede arriba de la tarjeta, y tocar el mapa la cierra.
- **Navegar:** la primera vez pregunta si abrir con **Google Maps o Waze** y lo recuerda en el teléfono (IndexedDB). Se cambia en **Perfil › Navegar con**, con el mismo control que la apariencia.
  - Es la misma lógica en la tarjeta del mapa y en la ficha.
  - Ya elegida la app, "Navegar" es un enlace directo: un toque abre la navegación.
- **Botones flotantes:** "Centrar en mi ubicación" y "Ver todas las paradas". Al encuadrar, se deja lugar a los chips de arriba, a los botones de la derecha y a lo que tapa abajo (barra, leyenda o tarjeta).
- **Ficha de entrega:** arriba va el **mapa real**, chico (150 px) y sin arrastre, con la casita del domicilio y su número. Debajo siguen Llamar, WhatsApp y Navegar. Si el paquete no tiene ubicación, no hay mapa.
- **Sin conexión:** los dos mapas se cargan con `loadMapModule` (ADR-018), así que las calles salen primero de la zona guardada en el teléfono.
- **Componente:** `StopsMap` en `@routcontrol/ui/map`. A diferencia de los otros mapas, se crea una sola vez y después actualiza en el lugar las casitas, la línea y el punto azul: la ubicación cambia seguido y recrear el mapa haría parpadear todo.

## Verificado
- **Pruebas:**
  - **domain:** número y estado de las casitas, filtro, tramos por calles y rectas, decodificación de polilíneas (con el ejemplo de la documentación del formato) y distancias.
  - **ui:** casitas.
  - **driver:**
    - la pestaña, el filtro y la tarjeta;
    - Ver ficha;
    - Navegar la primera vez, cuando ya está recordado y al cambiarlo en Perfil;
    - mi ubicación solo con jornada;
    - la línea de la ruta armada;
    - el mapa de la ficha arriba de los botones.
  - **backend:** cada parada guarda su tramo, y el orden a mano no tiene tramo. Hay una prueba **contra OSRM y VROOM reales** (`ROUTING_REAL=1`, corrida y en verde): la línea por calles se corta en un tramo por parada y cada uno termina a menos de ~200 m de su parada.
- **WebKit** (el motor de Safari) emulando un iPhone, con los 7 paquetes de demo de `repartidor4`, en oscuro y en claro:
  - se vieron las casitas, los chips, la leyenda, la tarjeta y el mapa de la ficha;
  - **apareció un error y se corrigió:** al actualizar una casita se pisaban las clases que MapLibre le pone al marcador, y las casitas se corrían en pantalla 36 px por cada una anterior. Tiene su prueba.

## Pendiente
- Ver la **línea de la ruta** en un teléfono real: en el navegador no se armó una ruta para no iniciar jornadas en los datos de demo, y está verificada con pruebas.
- **Ruta.dc.html:** si existe, sumarla a `docs/diseno/` y ajustar las casitas a esa maqueta.
- Cuando muchas casitas se superponen (edificios con varios paquetes), agruparlas.

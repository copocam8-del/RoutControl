# ADR-020: Paradas más llamativas en el mapa

- **Estado:** aceptado
- **Fecha:** 02/11/2026
- **Contexto:** con el mapa de entregas ya probado (ADR-019), el pedido fue hacer las paradas más llamativas, destacar la próxima, apagar las entregadas y darle un pulso a mi ubicación, todo legible en oscuro y en claro y respetando "reducir movimiento".

## Decisión
- **Número grande, sin casita adentro.** A 40 px, el número de parada es lo que el repartidor busca de un vistazo. Una casita con el número en un globito lo achicaría a unos 10 px, difícil de leer en la calle. Se mantiene el estilo de Ruta.dc.html: círculo, borde blanco y número en negrita.
- **Paradas:**
  - círculo de unos 41 px (34 px más 3,5 px de borde blanco de cada lado);
  - número de 17 px;
  - sombra oscura, que despega la parada del mapa, sobre todo en claro;
  - un halo y un brillo suave del color del estado (`color-mix`).
- **Próxima parada:**
  - círculo de unos 52 px con número de 21 px;
  - **dos anillos que laten** del color del estado, desfasados un segundo;
  - **etiqueta "Próxima"** arriba, con borde blanco.

  Es la misma que muestra Inicio. Ahora las dos pantallas usan `nextPackage`: primero la visita en curso; si no hay, la primera parada en camino; si no, el primer pendiente, en el orden de la ruta.
- **Entregadas:** más chicas (unos 29 px), con borde fino, sin brillo y apagadas (opacidad 0,72 y menos saturación). Quedan debajo de las demás. Si se elige una, recupera el color.
- **Mi ubicación:** un punto azul de 20 px con borde blanco, un brillo azul y un **pulso** que se expande y desaparece.
- **Reducir movimiento:** no hay caída al aparecer, ni anillos que laten, ni pulso. Se ven fijos un anillo alrededor de la próxima parada y un halo alrededor de mi ubicación, así se siguen distinguiendo.
- **Encuadre:** al ser más grandes las paradas (y con la etiqueta), los márgenes del encuadre crecen para que la próxima no quede cortada en el borde.
- **Pruebas:** el tiempo máximo por prueba de la app sube a 15 s. Muchas recorren la app entera (login, jornada, paquetes) y, con la compu cargada (servidores prendidos y poca RAM libre), pasaban los 5 s por defecto sin ningún error real.

## Cierre (02/11/2026)
- **Paradas superpuestas** (lo que había quedado pendiente en ADR-019): las que en pantalla quedan una encima de otra, por estar en el mismo edificio o muy cerca con poco zoom, se **abren en círculo** alrededor de su lugar, con unos 40 px entre vecinas. Así se ven y se pueden tocar todas.
  - Se recalcula con cada zoom. Al acercarse, vuelven a su lugar exacto.
  - Es un desplazamiento de la parada en pantalla: la coordenada no cambia.
- **Leyenda:** suma "Próxima" cuando hay una.

## Verificado
- **Pruebas:**
  - la próxima parada tiene su clase, su etiqueta y sus anillos, y deja de ser próxima al actualizarse;
  - el mapa marca como próxima la misma parada que Inicio;
  - la regla de `nextPackage`: visita en curso, en camino, primero de la ruta, y sin pendientes.
- **WebKit, emulando un iPhone, en oscuro y en claro:**
  - el mapa con los paquetes de demo;
  - un muestrario con el CSS real de la app: todos los estados, la próxima, la elegida y mi ubicación, con y sin "reducir movimiento".
  - con los datos de demo, las paradas 2 y 6, a unos 250 m entre sí, quedaban encimadas; ahora se ven separadas.
- **Pruebas de la apertura en círculo:** las sueltas no se mueven, y ninguna queda tapada, aun con 8 en el mismo lugar.

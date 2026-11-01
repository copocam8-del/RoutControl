# Diseño aprobado de la app (01/11/2026)

Maquetas aprobadas por el cliente. Son la referencia visual **obligatoria** para la PWA del repartidor y el panel. Reemplazan el diseño azul/violeta claro anterior (ADR-007).

Cada `.dc.html` es una pantalla: el HTML y los estilos en línea son la especificación exacta (colores, tamaños, espaciados, radios, sombras y animaciones). Para verlas, abrir el archivo en un navegador (el script `support.js` no existe fuera del lienzo, así que lo que use `{{...}}` no se completa, pero el diseño se ve).

| Archivo | Pantalla |
|---|---|
| `Main.dc.html` | Bienvenida animada (logo, ruta que se dibuja, nombre y lema) → después pasa al login |
| `Login.dc.html` | Ingresar |
| `Inicio.dc.html` | Inicio sin jornada |
| `Jornada.dc.html` | Jornada en curso |
| `Recorrido.dc.html` | Mi recorrido (mapa) |
| `PanelBienvenida.dc.html` | Panel: bienvenida animada (igual que la app, en grande) → pasa al login |
| `PanelLogin.dc.html` | Panel: ingresar (panel violeta con recorrido animado a la izquierda, formulario a la derecha) |
| `Panel.dc.html` | Panel: inicio |
| `PanelJornadas.dc.html` | Panel: jornadas (día, filtros, tabla y recorrido de la fila elegida) |
| `PanelRepartidores.dc.html` | Panel: repartidores (buscador y una tarjeta por repartidor) |

## Tokens

| Token | Valor |
|---|---|
| Fondo | `#070B1F` |
| Superficie | `#11183A` (tarjetas), `#1A2350` (chips y botones secundarios), `#0B1130` (barra lateral del panel), `#0C1230` (mapa) |
| Bordes | `#1F2860`, `#2A3470` (tarjetas); `#5A67B0` en campos de formulario (contraste 3:1) |
| Texto | `#F3F5FF` (principal), `#D5DBF7` (secundario fuerte), `#A3AED6` (secundario) |
| Acción principal | violeta `#7C5CFF` con sombra `0 12px 32px rgba(124,92,255,.40)` |
| Acento | violeta claro `#A78BFA` / `#C4B5FD`, azul `#4D8DFF` / `#7FB0FF` |
| Marca | degradado `linear-gradient(140deg, #4D8DFF, #7C5CFF)` solo en el logo, avatares y la tarjeta destacada |
| Estados | éxito `#34D399` / `#6EE7B7`, atención `#FBBF24` / `#FCD34D`, sin datos (huecos) `#FB923C` |
| Recorrido en el mapa | `#8B5CF6`, huecos naranja punteado |
| Tipografía | Plus Jakarta Sans 400–800 (empaquetarla con la app para que funcione offline) |
| Radios | 16 px campos, 18 px botones y tarjetas chicas, 24 px tarjetas grandes y barra inferior |
| Alturas | acción principal 60–64 px, campos 56 px, botones secundarios 56 px |

Los datos de las maquetas (nombres, números, direcciones entre corchetes) son de ejemplo: en la app van los datos reales.

## Panel (aprobado el 01/11/2026, 19:50)

El panel usa solo datos que el sistema ya tiene en la etapa 0 (jornadas, ubicaciones, señal), así que se implementa **igual** a las maquetas. La bienvenida y el login del panel siguen las mismas reglas que en la app: la bienvenida dura unos 2 segundos, una vez por apertura, se saltea con un clic y respeta `prefers-reduced-motion`.

## Etapa 1 · Paquetes y visitas (aprobado el 01/11/2026, 20:30)

| Archivo | Pantalla |
|---|---|
| `Paquetes.dc.html` | Mis paquetes: buscador, filtros por estado y lista por número de parada |
| `Escanear.dc.html` | Cargar paquetes: **escaneo continuo**. Se pasa el celular por encima de la pila y cada código se suma solo (varios por cuadro si entran), sin repetir. Contador, barra de avance, últimos cargados y "Armar mi ruta" |
| `Ruta.dc.html` | Tu ruta está lista: orden sugerido desde la ubicación actual, mapa con paradas numeradas, totales, "Cambiar orden" y "Empezar ruta" |
| `Ficha.dc.html` | Ficha de entrega **con el resultado ahí mismo**: Entregado / No entregado; si no se entregó, motivos y foto; "Guardar y seguir a la parada N". "Llegué: iniciar visita" queda como opción para medir el tiempo |
| `Visita.dc.html` | Visita en curso con cronómetro |
| `Resultado.dc.html` | Resultado de la visita (lista completa de motivos, observaciones y foto) |

Pedidos del cliente: (1) registrar el resultado desde la ficha; (2) cargar todos los paquetes juntos y que la app arme la mejor ruta, en lugar de escanear de a uno. La optimización de ruta estaba en la etapa 2 de la planificación: pendiente de decidir si se adelanta a la etapa 1.

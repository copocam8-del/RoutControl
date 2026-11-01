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
| `Panel.dc.html` | Panel de administración: inicio |

## Tokens

| Token | Valor |
|---|---|
| Fondo | `#070B1F` |
| Superficie | `#11183A` (tarjetas), `#1A2350` (chips y botones secundarios), `#0B1130` (barra lateral del panel), `#0C1230` (mapa) |
| Bordes | `#1F2860`, `#2A3470` |
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

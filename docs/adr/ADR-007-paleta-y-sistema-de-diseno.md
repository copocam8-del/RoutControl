# ADR-007: Tema oscuro y modo claro, azul y violeta, y sistema de diseño en `packages/ui`

- **Estado:** aceptado (versión 3)
- **Fecha:** 01/11/2026
- **Historial:**
  - **v1** (01/11/2026, a la mañana): tema claro con azul `#1D4ED8` como color principal y violeta `#6D28D9` como acento, fuente Inter.
  - **v2** (01/11/2026, a la noche): **reemplaza a la v1.** El cliente aprobó las maquetas de `docs/diseno/`: tema oscuro, violeta `#7C5CFF` para las acciones principales y Plus Jakarta Sans.
  - **v2.1** (01/11/2026): maquetas del panel aprobadas (`PanelBienvenida`, `PanelLogin`, `Panel`, `PanelJornadas`, `PanelRepartidores`) y borde de los campos en `#5A67B0`.
  - **v3** (01/11/2026): **modo claro** y selector de apariencia (Oscuro, Claro o Automático).
- **Contexto:** las maquetas aprobadas (`docs/diseno/README.md` y los `.dc.html`) son la especificación visual obligatoria de la PWA y del panel: colores, tamaños, espaciados, radios, sombras y animaciones.

## Decisión

### Tokens
Son los del README de las maquetas, sin cambios. Las cifras y los contrastes están en §10.1 de la planificación. En resumen:
- **Fondos:** `#070B1F` en las pantallas y `#11183A` en las tarjetas. Los chips y los botones secundarios van en `#1A2350`.
- **Texto:** `#F3F5FF`, `#D5DBF7` y `#A3AED6`.
- **Acción principal:** violeta `#7C5CFF`, con sombra violeta.
- **Acentos:** violeta claro y azul.
- **Marca:** el degradado de marca va solo en el logo, los avatares y la tarjeta destacada.
- **Mapa:** el recorrido va en violeta `#8B5CF6` y los huecos en naranja punteado `#FB923C`.
- **Forma:**
  - radios de 16 px en campos, 18 px en botones y tarjetas chicas, y 24 px en tarjetas grandes y en la barra inferior;
  - alturas de 60 a 64 px en la acción principal y 56 px en campos y botones secundarios.

### Lo que agregué y no está en las maquetas
1. **Un violeta más oscuro, `#6B4BF0`** (`primaryStrong`). Lo uso para el botón presionado y para los botones principales chicos (como "Actualizar" en el panel).
   - El texto blanco sobre `#7C5CFF` da 4,3:1. Eso cumple AA para **texto grande** (≥ 18,66 px en negrita), pero no para texto normal.
   - Por eso los botones principales grandes van en `#7C5CFF` con el texto a **19 px en negrita**, 1 px más que en la maqueta, para que sea texto grande.
   - Los botones chicos van en `#6B4BF0`, que da 5,4:1.
2. **Rojo para los errores:** `#F87171` (puntos e íconos) y `#FCA5A5` (texto). Las maquetas no muestran errores; elegí estos tonos dentro de la misma familia de colores.
3. **El mapa en tema oscuro:** OpenStreetMap autoalojado (ADR-008) con el estilo oscuro de Protomaps y los colores de las maquetas, y los controles de MapLibre adaptados.

### Bordes de los campos (resuelto el 01/11/2026)
- Los campos de formulario de la app y del panel usan **`#5A67B0`** (`fieldBorder`): 3,3:1 sobre la tarjeta y 3,7:1 sobre el fondo, como pide WCAG 1.4.11. Lo aprobó el cliente con las maquetas del panel.
- Las tarjetas siguen con `#1F2860` y `#2A3470`, que son decorativas.

### Sistema de diseño (`packages/ui`)

| Pieza | Contenido |
|---|---|
| `tokens.ts` | Colores de las maquetas, degradado de marca, tipografía, espaciados, radios, sombras, alturas y `contrastRatio` |
| `styles.css` | Las mismas variables (`--rc-*`), Plus Jakarta Sans empaquetada (`@fontsource-variable/plus-jakarta-sans`, sin Google Fonts), foco violeta, las clases `rc-` de los componentes, las animaciones (`rc-in`, pulso del botón destacado, punto "en vivo") y `prefers-reduced-motion` |
| Marca | `LogoMark` (el logo de las maquetas, con la ruta animable), `Wordmark` ("Route" + "Control" en violeta), `Brand` y `Avatar` (iniciales) |
| Íconos | Los de las maquetas, con trazo de 2 px |
| Componentes | `Button` (principal, destacado blanco, secundario, fantasma, peligro), `TextField` con ícono y botón interno, `Chip`, `ListItem`, `Card`, `Alert`, `StatusLine`, `Badge`, `Stats` y los estados `LoadingState`, `EmptyState`, `ErrorState` y `Loadable` |
| `useLoad` | Carga con estado único y "Reintentar"; opcionalmente actualiza cada tantos segundos sin volver a mostrar "Cargando…" |
| `@routcontrol/ui/map` | `TrackMap` (el recorrido con la leyenda sobre el mapa) y `PositionsMap` (la última ubicación de cada repartidor, para el panel) |

### Verificación automática
- Cada par texto/fondo está declarado en `contrastPairs`, y una prueba verifica su contraste mínimo.
- Otra prueba verifica que `styles.css` coincide con `tokens.ts`.
- Otra prueba verifica que **cada color de la tabla del README de las maquetas está en `tokens.ts`**.
- Y otra, que la fuente es Plus Jakarta Sans empaquetada (sin Google Fonts).

## Modo claro (v3)

### Selector de apariencia
- **Opciones:** Oscuro (por defecto), Claro o Automático. Automático sigue `prefers-color-scheme` y cambia solo si cambia el sistema.
- **Dónde se elige:** en la PWA, en **Perfil › Apariencia**; en el panel, en el **encabezado**.
- **Cómo se guarda:** por usuario en el dispositivo (`localStorage`, `rc-theme:<usuario>`). Antes de ingresar se usa la última elegida en ese dispositivo (`rc-theme:last`).
- **Sin destellos:** un script en `index.html` pone `data-theme` en `<html>` antes de pintar, así no se ve un destello del otro tema.
- **Implementación:** `packages/ui/src/theme.ts` y `components/ThemeSelector.tsx`.

### Paleta clara (aprobada por el cliente)
`lightColor` en `tokens.ts` y `:root[data-theme="light"]` en `styles.css` (repetido en `@media (prefers-color-scheme: light)` para Automático).

| Uso | Valor |
|---|---|
| Fondo / tarjetas / superficie secundaria | `#F4F6FD` / `#FFFFFF` / `#EDF0FB` |
| Barra lateral del panel | `#FFFFFF` con borde `#DDE2F4` |
| Bordes / bordes de campos | `#DDE2F4` / `#7A85BD` (3,3:1 sobre el fondo, 3,6:1 sobre la tarjeta) |
| Texto principal / secundario fuerte / secundario | `#0B1026` (17,4:1) / `#2E365C` (11,7:1) / `#525B85` (6,1:1) |
| Acción principal | `#6D4AFF` con texto blanco (5,2:1); presionado `#5B3FD9` |
| Violeta para textos y enlaces | `#5B3FD9` (6,7:1) |
| Azul | `#2563EB` |
| Éxito | `#047857` sobre `#D1FAE5` (4,8:1) |
| Atención | `#B45309` sobre `#FEF3C7` (4,5:1) |
| Huecos | `#EA580C` (gráfico, 3,2:1 sobre el mapa); como texto, `#C2410C` |
| Mapa | estilo claro de Protomaps con fondo `#EEF1F8`; recorrido `#7C3AED` (5,0:1) |

### Lo que completé (no estaba en el pedido)
- **Tarjeta destacada:** degradado violeta suave (`#EDE8FF` a `#E4E9FF`) con texto oscuro. Su botón pasa a violeta `#6D4AFF` con texto blanco.
- **Error:** `#DC2626`, y como texto `#B91C1C` sobre `#FEE2E2`.
- **Fondo informativo:** `#EFF6FF`, para que el azul `#2563EB` llegue a 4,5:1 encima.
- **Ilustración del login del panel:** el panel violeta con el recorrido queda oscuro en los dos temas.
- **Variables por tema:** los fondos suaves y las líneas de los estados ya no son transparencias fijas. Ahora son variables por tema (`--rc-success-bg`, `--rc-warning-line`, etc.).

### Verificación automática
- Contraste AA como mínimo en cada par del modo claro (`lightContrastPairs`).
- Las variables del modo claro, en Claro y en Automático, coinciden con `tokens.ts`.
- No quedan transparencias con los colores fijos del tema oscuro.
- Cada color del README de las maquetas está en los tokens.
- El selector guarda la elección por usuario y aplica `data-theme`.
- El mapa usa el estilo y los íconos claros.

## Lo que las maquetas muestran y todavía no existe
Para no poner botones sin función, quedan **fuera hasta la etapa 1**:
- paquetes asignados, entregados y pendientes, y la barra de avance;
- la próxima parada, con Llamar, WhatsApp, Navegar y "Llegué: iniciar visita";
- la pestaña "Paquetes";
- las notificaciones;
- "¿Olvidaste tu contraseña?";
- "Mapa de tu zona guardado";
- "Asignar paquetes" y "En vivo" de la primera maqueta del panel. Las maquetas nuevas del panel ya no los tienen: el inicio se actualiza solo cada 30 s y lo dice ("Actualizado 19:05").

En su lugar se muestran datos reales: el permiso de ubicación, la batería (solo si el navegador la informa), los envíos pendientes, la precisión y la hora de la última ubicación, y en el panel las jornadas finalizadas y las ubicaciones registradas.

## Alternativas descartadas
- **Tailwind o una biblioteca de componentes:** las maquetas usan estilos simples. Con CSS propio y tokens alcanza.
- **La fuente desde Google Fonts:** no funciona sin conexión y suma un tercero.

## Consecuencias
- Las dos apps importan `@routcontrol/ui/styles.css` y usan sus componentes. Lo propio de cada pantalla queda en el CSS de cada app.
- Para agregar un color hay que sumarlo en `tokens.ts` y en `styles.css`, con su par en `contrastPairs`. Si no, las pruebas fallan.
- Los íconos de la PWA (Android, iOS y maskable) se generan desde el logo nuevo con el fondo oscuro de la app.

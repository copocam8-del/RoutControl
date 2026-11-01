# ADR-007: Paleta azul y violeta, y sistema de diseño en `packages/ui`

- **Estado:** aceptado
- **Fecha:** 01/11/2026
- **Contexto:** pedido del cliente: un diseño profesional y amigable para todo el frontend, con **azul como color principal y violeta como acento**, en lugar del ámbar de §10.1 (v0.5). La app del repartidor se usa en la calle y al sol, y el panel en escritorio.

## Decisión

### Paleta
- **Azul 700 `#1D4ED8`** para la acción principal y **azul 950 `#0B1F4D`** para la marca y la barra lateral. El azul transmite confianza y es neutro para un producto B2B.
- **Violeta 700 `#6D28D9`** como acento: el elemento activo, el foco, los destacados y **el recorrido en el mapa**. En el mapa el violeta se distingue del azul del agua y del gris de las calles; el azul se habría confundido con el agua.
- **Neutros fríos** (escala pizarra) y **estados** con texto oscuro sobre un fondo suave, más un color fuerte para íconos y bordes.
- **Contraste:** AA (4,5:1 en texto y 3:1 en componentes de interfaz) es el mínimo. En el texto que se lee en la calle se apunta a **AAA (7:1)**, porque al sol el contraste percibido cae mucho. Por eso el texto "apagado" es `#475569` (7:1) y no el gris `#6B7280` (4,8:1) de la v0.5.
- Las cifras están en §10.1 de la planificación.

### Sistema de diseño (`packages/ui`)

| Pieza | Contenido |
|---|---|
| `tokens.ts` | Colores, tipografía, espaciados (múltiplos de 4 px), radios, sombras, tamaños táctiles (56 px para las acciones de calle, §10.2) y la función `contrastRatio` |
| `styles.css` | Las mismas variables como CSS (`--rc-*`), la base (Inter empaquetada, foco visible violeta) y las clases de los componentes con prefijo `rc-` |
| Componentes | `Button` (primario, acento, secundario, fantasma, peligro; cargando), `TextField`, `Checkbox`, `Card`, `Alert`, `StatusLine` (punto + título + detalle), `Badge`, `Stats`, `LoadingState`, `EmptyState`, `ErrorState` y `Loadable`, que hace mutuamente excluyentes los estados cargando, vacío, error y datos |
| `useLoad` | Carga con estado único y `reload` para "Reintentar"; descarta respuestas viejas |
| Formatos | Duración, distancia, hora, día, cronómetro y "hace X", todos en es-AR |
| `@routcontrol/ui/map` | Mapa del recorrido (MapLibre), compartido entre la PWA y el panel. Va aparte para no arrastrar ~1 MB a la carga inicial |

### Verificación automática
- Cada par texto/fondo que se usa en la interfaz está declarado en `contrastPairs`, y una prueba verifica su contraste mínimo.
- Otra prueba verifica que las variables de `styles.css` coinciden con `tokens.ts` y que no quedó el ámbar.

## Alternativas descartadas
- **Tailwind o una biblioteca de componentes (shadcn, Mantine):** más dependencias y más configuración para dos apps chicas. Con CSS propio y tokens alcanza por ahora; se puede revisar en la etapa 1, cuando el panel crezca.
- **Fuente desde un CDN:** no funciona sin conexión y suma un tercero. Inter va empaquetada (`@fontsource-variable/inter`).

## Consecuencias
- Las dos apps importan `@routcontrol/ui/styles.css` y usan los componentes. Lo propio de cada pantalla queda en el CSS de cada app.
- Un color nuevo se agrega en `tokens.ts` y en `styles.css`, y su par en `contrastPairs`. Si no, las pruebas fallan.

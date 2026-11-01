/**
 * Tokens del sistema de diseño (ADR-007 v2, §10.1 de la planificación).
 *
 * Fuente: las maquetas aprobadas por el cliente el 01/11/2026 (`docs/diseno/README.md`). Tema
 * oscuro, violeta para las acciones principales y azul/violeta claro como acentos.
 *
 * `styles.css` expone estos valores como variables CSS (una prueba verifica que coincidan) y los
 * contrastes de cada par texto/fondo se verifican contra WCAG en `tokens.test.ts`.
 */

export const color = {
  // Fondos y superficies.
  background: "#070B1F", // fondo de las pantallas
  surface: "#11183A", // tarjetas, campos, barra inferior
  surface2: "#1A2350", // chips, botones secundarios, avatares
  sidebar: "#0B1130", // barra lateral del panel
  mapBg: "#0C1230", // fondo del mapa
  headerTop: "#121A45", // degradado del encabezado (arriba)
  heroFrom: "#2B1F7A", // tarjeta destacada (degradado)
  heroTo: "#1B2A7A",
  heroBorder: "#3B3FA0",

  // Bordes.
  border: "#1F2860",
  borderStrong: "#2A3470",

  // Texto.
  text: "#F3F5FF", // principal
  text2: "#D5DBF7", // secundario fuerte (etiquetas)
  muted: "#A3AED6", // secundario
  placeholder: "#7F8AB8",
  white: "#FFFFFF",

  // Acción principal y acentos.
  primary: "#7C5CFF", // botón principal (texto blanco ≥ 18,66 px en negrita: texto grande)
  primaryStrong: "#6B4BF0", // presionado y botones chicos (texto blanco < 18,66 px)
  violet300: "#A78BFA", // enlaces, marca "Control"
  violet200: "#C4B5FD", // ítem activo, etiquetas de acento
  violet100: "#E9E3FF", // texto del ítem activo de la barra lateral
  blue: "#4D8DFF",
  blueLight: "#7FB0FF",

  // Estados: color fuerte (puntos, íconos) y claro (texto sobre fondo translúcido).
  success: "#34D399",
  successText: "#6EE7B7",
  warning: "#FBBF24",
  warningText: "#FCD34D",
  gap: "#FB923C", // huecos sin datos
  gapText: "#FDBA74",
  // El rojo no está en las maquetas: se eligió dentro de la misma familia (Tailwind 400/300).
  danger: "#F87171",
  dangerText: "#FCA5A5",

  // Mapa.
  route: "#8B5CF6",
} as const;

export type ColorToken = keyof typeof color;

/** Degradado de marca: solo en el logo, los avatares y la tarjeta destacada. */
export const brandGradient = `linear-gradient(140deg, ${color.blue} 0%, ${color.primary} 100%)`;

/**
 * Pares texto/fondo que se usan en la interfaz, con el contraste mínimo que tienen que cumplir
 * (WCAG AA: 4,5:1 texto normal, 3:1 texto grande y componentes de interfaz).
 */
export const contrastPairs: Array<{ use: string; fg: ColorToken; bg: ColorToken; min: number }> = [
  { use: "texto principal", fg: "text", bg: "background", min: 7 },
  { use: "texto principal en tarjeta", fg: "text", bg: "surface", min: 7 },
  { use: "texto secundario fuerte en tarjeta", fg: "text2", bg: "surface", min: 7 },
  { use: "texto secundario", fg: "muted", bg: "background", min: 7 },
  { use: "texto secundario en tarjeta", fg: "muted", bg: "surface", min: 7 },
  { use: "texto secundario en chip", fg: "muted", bg: "surface2", min: 4.5 },
  { use: "texto en chip", fg: "text2", bg: "surface2", min: 7 },
  { use: "barra lateral, texto secundario", fg: "muted", bg: "sidebar", min: 7 },
  { use: "placeholder del campo", fg: "placeholder", bg: "surface", min: 4.5 },
  { use: "botón principal (texto grande)", fg: "white", bg: "primary", min: 3 },
  { use: "botón principal chico / presionado", fg: "white", bg: "primaryStrong", min: 4.5 },
  { use: "enlace", fg: "violet300", bg: "background", min: 4.5 },
  { use: "enlace en tarjeta", fg: "violet300", bg: "surface", min: 4.5 },
  { use: "etiqueta de acento en tarjeta", fg: "violet200", bg: "surface", min: 7 },
  { use: "tarjeta destacada: título", fg: "text", bg: "heroFrom", min: 7 },
  { use: "tarjeta destacada: texto", fg: "text2", bg: "heroTo", min: 7 },
  { use: "tarjeta destacada: etiqueta", fg: "violet200", bg: "heroTo", min: 4.5 },
  { use: "botón blanco de la tarjeta destacada", fg: "heroFrom", bg: "white", min: 7 },
  { use: "estado: éxito", fg: "successText", bg: "surface", min: 7 },
  { use: "estado: atención", fg: "warningText", bg: "surface", min: 7 },
  { use: "estado: hueco", fg: "gapText", bg: "surface", min: 7 },
  { use: "estado: error", fg: "dangerText", bg: "surface", min: 7 },
  { use: "acento azul", fg: "blueLight", bg: "surface", min: 4.5 },
  // Componentes de interfaz (WCAG 1.4.11): 3:1.
  { use: "anillo de foco", fg: "primary", bg: "surface", min: 3 },
  { use: "anillo de foco sobre el fondo", fg: "primary", bg: "background", min: 3 },
  { use: "punto de estado: éxito", fg: "success", bg: "surface", min: 3 },
  { use: "punto de estado: atención", fg: "warning", bg: "surface", min: 3 },
  { use: "punto de estado: error", fg: "danger", bg: "surface", min: 3 },
  { use: "recorrido en el mapa", fg: "route", bg: "mapBg", min: 3 },
  { use: "hueco en el mapa", fg: "gap", bg: "mapBg", min: 3 },
];

export const font = {
  family: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Menlo, monospace',
  size: { xs: "12px", sm: "13px", md: "14px", base: "15px", lg: "17px", xl: "20px", "2xl": "26px", "3xl": "32px", display: "44px" },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  lineHeight: { tight: 1.15, normal: 1.5 },
} as const;

/** Espaciados en múltiplos de 2 y 4 px, los que usan las maquetas. */
export const space = { 0: "0", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 7: "28px", 8: "32px", 10: "40px" } as const;

/** Radios de las maquetas: 16 campos, 18 botones y tarjetas chicas, 24 tarjetas grandes y barra inferior. */
export const radius = { sm: "12px", md: "16px", lg: "18px", xl: "20px", "2xl": "24px", full: "999px" } as const;

export const shadow = {
  primary: "0 12px 32px rgba(124,92,255,.40)",
  logo: "0 18px 50px rgba(124,92,255,.45)",
  focus: "0 0 0 4px rgba(124,92,255,.28)",
} as const;

/** Alturas: acción principal 60–64 px, campos y botones secundarios 56 px. */
export const touch = { min: "44px", comfortable: "56px", big: "60px", hero: "64px" } as const;

// --- Contraste (WCAG 2.x) ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

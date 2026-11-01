/**
 * Tokens del sistema de diseño (ADR-007, §10.1 de la planificación).
 *
 * Fuente de verdad de colores, tipografía, espaciados, radios y sombras. `styles.css` los expone
 * como variables CSS con los mismos valores (una prueba lo verifica), y los contrastes de cada par
 * texto/fondo se verifican contra WCAG en `tokens.test.ts`.
 *
 * Criterio de color: AA como mínimo y, en todo texto que se lee en la calle, apuntar a AAA (7:1),
 * porque al sol el contraste percibido baja mucho.
 */

export const color = {
  // Azul: color principal (acciones, marca).
  blue950: "#0B1F4D", // barra lateral, marca, títulos fuertes
  blue900: "#1E3A8A",
  blue800: "#1E40AF", // botón principal presionado
  blue700: "#1D4ED8", // botón principal, enlaces
  blue600: "#2563EB",
  blue200: "#BFDBFE",
  blue100: "#DBEAFE",
  blue50: "#EFF6FF",

  // Violeta: acento (elemento activo, foco, destacados). Reemplaza al ámbar de la versión 0.5.
  violet800: "#5B21B6",
  violet700: "#6D28D9", // botón de acento, texto de acento
  violet600: "#7C3AED", // anillo de foco, ítem activo de la barra lateral
  violet100: "#EDE9FE",
  violet50: "#F5F3FF",

  // Neutros (pizarra fría).
  ink: "#0F172A", // texto principal
  text2: "#334155", // texto secundario
  muted: "#475569", // texto de apoyo (7:1 sobre el fondo: legible al sol)
  borderStrong: "#64748B", // borde de campos (3:1 para componentes de interfaz)
  border: "#CBD5E1", // separadores (decorativo)
  surface: "#FFFFFF",
  background: "#F4F6FA",

  // Estados: texto oscuro sobre fondo suave, más un color fuerte para íconos y bordes.
  success: "#15803D",
  successText: "#14532D",
  successBg: "#DCFCE7",
  warning: "#B45309",
  warningText: "#713F12",
  warningBg: "#FEF3C7",
  danger: "#B91C1C",
  dangerText: "#7F1D1D",
  dangerBg: "#FEE2E2",
  infoText: "#1E3A8A",
  infoBg: "#DBEAFE",
} as const;

export type ColorToken = keyof typeof color;

/** Pares texto/fondo que se usan en la interfaz, con el contraste mínimo que tienen que cumplir. */
export const contrastPairs: Array<{ use: string; fg: ColorToken; bg: ColorToken; min: number }> = [
  { use: "texto principal", fg: "ink", bg: "background", min: 7 },
  { use: "texto principal en tarjeta", fg: "ink", bg: "surface", min: 7 },
  { use: "texto secundario", fg: "text2", bg: "background", min: 7 },
  { use: "texto de apoyo", fg: "muted", bg: "background", min: 7 },
  { use: "texto de apoyo en tarjeta", fg: "muted", bg: "surface", min: 7 },
  { use: "botón principal", fg: "surface", bg: "blue700", min: 4.5 },
  { use: "botón principal presionado", fg: "surface", bg: "blue800", min: 7 },
  { use: "botón de acento", fg: "surface", bg: "violet700", min: 7 },
  { use: "botón de peligro", fg: "surface", bg: "danger", min: 4.5 },
  { use: "enlace / botón secundario", fg: "blue700", bg: "surface", min: 4.5 },
  { use: "texto de acento", fg: "violet700", bg: "surface", min: 7 },
  { use: "insignia de acento", fg: "violet800", bg: "violet100", min: 7 },
  { use: "barra lateral", fg: "surface", bg: "blue950", min: 7 },
  { use: "barra lateral, texto de apoyo", fg: "blue200", bg: "blue950", min: 7 },
  { use: "barra lateral, ítem activo", fg: "surface", bg: "violet600", min: 4.5 },
  { use: "aviso de éxito", fg: "successText", bg: "successBg", min: 7 },
  { use: "aviso de advertencia", fg: "warningText", bg: "warningBg", min: 7 },
  { use: "aviso de error", fg: "dangerText", bg: "dangerBg", min: 7 },
  { use: "aviso informativo", fg: "infoText", bg: "infoBg", min: 7 },
  // Componentes de interfaz (WCAG 1.4.11): 3:1.
  { use: "borde de campo", fg: "borderStrong", bg: "surface", min: 3 },
  { use: "anillo de foco", fg: "violet600", bg: "surface", min: 3 },
  { use: "punto de estado: éxito", fg: "success", bg: "surface", min: 3 },
  { use: "punto de estado: advertencia", fg: "warning", bg: "surface", min: 3 },
  { use: "punto de estado: error", fg: "danger", bg: "surface", min: 3 },
];

export const font = {
  family: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Menlo, monospace',
  // Escala: el mínimo para leer es 16 px (§10.2); 14 px solo para datos secundarios.
  size: { xs: "13px", sm: "14px", base: "16px", lg: "18px", xl: "22px", "2xl": "28px", "3xl": "36px", display: "48px" },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  lineHeight: { tight: 1.2, normal: 1.5 },
} as const;

/** Espaciados en múltiplos de 4 px. */
export const space = { 0: "0", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 10: "40px", 12: "48px" } as const;

export const radius = { sm: "8px", md: "12px", lg: "16px", xl: "20px", full: "999px" } as const;

export const shadow = {
  card: "0 1px 2px rgb(15 23 42 / 6%), 0 1px 3px rgb(15 23 42 / 8%)",
  raised: "0 4px 12px rgb(15 23 42 / 12%)",
} as const;

/** Tamaños táctiles mínimos (§10.2): 56 px para las acciones principales en la calle. */
export const touch = { min: "44px", comfortable: "56px", big: "72px" } as const;

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

import { useId } from "react";

import { setThemePreference, THEME_OPTIONS, type ThemePreference, useTheme } from "../theme";

function Icon({ value }: { value: ThemePreference }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (value === "dark") {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      </svg>
    );
  }
  if (value === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/**
 * Selector de apariencia: Oscuro / Claro / Automático. Es un grupo de opciones (radio) accesible.
 * `compact`: solo íconos (el nombre queda como etiqueta accesible), para el encabezado del panel.
 */
export function ThemeSelector({ userId, compact = false }: { userId: string | null | undefined; compact?: boolean }) {
  const { preference } = useTheme();
  const name = useId();
  return (
    <div className={["rc-theme", compact && "rc-theme--compact"].filter(Boolean).join(" ")} role="radiogroup" aria-label="Apariencia">
      {THEME_OPTIONS.map((o) => (
        <label key={o.value} className="rc-theme__option" title={o.label}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={preference === o.value}
            onChange={() => setThemePreference(userId, o.value)}
            aria-label={compact ? o.label : undefined}
          />
          <Icon value={o.value} />
          {compact ? null : <span>{o.label}</span>}
        </label>
      ))}
    </div>
  );
}

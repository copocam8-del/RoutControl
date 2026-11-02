import type { ReactNode } from "react";

/**
 * Logo de las maquetas: cuadrado con el degradado de marca y una ruta blanca entre dos puntos.
 * `routeClassName` permite animar el trazo (bienvenida).
 */
export function LogoMark({
  size = 44,
  radius = Math.round(size * 0.3),
  routeClassName,
  className,
  hole = "var(--rc-background)",
}: {
  size?: number;
  radius?: number;
  routeClassName?: string;
  className?: string;
  /** Color del centro del punto final (el fondo de la pantalla). */
  hole?: string;
}) {
  const icon = Math.round(size * 0.58);
  // El trazo es más fino en el logo grande, como en la maqueta (5 en 104 px; 6 en 44 px).
  const big = size >= 80;
  return (
    <span className={["rc-brand__mark", className].filter(Boolean).join(" ")} style={{ width: size, height: size, borderRadius: radius }}>
      <svg width={icon} height={icon} viewBox="0 0 60 60" fill="none" aria-hidden="true">
        <path
          className={routeClassName}
          d="M14 44 C 14 30, 30 34, 30 24 S 44 16, 46 14"
          stroke="#FFFFFF"
          strokeWidth={big ? 5 : 6}
          strokeLinecap="round"
        />
        <circle cx="14" cy="44" r={big ? 6 : 7} fill="#FFFFFF" />
        <circle cx="46" cy="14" r={big ? 7 : 8} fill={hole} stroke="#FFFFFF" strokeWidth={big ? 4 : 5} />
      </svg>
    </span>
  );
}

/** Nombre del producto con la segunda parte en violeta: "Route" + "Control". */
export function Wordmark({ name, size = 20 }: { name: string; size?: number }) {
  const split = splitName(name);
  return (
    <span className="rc-brand__name" style={{ fontSize: size }}>
      {split[0]}
      {split[1] ? <span className="rc-brand__accent">{split[1]}</span> : null}
    </span>
  );
}

/** Divide un nombre en CamelCase en dos partes ("RouteControl" → "Route", "Control"). */
export function splitName(name: string): [string, string] {
  const match = /^([A-Z][a-z]+)([A-Z].*)$/.exec(name);
  return match ? [match[1]!, match[2]!] : [name, ""];
}

export function Brand({ name, markSize = 44, textSize = 20, hole, extra }: { name: string; markSize?: number; textSize?: number; hole?: string; extra?: ReactNode }) {
  return (
    <span className="rc-brand">
      <LogoMark size={markSize} hole={hole} />
      <Wordmark name={name} size={textSize} />
      {extra}
    </span>
  );
}

/** Iniciales para el avatar: "Juan Pérez" → "JP"; "repartidor1@norte.demo" → "R1". */
export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.split("@")[0]!.replace(/\(.*?\)/g, "").trim();
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const word = words[0] ?? "?";
  const digits = /\d+$/.exec(word)?.[0];
  return (word[0]! + (digits ? digits.slice(0, 1) : (word[1] ?? ""))).toUpperCase();
}

export function Avatar({ name, size = 48, ring = false }: { name: string; size?: number; ring?: boolean }) {
  return (
    <span
      className={["rc-avatar", ring && "rc-avatar--ring"].filter(Boolean).join(" ")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** Marca del panel: el mismo ícono que la app, con el nombre provisorio que sale del entorno. */
export function Brand({ name, subtitle, inverse = false }: { name: string; subtitle?: string; inverse?: boolean }) {
  return (
    <div className={["brand", inverse && "brand--inverse"].filter(Boolean).join(" ")}>
      <svg className="brand__mark" viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="112" fill={inverse ? "var(--rc-violet-600)" : "var(--rc-blue-700)"} />
        <path
          d="M120 392 C 180 300, 250 360, 300 270 S 380 170, 400 150"
          fill="none"
          stroke="#fff"
          strokeWidth="26"
          strokeLinecap="round"
          strokeDasharray="2 46"
        />
        <path d="M256 92c-54 0-98 43-98 97 0 72 98 175 98 175s98-103 98-175c0-54-44-97-98-97z" fill="#fff" />
        <circle cx="256" cy="189" r="38" fill={inverse ? "var(--rc-blue-950)" : "var(--rc-violet-700)"} />
      </svg>
      <span className="brand__text">
        <span className="brand__name">{name}</span>
        {subtitle ? <span className="brand__subtitle">{subtitle}</span> : null}
      </span>
    </div>
  );
}

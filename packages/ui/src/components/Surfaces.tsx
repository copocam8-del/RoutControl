import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Título visible; también le da nombre accesible a la sección. */
  title?: ReactNode;
  /** Nombre accesible cuando no hay título visible. */
  label?: string;
}

export function Card({ title, label, className, children, ...rest }: CardProps) {
  const titled = typeof title === "string" ? title : undefined;
  return (
    <section {...rest} className={["rc-card", className].filter(Boolean).join(" ")} aria-label={label ?? titled}>
      {title ? <h2 className="rc-card__title">{title}</h2> : null}
      {children}
    </section>
  );
}

export type Tone = "info" | "success" | "warning" | "error";

export interface AlertProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** Acción opcional (por ejemplo, un botón "Reintentar"). */
  action?: ReactNode;
  className?: string;
}

/** Aviso. Error y advertencia se anuncian enseguida (role=alert); el resto, con cortesía (status). */
export function Alert({ tone = "info", title, children, action, className }: AlertProps) {
  const urgent = tone === "error" || tone === "warning";
  return (
    <div
      className={["rc-alert", `rc-alert--${tone}`, className].filter(Boolean).join(" ")}
      role={urgent ? "alert" : "status"}
    >
      <div className="rc-alert__body">
        {title ? <div className="rc-alert__title">{title}</div> : null}
        {children}
      </div>
      {action}
    </div>
  );
}

export type StatusTone = "ok" | "warn" | "error" | "busy" | "idle";

export interface StatusLineProps {
  tone: StatusTone;
  title: ReactNode;
  detail?: ReactNode;
  /** Si se pasa, la línea es un botón (por ejemplo, "tocá para revisar"). */
  onClick?: () => void;
  live?: boolean;
  testId?: string;
}

/** Estado siempre visible: punto de color + título + detalle (GPS, sincronización…). */
export function StatusLine({ tone, title, detail, onClick, live = false, testId }: StatusLineProps) {
  const content = (
    <>
      <span className="rc-status__dot" aria-hidden="true" />
      <span>
        <span className="rc-status__title" style={{ display: "block" }}>
          {title}
        </span>
        {detail ? (
          <span className="rc-status__detail" style={{ display: "block" }}>
            {detail}
          </span>
        ) : null}
      </span>
    </>
  );
  const className = `rc-status rc-status--${tone}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} data-testid={testId}>
      {content}
    </button>
  ) : (
    <div className={className} role={live ? "status" : undefined} aria-live={live ? "polite" : undefined} data-testid={testId}>
      {content}
    </div>
  );
}

export type BadgeTone = "accent" | "info" | "success" | "warning" | "error" | "neutral";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`rc-badge rc-badge--${tone}`}>{children}</span>;
}

export interface StatItem {
  label: string;
  value: ReactNode;
  tone?: "ok" | "warn";
}

/** Cifras en tarjetas chicas. `valueFirst`: el número arriba (Jornada); si no, la etiqueta arriba. */
export function Stats({ label, items, valueFirst = false }: { label: string; items: StatItem[]; valueFirst?: boolean }) {
  return (
    <section className="rc-stats" aria-label={label}>
      {items.map((item) => (
        <div
          key={item.label}
          className={["rc-stat", item.tone && `rc-stat--${item.tone}`, valueFirst && "rc-stat--value-first"].filter(Boolean).join(" ")}
        >
          {valueFirst ? (
            <>
              <strong className="rc-stat__value">{item.value}</strong>
              <span className="rc-stat__label">{item.label}</span>
            </>
          ) : (
            <>
              <span className="rc-stat__label">{item.label}</span>
              <strong className="rc-stat__value">{item.value}</strong>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

export type ChipTone = "neutral" | "ok" | "warn" | "error" | "busy";

/** Pastilla de estado (conexión, GPS, empresa). Con `live`, el punto late (registrando). */
export function Chip({
  tone = "neutral",
  dot = tone !== "neutral",
  live = false,
  icon,
  children,
  onClick,
  title,
}: {
  tone?: ChipTone;
  dot?: boolean;
  live?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const className = ["rc-chip", tone !== "neutral" && `rc-chip--${tone}`, live && "rc-chip--live"].filter(Boolean).join(" ");
  const content = (
    <>
      {dot ? <span className="rc-chip__dot" aria-hidden="true" /> : null}
      {icon}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={title}>
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

export type ItemTone = "ok" | "info" | "warn" | "gap" | "error" | "accent";

/** Fila con ícono, título y detalle (las tarjetas chicas de las maquetas). */
export function ListItem({
  icon,
  tone = "info",
  title,
  detail,
  trailing,
  onClick,
  href,
  className,
}: {
  icon: ReactNode;
  tone?: ItemTone;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const classes = ["rc-item", className].filter(Boolean).join(" ");
  const content = (
    <>
      <span className={`rc-item__icon rc-item__icon--${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="rc-item__body">
        <span className="rc-item__title">{title}</span>
        {detail ? <span className="rc-item__detail">{detail}</span> : null}
      </span>
      {trailing}
    </>
  );
  if (href) {
    return (
      <a className={classes} href={href}>
        {content}
      </a>
    );
  }
  return onClick ? (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

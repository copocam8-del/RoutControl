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

export function Stats({ label, items }: { label: string; items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <section className="rc-card rc-stats" aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <strong className="rc-stat__value">{item.value}</strong>
          <span className="rc-stat__label">{item.label}</span>
        </div>
      ))}
    </section>
  );
}

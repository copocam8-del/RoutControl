/** Estados de una pantalla o sección: cargando, vacío y error (siempre uno solo a la vez). */
import type { ReactNode } from "react";

export function Spinner({ size = "md", decorative = false }: { size?: "sm" | "md"; decorative?: boolean }) {
  return (
    <span
      className={["rc-spinner", size === "sm" && "rc-spinner--sm"].filter(Boolean).join(" ")}
      aria-hidden={decorative || undefined}
    />
  );
}

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="rc-state" role="status" aria-busy="true" aria-live="polite">
      <Spinner decorative />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rc-state" role="status">
      <span className="rc-state__icon rc-state__icon--empty" aria-hidden="true">
        ∅
      </span>
      <span className="rc-state__title">{title}</span>
      {description ? <span>{description}</span> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Reintentar",
}: {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rc-state">
      <span className="rc-state__icon rc-state__icon--error" aria-hidden="true">
        !
      </span>
      <p className="rc-alert rc-alert--error" role="alert" style={{ margin: 0 }}>
        {message}
      </p>
      {onRetry ? (
        <button type="button" className="rc-btn rc-btn--secondary" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Estado de una carga asíncrona. Las pantallas lo usan con `<Loadable>` para que cargando, vacío,
 * error y datos sean mutuamente excluyentes.
 */
export type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export function Loadable<T>({
  state,
  loadingLabel,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  state: LoadState<T>;
  loadingLabel?: string;
  onRetry?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <LoadingState label={loadingLabel} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={onRetry} />;
  if (isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

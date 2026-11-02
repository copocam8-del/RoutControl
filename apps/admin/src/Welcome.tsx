import { LogoMark, Wordmark } from "@routcontrol/ui";
import { useEffect } from "react";

/** Duración de la bienvenida (las animaciones de la maqueta, en una sola pasada). */
export const WELCOME_MS = 2_000;

export function prefersReducedMotion(): boolean {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Bienvenida del panel (PanelBienvenida.dc.html): la de la app, en grande, con dos rutas de fondo.
 * Una vez por apertura; un clic la saltea; con "reducir movimiento" no hay animación ni espera.
 */
export function Welcome({ appName, durationMs, onDone }: { appName: string; durationMs: number; onDone(): void }) {
  useEffect(() => {
    const id = setTimeout(onDone, durationMs);
    return () => clearTimeout(id);
  }, [durationMs, onDone]);

  return (
    <button type="button" className="welcome" onClick={onDone} aria-label={`${appName}. Hacé clic para continuar`}>
      <svg className="welcome__lines" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
        <path className="welcome__line" d="M-40 720 C 220 640, 300 760, 520 640 S 860 520, 1040 600 S 1340 520, 1500 420" stroke="#1A2350" strokeWidth="3" />
        <path className="welcome__line" d="M-40 200 C 200 260, 380 120, 600 200 S 980 320, 1180 220 S 1400 160, 1500 240" stroke="#1A2350" strokeWidth="3" />
        <circle cx="520" cy="640" r="6" fill="#2A3470" />
        <circle cx="1040" cy="600" r="6" fill="#2A3470" />
        <circle cx="600" cy="200" r="6" fill="#2A3470" />
        <circle cx="1180" cy="220" r="6" fill="#2A3470" />
      </svg>
      <span className="welcome__glow" aria-hidden="true" />
      <span className="welcome__center">
        <LogoMark size={132} radius={38} className="welcome__logo" routeClassName="welcome__route" />
        <span className="welcome__text">
          <span className="welcome__name">
            <Wordmark name={appName} size={56} />
          </span>
          <span className="welcome__tag">Panel de operaciones</span>
        </span>
      </span>
      <span className="welcome__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </button>
  );
}

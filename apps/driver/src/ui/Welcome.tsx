import { LogoMark, Wordmark } from "@routcontrol/ui";
import { useEffect } from "react";

/** Duración de la bienvenida (las animaciones de la maqueta, en una sola pasada). */
export const WELCOME_MS = 2_000;

export function prefersReducedMotion(): boolean {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Bienvenida animada (Main.dc.html): logo, ruta que se dibuja, nombre y lema. Se muestra una sola
 * vez por apertura de la app. Tocar la pantalla la saltea. Con "reducir movimiento" no hay
 * animaciones ni espera: queda solo mientras se recupera la sesión.
 */
export function Welcome({ appName, durationMs, onDone }: { appName: string; durationMs: number; onDone(): void }) {
  useEffect(() => {
    const id = setTimeout(onDone, durationMs);
    return () => clearTimeout(id);
  }, [durationMs, onDone]);

  return (
    <button type="button" className="welcome" onClick={onDone} aria-label={`${appName}. Tocá para continuar`}>
      <span className="welcome__glow" aria-hidden="true" />
      <span className="welcome__center">
        <LogoMark size={104} radius={30} className="welcome__logo" routeClassName="welcome__route" />
        <span className="welcome__text">
          <span className="welcome__name">
            <Wordmark name={appName} size={38} />
          </span>
          <span className="welcome__tag">Tus repartos, bajo control</span>
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

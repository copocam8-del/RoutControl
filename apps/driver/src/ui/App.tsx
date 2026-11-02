import { LoadingState, useUserTheme } from "@routcontrol/ui";
import { useCallback, useEffect, useState } from "react";

import type { AppServices } from "../app";
import { AppContext, useStore } from "./hooks";
import { LoginScreen } from "./LoginScreen";
import { MainShell } from "./MainShell";
import { prefersReducedMotion, WELCOME_MS, Welcome } from "./Welcome";

/**
 * @param welcomeMs duración de la bienvenida; 0 la desactiva (pruebas). Con "reducir movimiento"
 *   también es 0: solo se ve mientras se recupera la sesión.
 */
export function App({ app, welcomeMs = WELCOME_MS }: { app: AppServices; welcomeMs?: number }) {
  const session = useStore(app.session);
  // La apariencia que eligió este usuario en este teléfono.
  useUserTheme(session.status === "authenticated" ? session.session.user.id : null);
  const [withWelcome] = useState(() => !app.ui.splashShown && welcomeMs > 0);
  const [welcome, setWelcome] = useState(withWelcome);
  const duration = prefersReducedMotion() ? 0 : welcomeMs;
  const endWelcome = useCallback(() => {
    app.ui.splashShown = true; // una sola vez por apertura de la app
    setWelcome(false);
  }, [app]);

  useEffect(() => {
    void app.session.restore();
  }, [app]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void app.startAuthenticated();
    return () => app.stopAuthenticated();
  }, [app, session.status]);

  let screen;
  if (welcome || (withWelcome && session.status === "loading")) {
    // La bienvenida cubre también la recuperación de la sesión: no hay un "Cargando…" aparte.
    screen = <Welcome appName={app.config.appName} durationMs={duration} onDone={endWelcome} />;
  } else if (session.status === "loading") {
    screen = (
      <main className="screen screen--center">
        <LoadingState label="Abriendo la app…" />
      </main>
    );
  } else if (session.status === "authenticated") {
    screen = <MainShell />;
  } else {
    screen = <LoginScreen />;
  }

  return <AppContext.Provider value={app}>{screen}</AppContext.Provider>;
}

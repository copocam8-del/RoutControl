import { useEffect } from "react";

import type { AppServices } from "../app";
import { HomeScreen } from "./HomeScreen";
import { AppContext, useStore } from "./hooks";
import { LoginScreen } from "./LoginScreen";

export function App({ app }: { app: AppServices }) {
  const session = useStore(app.session);

  useEffect(() => {
    void app.session.restore();
  }, [app]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    void app.startAuthenticated();
    return () => app.stopAuthenticated();
  }, [app, session.status]);

  return (
    <AppContext.Provider value={app}>
      {session.status === "loading" ? (
        <main className="screen screen--center">
          <p className="muted">Cargando…</p>
        </main>
      ) : session.status === "authenticated" ? (
        <HomeScreen />
      ) : (
        <LoginScreen />
      )}
    </AppContext.Provider>
  );
}

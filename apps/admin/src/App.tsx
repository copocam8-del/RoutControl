import { LoadingState } from "@routcontrol/ui";
import { useCallback, useEffect, useState } from "react";

import { type AdminApp, AdminContext, useAdmin, useSession } from "./adminApp";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";
import { Drivers } from "./pages/Drivers";
import { Login } from "./pages/Login";
import { WorkdayDetail } from "./pages/WorkdayDetail";
import { Workdays } from "./pages/Workdays";
import { useRoute } from "./router";
import { prefersReducedMotion, WELCOME_MS, Welcome } from "./Welcome";

function Screens({ welcomeMs }: { welcomeMs: number }) {
  const app = useAdmin();
  const session = useSession();
  const route = useRoute();
  const [withWelcome] = useState(() => !app.ui.splashShown && welcomeMs > 0);
  const [welcome, setWelcome] = useState(withWelcome);
  const endWelcome = useCallback(() => {
    app.ui.splashShown = true; // una sola vez por apertura del panel
    setWelcome(false);
  }, [app]);

  if (welcome || (withWelcome && session.status === "loading")) {
    // La bienvenida cubre también la recuperación de la sesión.
    return <Welcome appName={app.config.appName} durationMs={prefersReducedMotion() ? 0 : welcomeMs} onDone={endWelcome} />;
  }
  if (session.status === "loading") {
    return (
      <main className="loading-screen">
        <LoadingState label="Abriendo el panel…" />
      </main>
    );
  }
  if (session.status !== "authenticated") return <Login />;
  return (
    <Layout route={route} session={session.session}>
      {route.name === "dashboard" ? <Dashboard /> : null}
      {route.name === "workdays" ? <Workdays date={route.date} /> : null}
      {route.name === "workday" ? <WorkdayDetail key={route.id} id={route.id} /> : null}
      {route.name === "drivers" ? <Drivers /> : null}
    </Layout>
  );
}

/** @param welcomeMs duración de la bienvenida; 0 la desactiva (pruebas). */
export function App({ app, welcomeMs = WELCOME_MS }: { app: AdminApp; welcomeMs?: number }) {
  useEffect(() => {
    void app.session.restore();
  }, [app]);
  return (
    <AdminContext.Provider value={app}>
      <Screens welcomeMs={welcomeMs} />
    </AdminContext.Provider>
  );
}

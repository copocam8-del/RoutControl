import { LoadingState } from "@routcontrol/ui";
import { useEffect } from "react";

import { type AdminApp, AdminContext, useSession } from "./adminApp";
import { Layout } from "./Layout";
import { Dashboard } from "./pages/Dashboard";
import { Drivers } from "./pages/Drivers";
import { Login } from "./pages/Login";
import { WorkdayDetail } from "./pages/WorkdayDetail";
import { Workdays } from "./pages/Workdays";
import { useRoute } from "./router";

function Screens() {
  const session = useSession();
  const route = useRoute();
  if (session.status === "loading") {
    return (
      <main className="login">
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

export function App({ app }: { app: AdminApp }) {
  useEffect(() => {
    void app.session.restore();
  }, [app]);
  return (
    <AdminContext.Provider value={app}>
      <Screens />
    </AdminContext.Provider>
  );
}

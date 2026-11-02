import { Avatar, Button, Chip, IconLogout, IconShield, IconWrench, ListItem, ThemeSelector } from "@routcontrol/ui";
import { useState } from "react";

import { Diagnostics } from "./Diagnostics";
import { useApp, useStore } from "./hooks";
import { InstallHint } from "./InstallHint";

const ROLE: Record<string, string> = { OWNER: "Dueño/a", ADMIN: "Administración", SUPERVISOR: "Supervisión", DRIVER: "Repartidor/a" };

/** Perfil: quién está usando la app, en qué empresa, diagnóstico e instalación, y salir. */
export function ProfileScreen() {
  const app = useApp();
  const session = useStore(app.session);
  const wd = useStore(app.workday);
  const sync = useStore(app.sender);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  if (session.status !== "authenticated") return null;
  const { user, organization, role } = session.session;
  const name = user.full_name || user.email;
  const active = wd.phase === "active" || wd.phase === "ending";
  const canLogout = !active && sync.pending === 0;

  return (
    <main className="screen screen--tabs">
      <header className="screen-header">
        <div className="who">
          <Avatar name={name} size={56} ring />
          <div className="who__text">
            <h1 className="who__name">{name}</h1>
            <span className="who__greeting">{user.email}</span>
          </div>
        </div>
        <div className="chips">
          <Chip>{organization.name}</Chip>
          <Chip>{ROLE[role] ?? role}</Chip>
          {organization.is_demo ? <Chip tone="warn">Datos de demostración</Chip> : null}
        </div>
      </header>

      <div className="screen-body">
        <section className="appearance" aria-label="Apariencia">
          <h2 className="section-title">Apariencia</h2>
          <ThemeSelector userId={user.id} />
          <p className="rc-muted appearance__hint">Automático sigue la configuración del teléfono.</p>
        </section>
        <InstallHint />
        <ListItem
          tone="accent"
          icon={<IconShield />}
          title="Privacidad"
          detail="Tu ubicación solo se registra durante tu jornada, desde que la iniciás hasta que la finalizás."
        />
        <ListItem
          tone="info"
          icon={<IconWrench />}
          title={showDiagnostics ? "Ocultar diagnóstico" : "Diagnóstico"}
          detail="Permiso, envíos pendientes y registro, para soporte"
          onClick={() => setShowDiagnostics((v) => !v)}
        />
        {showDiagnostics ? <Diagnostics /> : null}
        <Button variant="secondary" block onClick={() => void app.session.logout()} disabled={!canLogout}>
          <IconLogout />
          Salir
        </Button>
        {!canLogout ? (
          <p className="rc-muted hint-center">
            {active ? "Para salir, primero finalizá la jornada." : "Para salir, esperá a que se envíen las ubicaciones pendientes."}
          </p>
        ) : null}
      </div>
    </main>
  );
}

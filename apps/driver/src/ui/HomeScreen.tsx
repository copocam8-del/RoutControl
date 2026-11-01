import { useState } from "react";

import type { GpsState } from "../tracking/workdayController";
import { ConsentDialog } from "./ConsentDialog";
import { Diagnostics } from "./Diagnostics";
import { ago, elapsed } from "./format";
import { useApp, useNow, useStore } from "./hooks";
import { InstallHint } from "./InstallHint";
import { SyncIndicator } from "./SyncIndicator";

const CONSENT_KEY = "consent-accepted-v1";

const GPS_TEXT: Record<GpsState, { tone: "ok" | "warn" | "error" | "busy"; text: string }> = {
  watching: { tone: "ok", text: "Registrando recorrido (con la app abierta)" },
  paused: { tone: "warn", text: "Recorrido en pausa: la app está en segundo plano" },
  denied: { tone: "error", text: "GPS detenido: falta el permiso de ubicación. Tocá para revisar" },
  error: { tone: "error", text: "GPS detenido: no hay señal de ubicación. Tocá para revisar" },
  off: { tone: "busy", text: "GPS apagado (fuera de jornada)" },
};

export function HomeScreen() {
  const app = useApp();
  const session = useStore(app.session);
  const wd = useStore(app.workday);
  const sync = useStore(app.sender);
  const now = useNow();
  const [askConsent, setAskConsent] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (session.status !== "authenticated") return null;
  const active = wd.phase === "active" || wd.phase === "ending";
  const gps = GPS_TEXT[wd.gps];

  async function onStartPressed() {
    if ((await app.db.meta.get(CONSENT_KEY))?.value) return app.workday.start();
    setAskConsent(true);
  }

  async function onConsent() {
    await app.db.meta.put({ key: CONSENT_KEY, value: new Date().toISOString() });
    setAskConsent(false);
    await app.workday.start();
  }

  const canLogout = !active && sync.pending === 0;

  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <div className="brand brand--small">{app.config.appName}</div>
          <div className="muted">{session.session.organization.name}</div>
        </div>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => void app.session.logout()}
          disabled={!canLogout}
          title={canLogout ? "Cerrar sesión" : "Finalizá la jornada y esperá a que se envíe todo"}
        >
          Salir
        </button>
      </header>

      <section className="card">
        <div className="muted">Hola, {session.session.user.full_name || session.session.user.email}</div>
        {active && wd.workday ? (
          <>
            <div className="timer" aria-label="Tiempo de jornada">
              {elapsed(wd.workday.started_at, now)}
            </div>
            <div className="muted">Jornada iniciada · modo {wd.workday.tracking_mode === "EVENTS_ONLY" ? "PWA (por eventos)" : "continuo"}</div>
          </>
        ) : (
          <div className="timer timer--idle">Sin jornada</div>
        )}
      </section>

      <button className={`status status--${gps.tone} status--button`} onClick={() => setShowDiagnostics(true)}>
        <span className="status__dot" aria-hidden="true" />
        <div>
          <div className="status__title">{gps.text}</div>
          <div className="status__detail">Última ubicación {ago(wd.lastFixAt, now)}</div>
        </div>
      </button>

      <SyncIndicator status={sync} now={now} />

      {wd.error ? (
        <p className="alert alert--error" role="alert">
          {wd.error}
        </p>
      ) : null}
      {wd.conflict ? (
        <button className="btn btn--secondary" onClick={() => void app.workday.closeServerConflict()}>
          Cerrar la jornada anterior (iniciada {new Date(wd.conflict.started_at).toLocaleString("es-AR")})
        </button>
      ) : null}

      <div className="thumb-zone">
        {active ? (
          <button
            className="btn btn--danger btn--big"
            onClick={() => void app.workday.end()}
            disabled={wd.phase === "ending"}
          >
            {wd.phase === "ending" ? "Finalizando… (se envía al volver la señal)" : "Finalizar jornada"}
          </button>
        ) : (
          <button className="btn btn--primary btn--big" onClick={() => void onStartPressed()} disabled={wd.phase !== "idle"}>
            {wd.phase === "starting" ? "Obteniendo ubicación…" : "Iniciar jornada"}
          </button>
        )}
      </div>

      <InstallHint />
      <button className="btn btn--ghost" onClick={() => setShowDiagnostics((v) => !v)}>
        {showDiagnostics ? "Ocultar diagnóstico" : "Diagnóstico"}
      </button>
      {showDiagnostics ? <Diagnostics /> : null}

      {askConsent ? (
        <ConsentDialog appName={app.config.appName} onAccept={() => void onConsent()} onCancel={() => setAskConsent(false)} />
      ) : null}
    </main>
  );
}

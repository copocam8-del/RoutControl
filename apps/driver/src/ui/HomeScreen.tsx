import { Alert, Badge, Button, Card, formatAgo, formatElapsed, LoadingState, StatusLine, type StatusTone } from "@routcontrol/ui";
import { useState } from "react";

import type { GpsState } from "../tracking/workdayController";
import { Brand } from "./Brand";
import { ConsentDialog } from "./ConsentDialog";
import { Diagnostics } from "./Diagnostics";
import { useApp, useNow, useStore } from "./hooks";
import { InstallHint } from "./InstallHint";
import { SyncIndicator } from "./SyncIndicator";
import { TrackScreen } from "./TrackScreen";

const CONSENT_KEY = "consent-accepted-v1";

const GPS_TEXT: Record<GpsState, { tone: StatusTone; text: string; actionable: boolean }> = {
  watching: { tone: "ok", text: "Registrando recorrido (con la app abierta)", actionable: false },
  paused: { tone: "warn", text: "Recorrido en pausa: la app está en segundo plano", actionable: false },
  denied: { tone: "error", text: "GPS detenido: falta el permiso de ubicación. Tocá para revisar", actionable: true },
  error: { tone: "error", text: "GPS detenido: no hay señal de ubicación. Tocá para revisar", actionable: true },
  off: { tone: "idle", text: "GPS apagado (fuera de jornada)", actionable: false },
};

export function HomeScreen() {
  const app = useApp();
  const session = useStore(app.session);
  const wd = useStore(app.workday);
  const sync = useStore(app.sender);
  const now = useNow();
  const [askConsent, setAskConsent] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showTracks, setShowTracks] = useState(false);

  if (session.status !== "authenticated") return null;
  if (showTracks) return <TrackScreen onBack={() => setShowTracks(false)} />;
  const active = wd.phase === "active" || wd.phase === "ending";
  const gps = GPS_TEXT[wd.gps];
  const canLogout = !active && sync.pending === 0;

  async function onStartPressed() {
    if ((await app.db.meta.get(CONSENT_KEY))?.value) return app.workday.start();
    setAskConsent(true);
  }

  async function onConsent() {
    await app.db.meta.put({ key: CONSENT_KEY, value: new Date().toISOString() });
    setAskConsent(false);
    await app.workday.start();
  }

  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <Brand name={app.config.appName} small />
          <div className="topbar__org">
            {session.session.organization.name}{" "}
            {session.session.organization.is_demo ? <Badge tone="warning">Datos de demostración</Badge> : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void app.session.logout()}
          disabled={!canLogout}
          title={canLogout ? "Cerrar sesión" : "Finalizá la jornada y esperá a que se envíe todo"}
        >
          Salir
        </Button>
      </header>

      {wd.phase === "loading" ? (
        <Card label="Jornada">
          <LoadingState label="Recuperando tu jornada…" />
        </Card>
      ) : (
        <Card label="Jornada" className="workday-card">
          <span className="workday-card__hello">Hola, {session.session.user.full_name || session.session.user.email}</span>
          {active && wd.workday ? (
            <>
              <span className="timer" aria-label="Tiempo de jornada">
                {formatElapsed(wd.workday.started_at, now)}
              </span>
              <span className="rc-muted">
                Jornada en curso · {wd.workday.tracking_mode === "EVENTS_ONLY" ? "ubicación con la app abierta" : "recorrido continuo"}
              </span>
            </>
          ) : (
            <span className="timer timer--idle">Sin jornada</span>
          )}
        </Card>
      )}

      <StatusLine
        tone={gps.tone}
        title={gps.text}
        detail={`Última ubicación ${formatAgo(wd.lastFixAt, now)}`}
        onClick={gps.actionable ? () => setShowDiagnostics(true) : undefined}
      />
      <SyncIndicator status={sync} now={now} />

      {wd.error ? <Alert tone="error">{wd.error}</Alert> : null}
      {wd.conflict ? (
        <Alert tone="warning" title="Tenés otra jornada abierta">
          <p style={{ margin: "4px 0 12px" }}>
            Empezó el {new Date(wd.conflict.started_at).toLocaleString("es-AR")}, probablemente en otro teléfono.
          </p>
          <Button variant="secondary" block onClick={() => void app.workday.closeServerConflict()}>
            Cerrar la jornada anterior
          </Button>
        </Alert>
      ) : null}

      <div className="thumb-zone">
        {wd.phase === "loading" ? null : active ? (
          <Button
            variant="danger"
            size="lg"
            block
            onClick={() => void app.workday.end()}
            loading={wd.phase === "ending"}
            loadingLabel="Finalizando…"
          >
            Finalizar jornada
          </Button>
        ) : (
          <Button
            size="lg"
            block
            onClick={() => void onStartPressed()}
            disabled={wd.phase !== "idle" && wd.phase !== "starting"}
            loading={wd.phase === "starting"}
            loadingLabel="Obteniendo ubicación…"
          >
            Iniciar jornada
          </Button>
        )}
      </div>

      <div className="secondary-actions">
        <Button variant="secondary" onClick={() => setShowTracks(true)}>
          Mis recorridos
        </Button>
        <Button variant="secondary" onClick={() => setShowDiagnostics((v) => !v)} aria-expanded={showDiagnostics}>
          {showDiagnostics ? "Ocultar diagnóstico" : "Diagnóstico"}
        </Button>
      </div>
      <InstallHint />
      {showDiagnostics ? <Diagnostics /> : null}

      {askConsent ? (
        <ConsentDialog appName={app.config.appName} onAccept={() => void onConsent()} onCancel={() => setAskConsent(false)} />
      ) : null}
    </main>
  );
}

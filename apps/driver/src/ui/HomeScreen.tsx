import type { LocationPermission } from "@routcontrol/domain";
import {
  Alert,
  Avatar,
  Button,
  Chip,
  formatElapsed,
  formatLongDate,
  formatTime,
  greeting,
  IconAlert,
  IconBattery,
  IconCheck,
  IconPin,
  IconPlay,
  IconSync,
  LoadingState,
  ListItem,
  Stats,
} from "@routcontrol/ui";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import type { WorkdayState } from "../tracking/workdayController";
import { ConsentDialog } from "./ConsentDialog";
import { useApp, useNow, useStore } from "./hooks";
import { LocationHelp } from "./LocationHelp";
import { sortByRoute } from "../delivery/deliveries";
import { ContactActions } from "./PackagesScreen";
import { SyncChip } from "./SyncIndicator";

const CONSENT_KEY = "consent-accepted-v1";

/** Inicio: sin jornada (Inicio.dc.html) o con la jornada en curso (Jornada.dc.html). */
export function HomeScreen({
  onShowTrack,
  onOpenPackage = () => {},
}: {
  onShowTrack(workdayId: string): void;
  onOpenPackage?(packageId: string): void;
}) {
  const app = useApp();
  const session = useStore(app.session);
  const wd = useStore(app.workday);
  const [askConsent, setAskConsent] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Se lee de antemano: al tocar "Iniciar jornada" no puede haber ningún await antes de pedir la
  // ubicación (iOS solo muestra el pedido de permiso dentro del toque). null = todavía leyendo.
  const consented = useLiveQuery(async () => Boolean((await app.db.meta.get(CONSENT_KEY))?.value), [app], null);

  if (session.status !== "authenticated") return null;
  const active = wd.phase === "active" || wd.phase === "ending";

  function start() {
    if (consented) void app.workday.start();
    else setAskConsent(true);
  }

  function onConsent() {
    void app.workday.start(); // primero, sincrónico: el pedido de permiso sale de este toque
    setAskConsent(false);
    void app.db.meta.put({ key: CONSENT_KEY, value: new Date().toISOString() });
  }

  const notices = (
    <>
      {wd.gps === "denied" || showHelp ? (
        <LocationHelp
          info={app.device.info()}
          host={globalThis.location?.host ?? ""}
          active={active}
          onRetry={wd.phase === "idle" ? () => void app.workday.start() : undefined}
        />
      ) : null}
      {/* Sin jornada, la ayuda ya explica el error de permiso; con jornada se muestran los dos. */}
      {wd.error && !(wd.gps === "denied" && wd.phase === "idle") ? <Alert tone="error">{wd.error}</Alert> : null}
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
    </>
  );

  return (
    <>
      {active && wd.workday ? (
        <WorkdayView wd={wd} notices={notices} onShowTrack={() => onShowTrack(wd.workday!.id)} onOpenPackage={onOpenPackage} />
      ) : (
        <IdleView wd={wd} notices={notices} onStart={start} onShowHelp={() => setShowHelp(true)} />
      )}
      {askConsent ? <ConsentDialog appName={app.config.appName} onAccept={onConsent} onCancel={() => setAskConsent(false)} /> : null}
    </>
  );
}

// --- Sin jornada ---------------------------------------------------------------------------------

function IdleView({ wd, notices, onStart, onShowHelp }: { wd: WorkdayState; notices: React.ReactNode; onStart(): void; onShowHelp(): void }) {
  const app = useApp();
  const session = useStore(app.session);
  const sync = useStore(app.sender);
  const now = useNow(30_000);
  if (session.status !== "authenticated") return null;
  const { user, organization } = session.session;
  const name = user.full_name || user.email;

  return (
    <main className="screen screen--tabs">
      <header className="screen-header">
        <div className="screen-header__row">
          <div className="who">
            <Avatar name={name} size={48} ring />
            <div className="who__text">
              <span className="who__greeting">{greeting(now)}</span>
              <span className="who__name">{name}</span>
            </div>
          </div>
        </div>
        <div className="chips">
          <Chip>{organization.name}</Chip>
          {organization.is_demo ? <Chip tone="warn">Datos de demostración</Chip> : null}
          <SyncChip status={sync} now={now} />
        </div>
      </header>

      <div className="screen-body">
        <section className="rc-hero" aria-label="Jornada">
          <div className="hero__text">
            <span className="rc-eyebrow">{formatLongDate(now)}</span>
            {wd.phase === "loading" ? (
              <LoadingState label="Recuperando tu jornada…" />
            ) : (
              <>
                <h1 className="hero__title">Tu jornada todavía no empezó</h1>
                <p className="hero__lead">Cuando la inicies, se registra tu ubicación hasta que la finalices.</p>
              </>
            )}
          </div>
          {wd.phase === "loading" ? null : (
            <Button variant="hero" block onClick={onStart} loading={wd.phase === "starting"} loadingLabel="Obteniendo ubicación…">
              <IconPlay />
              Iniciar jornada
            </Button>
          )}
        </section>

        {notices}

        <h2 className="section-title">Antes de salir</h2>
        <ul className="items">
          <li>
            <PermissionItem gps={wd.gps} onShowHelp={onShowHelp} />
          </li>
          <li>
            <ListItem
              tone={sync.pending === 0 ? "ok" : "warn"}
              icon={<IconSync />}
              title={sync.pending === 0 ? "Todo enviado" : sync.pending === 1 ? "1 ubicación sin enviar" : `${sync.pending} ubicaciones sin enviar`}
              detail={sync.pending === 0 ? "No quedan ubicaciones guardadas en el teléfono" : "Se envían solas cuando haya señal"}
              trailing={sync.pending === 0 ? <span className="item-check"><IconCheck size={22} /></span> : undefined}
            />
          </li>
          <BatteryItem />
        </ul>
      </div>
    </main>
  );
}

const PERMISSION_ITEM: Record<LocationPermission | "loading", { tone: "ok" | "info" | "error"; title: string; detail: string }> = {
  while_in_use: { tone: "ok", title: "Ubicación permitida", detail: "Lista para registrar tu recorrido" },
  always: { tone: "ok", title: "Ubicación permitida", detail: "Lista para registrar tu recorrido" },
  prompt: { tone: "info", title: "Permiso de ubicación", detail: "Te lo va a pedir el teléfono al iniciar la jornada" },
  unknown: { tone: "info", title: "Permiso de ubicación", detail: "Se confirma al iniciar la jornada" },
  denied: { tone: "error", title: "Ubicación bloqueada", detail: "Tocá para ver cómo habilitarla" },
  loading: { tone: "info", title: "Permiso de ubicación", detail: "Consultando…" },
};

function PermissionItem({ gps, onShowHelp }: { gps: WorkdayState["gps"]; onShowHelp(): void }) {
  const app = useApp();
  const [permission, setPermission] = useState<LocationPermission | "loading">("loading");
  useEffect(() => {
    let alive = true;
    void app.device.location.permission().then((p) => alive && setPermission(p));
    return () => {
      alive = false;
    };
  }, [app, gps]);
  const denied = permission === "denied" || gps === "denied";
  const d = PERMISSION_ITEM[denied ? "denied" : permission];
  const ok = d.tone === "ok";
  return (
    <ListItem
      tone={d.tone}
      icon={<IconPin />}
      title={d.title}
      detail={d.detail}
      onClick={denied ? onShowHelp : undefined}
      trailing={ok ? <span className="item-check"><IconCheck size={22} /></span> : undefined}
    />
  );
}

/** Solo si el navegador informa la batería (Safari no): nada de datos inventados. */
function BatteryItem() {
  const app = useApp();
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void app.device.battery.level().then((l) => alive && setLevel(l));
    return () => {
      alive = false;
    };
  }, [app]);
  if (level === null) return null;
  const pct = Math.round(level * 100);
  return (
    <li>
      <ListItem
        tone={pct < 30 ? "warn" : "ok"}
        icon={<IconBattery />}
        title={`Batería al ${pct}%`}
        detail={pct < 50 ? "Llevá el cargador por las dudas" : "Carga suficiente para salir"}
      />
    </li>
  );
}

// --- Jornada en curso ----------------------------------------------------------------------------

const GPS_CHIP: Record<WorkdayState["gps"], { tone: "ok" | "warn" | "error" | "neutral"; text: string; live?: boolean }> = {
  watching: { tone: "ok", text: "Registrando recorrido", live: true },
  paused: { tone: "warn", text: "Recorrido en pausa" },
  denied: { tone: "error", text: "Ubicación bloqueada" },
  error: { tone: "error", text: "Sin señal de ubicación" },
  off: { tone: "neutral", text: "GPS apagado" },
};

function WorkdayView({
  wd,
  notices,
  onShowTrack,
  onOpenPackage,
}: {
  wd: WorkdayState;
  notices: React.ReactNode;
  onShowTrack(): void;
  onOpenPackage(packageId: string): void;
}) {
  const app = useApp();
  const deliveries = useStore(app.deliveries);
  const packages = deliveries.packages;
  const delivered = packages.filter((p) => p.status === "DELIVERED").length;
  const failed = packages.filter((p) => p.status === "FAILED" || p.status === "RESCHEDULED").length;
  // En el orden de la ruta, si se armó (ADR-015).
  const pendingList = sortByRoute(
    packages.filter((p) => p.status === "ASSIGNED" || p.status === "IN_ROUTE"),
    deliveries.route,
  );
  // Próxima parada: la visita en curso, si hay; si no, el primer pendiente (en camino primero).
  const next =
    packages.find((p) => p.id === deliveries.activeVisit?.package_id) ??
    pendingList.find((p) => p.status === "IN_ROUTE") ??
    pendingList[0] ??
    null;
  const pct = packages.length ? Math.round((delivered / packages.length) * 100) : 0;
  const sync = useStore(app.sender);
  const now = useNow();
  const workday = wd.workday!;
  const gps = GPS_CHIP[wd.gps];

  return (
    <main className="screen screen--tabs">
      <header className="screen-header screen-header--workday">
        <div className="screen-header__row">
          <Chip tone={gps.tone} live={gps.live}>
            {gps.text}
          </Chip>
          <SyncChip status={sync} now={now} compact />
        </div>
        <div className="clock">
          <div className="clock__main">
            <span className="clock__label">Jornada en curso</span>
            <span className="clock__value" aria-label="Tiempo de jornada">
              {formatElapsed(workday.started_at, now)}
            </span>
          </div>
          <div className="clock__since">
            <span className="clock__label">Desde las</span>
            <span className="clock__time">{formatTime(workday.started_at)}</span>
          </div>
        </div>
        {packages.length ? (
          <div className="progress">
            <div className="progress__label">
              <span>
                {delivered} de {packages.length} entregados
              </span>
              <span className="progress__pct">{pct}%</span>
            </div>
            <div className="progress__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de entregas">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </header>

      <div className="screen-body">
        {packages.length ? (
          <Stats
            label="Entregas de hoy"
            valueFirst
            items={[
              { label: "Entregados", value: delivered, tone: "ok" },
              { label: "Pendientes", value: pendingList.length },
              { label: "No entregados", value: failed, tone: failed ? "warn" : undefined },
            ]}
          />
        ) : null}
        <Stats
          label="Estado del registro"
          valueFirst
          items={[
            { label: "Última ubicación", value: wd.lastFixAt ? formatTime(new Date(wd.lastFixAt).toISOString()) : "—" },
            { label: "Precisión", value: wd.lastAccuracy === null ? "—" : `± ${Math.round(wd.lastAccuracy)} m` },
            { label: "Sin enviar", value: sync.pending, tone: sync.pending > 0 ? "warn" : "ok" },
          ]}
        />

        {notices}

        {next ? (
          <section className="stop-card stop-card--next" aria-label="Próxima parada">
            <div className="stop-card__head">
              <span className="rc-eyebrow">{deliveries.activeVisit ? "Visita en curso" : "Próxima parada"}</span>
              <span className="rc-muted">{pendingList.length} pendientes</span>
            </div>
            <button type="button" className="stop-card__who stop-card__open" onClick={() => onOpenPackage(next.id)}>
              <span className="stop-card__icon" aria-hidden="true">
                <IconPin size={22} />
              </span>
              <span>
                <span className="stop-card__address">{next.address.raw_text}</span>
                <span className="rc-muted stop-card__line">{[next.recipient_name, next.tracking_code].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
            <ContactActions pkg={next} />
            <Button size="lg" block onClick={() => onOpenPackage(next.id)}>
              {deliveries.activeVisit?.package_id === next.id ? "Seguir con la visita" : "Llegué: iniciar visita"}
            </Button>
          </section>
        ) : null}

        <section className="workday-card" aria-label="Tu recorrido">
          <div className="workday-card__head">
            <span className="rc-eyebrow">Tu recorrido de hoy</span>
            {wd.gps === "paused" ? (
              <span className="rc-badge rc-badge--warning">En pausa</span>
            ) : wd.gps === "watching" ? (
              <span className="rc-badge rc-badge--success">Con la app abierta</span>
            ) : null}
          </div>
          <div className="workday-card__body">
            <span className="workday-card__icon" aria-hidden="true">
              {wd.gps === "watching" ? <IconPin size={22} /> : <IconAlert size={22} />}
            </span>
            <p>
              {wd.workday?.tracking_mode === "EVENTS_ONLY"
                ? "Tu ubicación se registra mientras la app está abierta. Si bloqueás la pantalla o cerrás la app, ese tramo queda sin datos."
                : "Tu recorrido se registra de forma continua."}
            </p>
          </div>
          <Button size="lg" block onClick={onShowTrack}>
            Ver mi recorrido
          </Button>
        </section>

        <Button
          variant="ghost"
          className="end-workday"
          onClick={() => void app.workday.end()}
          loading={wd.phase === "ending"}
          loadingLabel="Finalizando…"
          disabled={wd.phase !== "active"}
        >
          Finalizar jornada
        </Button>
      </div>
    </main>
  );
}

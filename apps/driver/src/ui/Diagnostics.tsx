import { Button, Card, clearMapErrors, EmptyState, formatAgo, getMapErrors, type MapErrorRecord, subscribeMapErrors } from "@routcontrol/ui";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";

import { getMeta, type SyncLogRow } from "../store/db";
import { useApp, useNow, useStore } from "./hooks";

const PERMISSION_TEXT: Record<string, string> = {
  while_in_use: "Permitido mientras se usa la app",
  always: "Permitido siempre",
  denied: "Denegado: habilitalo en los ajustes del teléfono",
  prompt: "Todavía no se pidió",
  unknown: "Desconocido (el navegador no lo informa)",
};

const LOG_KIND: Record<SyncLogRow["kind"], string> = {
  batch_ok: "Envío",
  batch_error: "Error de envío",
  rejected: "Punto rechazado",
  token_invalid: "Token inválido",
};

/** Pantalla de diagnóstico (§10.2): sirve para soporte y para el informe de la etapa 0. */
export function Diagnostics() {
  const app = useApp();
  const sync = useStore(app.sender);
  const wd = useStore(app.workday);
  const now = useNow(5_000);
  const [permission, setPermission] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState(false);
  const deviceId = useLiveQuery(() => getMeta<string>(app.db, "deviceId"), [], undefined);
  const log = useLiveQuery(() => app.db.log.orderBy("at").reverse().limit(15).toArray(), [], undefined);

  useEffect(() => {
    void app.device.location.permission().then(setPermission);
  }, [app, wd.gps]);

  async function toggleWakeLock() {
    if (wakeLock) {
      await app.device.wakeLock.release();
      setWakeLock(false);
    } else {
      setWakeLock(await app.device.wakeLock.acquire());
    }
  }

  const info = app.device.info();
  return (
    <Card title="Diagnóstico" className="diagnostics">
      <dl>
        <dt>Permiso de ubicación</dt>
        <dd>{permission === null ? "Consultando…" : (PERMISSION_TEXT[permission] ?? permission)}</dd>
        <dt>Puntos pendientes de envío</dt>
        <dd className="rc-num">{sync.pending}</dd>
        <dt>Última sincronización</dt>
        <dd>{formatAgo(sync.lastSyncAt, now)}</dd>
        <dt>Conexión</dt>
        <dd>{app.device.network.online() ? "En línea" : "Sin conexión"}</dd>
        <dt>Dispositivo</dt>
        <dd>
          {info.model} · {info.os_version || "sistema desconocido"} · app {info.app_version}
        </dd>
        <dt>Identificador del dispositivo</dt>
        <dd className="rc-mono">{deviceId ?? "Se crea al iniciar la primera jornada"}</dd>
        {wd.workday ? (
          <>
            <dt>Jornada</dt>
            <dd className="rc-mono">{wd.workday.id}</dd>
            <dt>El token de seguimiento vence</dt>
            <dd>{new Date(wd.workday.tracking_token_expires_at).toLocaleString("es-AR")}</dd>
          </>
        ) : null}
      </dl>
      {app.device.wakeLock.supported ? (
        <Button variant="secondary" block onClick={() => void toggleWakeLock()} aria-pressed={wakeLock}>
          {wakeLock ? "Permitir que se apague la pantalla" : "Mantener la pantalla encendida"}
        </Button>
      ) : (
        <p className="rc-muted">Este navegador no permite mantener la pantalla encendida.</p>
      )}
      <MapErrors />
      <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Registro</h3>
      {log === undefined ? null : log.length === 0 ? (
        <EmptyState title="Todavía no hay registros" description="Acá aparecen los envíos y los errores de sincronización." />
      ) : (
        <ul className="log">
          {log.map((row) => (
            <li key={row.id}>
              <span className="rc-mono">{new Date(row.at).toLocaleTimeString("es-AR")}</span> {LOG_KIND[row.kind]}: {row.detail}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

let cachedRaw = "";
let cached: MapErrorRecord[] = [];
/** Lista estable para useSyncExternalStore (solo cambia si cambió lo guardado). */
function snapshot(): MapErrorRecord[] {
  const list = getMapErrors();
  const raw = JSON.stringify(list);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = list;
  }
  return cached;
}

/** Errores del mapa con todo el detalle (mensaje, recurso y URL), para mandar una captura a soporte. */
function MapErrors() {
  const errors = useSyncExternalStore(subscribeMapErrors, snapshot, snapshot);
  return (
    <section aria-label="Errores del mapa">
      <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Mapa</h3>
      {errors.length === 0 ? (
        <p className="rc-muted" style={{ margin: 0 }}>
          Sin errores del mapa.
        </p>
      ) : (
        <>
          <ul className="log map-errors">
            {errors.map((e) => (
              <li key={`${e.at}-${e.message}`}>
                <div>
                  <span className="rc-mono">{new Date(e.at).toLocaleString("es-AR")}</span>{" "}
                  <strong>{e.kind === "offline" ? "Sin conexión" : "No se pudo cargar"}</strong> · {e.resource}
                  {e.status !== null ? ` · HTTP ${e.status}` : ""}
                </div>
                <div className="rc-mono">{e.message}</div>
                {e.url ? <div className="rc-mono">{e.url}</div> : null}
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={clearMapErrors}>
            Borrar errores del mapa
          </Button>
        </>
      )}
    </section>
  );
}

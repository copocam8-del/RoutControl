import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { getMeta } from "../store/db";
import { ago } from "./format";
import { useApp, useNow, useStore } from "./hooks";

/** Pantalla de diagnóstico (§10.2): sirve para soporte y para el informe de la etapa 0. */
export function Diagnostics() {
  const app = useApp();
  const sync = useStore(app.sender);
  const wd = useStore(app.workday);
  const now = useNow(5_000);
  const [permission, setPermission] = useState<string>("…");
  const [wakeLock, setWakeLock] = useState(false);
  const deviceId = useLiveQuery(() => getMeta<string>(app.db, "deviceId"), [], undefined);
  const log = useLiveQuery(() => app.db.log.orderBy("at").reverse().limit(15).toArray(), [], []);

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
    <section className="card diagnostics" aria-label="Diagnóstico">
      <dl>
        <dt>Permiso de ubicación</dt>
        <dd>{permission}</dd>
        <dt>Puntos pendientes de envío</dt>
        <dd>{sync.pending}</dd>
        <dt>Última sincronización</dt>
        <dd>{ago(sync.lastSyncAt, now)}</dd>
        <dt>Conexión</dt>
        <dd>{app.device.network.online() ? "en línea" : "sin conexión"}</dd>
        <dt>Dispositivo</dt>
        <dd>
          {info.model} · {info.os_version || "?"} · app {info.app_version}
        </dd>
        <dt>Id del dispositivo</dt>
        <dd className="mono">{deviceId ?? "(se crea al iniciar la primera jornada)"}</dd>
        {wd.workday ? (
          <>
            <dt>Jornada</dt>
            <dd className="mono">{wd.workday.id}</dd>
            <dt>Token de seguimiento vence</dt>
            <dd>{new Date(wd.workday.tracking_token_expires_at).toLocaleString("es-AR")}</dd>
          </>
        ) : null}
      </dl>
      {app.device.wakeLock.supported ? (
        <button className="btn btn--secondary" onClick={() => void toggleWakeLock()}>
          {wakeLock ? "Permitir que se apague la pantalla" : "Mantener la pantalla encendida (Wake Lock)"}
        </button>
      ) : (
        <p className="muted">Este navegador no permite mantener la pantalla encendida.</p>
      )}
      <h3>Registro</h3>
      <ul className="log">
        {log.map((row) => (
          <li key={row.id}>
            <span className="mono">{new Date(row.at).toLocaleTimeString("es-AR")}</span> {row.kind}: {row.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

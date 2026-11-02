import { Alert, Button, formatTime, IconMap } from "@routcontrol/ui";

import { useMemo } from "react";

import { formatBytes } from "../map/offlineMap";
import type { LocalPackage } from "../store/db";
import { useApp, useStore } from "./hooks";

/**
 * Mapa sin conexión (ADR-018), en "Mis paquetes": guardar en el teléfono las calles de la zona de
 * los paquetes del día. Mismo lenguaje que las tarjetas de la jornada (stop-card + progreso).
 */
export function OfflineMapCard({ packages }: { packages: readonly LocalPackage[] }) {
  const app = useApp();
  const state = useStore(app.offlineMap);
  const plan = useMemo(() => app.offlineMap.plan(packages), [app.offlineMap, packages]);
  const outside = app.offlineMap.outside(packages);
  const info = state.info;
  if (!plan && !info) return null; // ningún paquete con dirección ubicada en el mapa

  const pct = state.status === "saving" && state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
  let detail: string;
  if (state.status === "saving") detail = `Guardando… ${formatBytes(state.progress.bytes)}`;
  else if (info && outside === 0) detail = `Guardado a las ${formatTime(info.saved_at)} · ${formatBytes(info.bytes)}. Funciona sin señal.`;
  else if (info) detail = `${outside === 1 ? "Hay 1 paquete" : `Hay ${outside} paquetes`} fuera de la zona guardada.`;
  else detail = "Guardá las calles de la zona de tus paquetes para ver el mapa sin señal.";

  return (
    <section className="stop-card offline-map" aria-label="Mapa sin conexión">
      <div className="stop-card__who">
        <span className="stop-card__icon" aria-hidden="true">
          <IconMap />
        </span>
        <span>
          <strong className="stop-card__line">Mapa sin conexión</strong>
          <span className="stop-card__line rc-muted">{detail}</span>
        </span>
      </div>
      {state.status === "saving" ? (
        <div className="progress">
          <div className="progress__label">
            <span>
              {state.progress.done} de {state.progress.total} partes del mapa
            </span>
            <span className="progress__pct">{pct}%</span>
          </div>
          <div className="progress__bar" role="progressbar" aria-label="Guardando el mapa" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => app.offlineMap.cancel()}>
            Cancelar
          </Button>
        </div>
      ) : plan && (!info || outside > 0) ? (
        <Button variant="secondary" block onClick={() => void app.offlineMap.save(packages)}>
          {info ? "Actualizar el mapa guardado" : "Guardar el mapa de la zona"}
        </Button>
      ) : null}
      {state.status === "error" ? <Alert tone="error">{state.error}</Alert> : null}
      {plan && state.status !== "saving" && (!info || outside > 0) ? (
        <p className="rc-muted offline-map__note">Conviene hacerlo con Wi-Fi. Se reemplaza lo guardado antes.</p>
      ) : null}
    </section>
  );
}

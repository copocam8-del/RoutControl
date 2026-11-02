import { useEffect, useState } from "react";

import { useApp, useStore } from "./hooks";

export interface MyLocationState {
  location: { lat: number; lng: number; accuracy: number } | null;
  /** Por qué no hay punto azul (para explicarlo en pantalla). */
  reason: "no_workday" | "waiting" | "denied" | null;
}

/**
 * Mi ubicación para el mapa (punto azul). Solo con la jornada en curso: la regla del producto es
 * que la ubicación se usa desde que se inicia hasta que se finaliza la jornada, también para
 * mostrarla. No se guarda ni se envía: eso lo hace el seguimiento de la jornada.
 */
export function useMyLocation(): MyLocationState {
  const app = useApp();
  const wd = useStore(app.workday);
  const active = wd.phase === "active";
  const [state, setState] = useState<MyLocationState>({ location: null, reason: active ? "waiting" : "no_workday" });

  useEffect(() => {
    if (!active) {
      setState({ location: null, reason: "no_workday" });
      return;
    }
    setState((s) => (s.location ? s : { location: null, reason: "waiting" }));
    return app.device.location.watch(
      (fix) => setState({ location: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }, reason: null }),
      (error) => setState((s) => (error.code === "permission_denied" ? { location: null, reason: "denied" } : s)),
    );
  }, [active, app.device.location]);

  return state;
}

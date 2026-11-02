import { useCallback, useEffect, useState } from "react";

import type { LoadState } from "./components/States";

/**
 * Carga datos con un estado único (cargando | error | datos) y un `reload` para "Reintentar".
 * Si cambian los parámetros antes de que llegue la respuesta, la respuesta vieja se descarta.
 * Con `load = null` no carga nada (por ejemplo, mientras no hay nada seleccionado).
 */
export function useLoad<T>(
  load: (() => Promise<T>) | null,
  describeError: (error: unknown) => string,
  /** Si se pasa, vuelve a consultar cada tantos ms sin mostrar "Cargando…" (si falla, quedan los datos que había). */
  refreshMs?: number,
): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!load) return;
    let current = true;
    setState({ status: "loading" });
    load()
      .then((data) => {
        if (current) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (current) setState({ status: "error", message: describeError(error) });
      });
    return () => {
      current = false;
    };
  }, [load, describeError, attempt]);

  useEffect(() => {
    if (!load || !refreshMs) return;
    let current = true;
    const id = setInterval(() => {
      load()
        .then((data) => {
          if (current) setState((s) => (s.status === "ready" ? { status: "ready", data } : s));
        })
        .catch(() => {
          // Un corte momentáneo no borra lo que se está mostrando; el próximo intento lo corrige.
        });
    }, refreshMs);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [load, refreshMs]);

  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

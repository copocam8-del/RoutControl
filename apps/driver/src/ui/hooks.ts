import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import type { AppServices } from "../app";

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const app = useContext(AppContext);
  if (!app) throw new Error("Falta <AppContext.Provider>");
  return app;
}

interface Observable<T> {
  getState?(): T;
  getStatus?(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** Suscribe un componente a uno de los "stores" de la app (sesión, jornada, sincronización). */
export function useStore<T>(store: Observable<T>): T {
  const get = () => (store.getState ? store.getState() : store.getStatus!());
  return useSyncExternalStore((cb) => store.subscribe(() => cb()), get, get);
}

/** Fuerza un re-render cada `ms` (para el cronómetro y los "hace X min"). */
export function useNow(ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Apariencia (ADR-007 v3): Oscuro (por defecto), Claro o Automático (sigue prefers-color-scheme).
 *
 * Se guarda por usuario en el dispositivo (`localStorage`). Antes de ingresar se usa la última
 * elegida en ese dispositivo, así el login no "parpadea" de un tema al otro.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { color, lightColor } from "./tokens";

export type ThemePreference = "dark" | "light" | "auto";
export type ResolvedTheme = "dark" | "light";

export const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "dark", label: "Oscuro" },
  { value: "light", label: "Claro" },
  { value: "auto", label: "Automático" },
];

const LAST_KEY = "rc-theme:last";
const userKey = (userId: string) => `rc-theme:${userId}`;
const listeners = new Set<() => void>();
let current: ThemePreference = "dark";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const valid = (v: string | null | undefined): v is ThemePreference => v === "dark" || v === "light" || v === "auto";

/** La preferencia del usuario en este dispositivo; sin usuario, la última usada; si no, Oscuro. */
export function getThemePreference(userId?: string | null): ThemePreference {
  const s = storage();
  const own = userId ? s?.getItem(userKey(userId)) : null;
  if (valid(own)) return own;
  const last = s?.getItem(LAST_KEY);
  return valid(last) ? last : "dark";
}

export function setThemePreference(userId: string | null | undefined, preference: ThemePreference): void {
  const s = storage();
  try {
    if (userId) s?.setItem(userKey(userId), preference);
    s?.setItem(LAST_KEY, preference);
  } catch {
    // sin almacenamiento: igual se aplica en esta sesión
  }
  applyTheme(preference);
}

function systemPrefersLight(): boolean {
  return Boolean(globalThis.matchMedia?.("(prefers-color-scheme: light)").matches);
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "auto") return systemPrefersLight() ? "light" : "dark";
  return preference;
}

/** Pone `data-theme` en <html> (lo usa styles.css) y el color de la barra del sistema. */
export function applyTheme(preference: ThemePreference): void {
  current = preference;
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", resolveTheme(preference) === "light" ? lightColor.background : color.background);
  }
  for (const l of listeners) l();
}

export function currentThemePreference(): ThemePreference {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = globalThis.matchMedia?.("(prefers-color-scheme: light)");
  media?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener?.("change", listener);
  };
}

/** Preferencia actual y tema efectivo (Automático ya resuelto). Se actualiza si cambia el sistema. */
export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  const preference = useSyncExternalStore(subscribe, currentThemePreference, currentThemePreference);
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return { preference, resolved: resolveTheme(preference) };
}

/** Al cambiar de usuario (ingreso, cambio de cuenta), aplica la apariencia que eligió ese usuario. */
export function useUserTheme(userId: string | null | undefined): void {
  useEffect(() => {
    applyTheme(getThemePreference(userId));
  }, [userId]);
}

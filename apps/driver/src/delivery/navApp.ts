/**
 * Con qué app se navega hasta un domicilio (ADR-019): Google Maps o Waze. Se elige la primera vez
 * que se toca "Navegar" y se cambia en Perfil. Queda en el teléfono (IndexedDB), por usuario del
 * teléfono, no en el servidor.
 */
import { googleMapsUrl, wazeUrl } from "@routcontrol/domain";

import { type DriverDB, getMeta, setMeta } from "../store/db";

export type NavApp = "google" | "waze";

export const NAV_APP_LABEL: Record<NavApp, string> = { google: "Google Maps", waze: "Waze" };

const KEY = "nav_app";

type Destination = Parameters<typeof googleMapsUrl>[0];

export function navigateUrl(app: NavApp, d: Destination): string {
  return app === "waze" ? wazeUrl(d) : googleMapsUrl(d);
}

export class NavPreference {
  private state: { app: NavApp | null } = { app: null };
  private listeners = new Set<(s: { app: NavApp | null }) => void>();

  constructor(private readonly db: DriverDB) {}

  getState() {
    return this.state;
  }

  subscribe(listener: (s: { app: NavApp | null }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(): Promise<void> {
    const saved = await getMeta<NavApp>(this.db, KEY);
    if (saved === "google" || saved === "waze") this.emit({ app: saved });
  }

  async choose(app: NavApp): Promise<void> {
    this.emit({ app });
    await setMeta(this.db, KEY, app);
  }

  private emit(next: { app: NavApp | null }) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}

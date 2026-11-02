/**
 * Cuándo se instala una versión nueva de la PWA.
 *
 * Antes se preguntaba con un `confirm()` y, si el repartidor no aceptaba, la app vieja seguía
 * andando indefinidamente: en iOS la PWA instalada casi nunca se cierra del todo, así que el
 * Service Worker nuevo nunca se activaba (así quedó el iPhone con el mapa roto ya arreglado).
 *
 * Ahora:
 * - sin jornada en curso, se actualiza sola (recarga la app; no se pierde nada: todo está en
 *   IndexedDB);
 * - con la jornada en curso no se recarga (cortaría el seguimiento): se muestra un aviso con
 *   "Actualizar" y, si no lo toca, se actualiza sola apenas finaliza la jornada.
 */
export interface UpdateState {
  available: boolean;
}

export class UpdateManager {
  private state: UpdateState = { available: false };
  private listeners = new Set<(s: UpdateState) => void>();
  private apply: (() => Promise<void>) | null = null;

  constructor(private readonly canUpdateNow: () => boolean) {}

  getState(): UpdateState {
    return this.state;
  }

  subscribe(listener: (s: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** El Service Worker avisa que hay una versión nueva lista. */
  onNeedRefresh(apply: () => Promise<void>): void {
    this.apply = apply;
    if (this.canUpdateNow()) {
      void this.update();
      return;
    }
    this.set({ available: true });
  }

  /** Llamar cuando cambia la jornada: si quedó libre y hay versión nueva, se instala. */
  maybeUpdate(): void {
    if (this.state.available && this.canUpdateNow()) void this.update();
  }

  /** "Actualizar" (el repartidor decide, también con la jornada en curso). */
  async update(): Promise<void> {
    await this.apply?.();
  }

  private set(state: UpdateState): void {
    this.state = state;
    for (const l of this.listeners) l(state);
  }
}

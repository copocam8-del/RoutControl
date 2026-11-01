/** DeviceServices controlable para las pruebas: ubicación, visibilidad y red a demanda. */
import type { LocationPermission } from "@routcontrol/domain";

import { type DeviceServices, LocationError, type PositionFix } from "../device/DeviceServices";

export class FakeDevice implements DeviceServices {
  permissionState: LocationPermission = "while_in_use";
  nextFix: PositionFix | LocationError | null = null;
  batteryLevel: number | null = 0.9;
  isVisible = true;
  isOnline = true;
  watchers = new Set<(fix: PositionFix) => void>();
  private visibilityListeners = new Set<(v: boolean) => void>();
  private networkListeners = new Set<(o: boolean) => void>();

  constructor(private readonly now: () => number = Date.now) {}

  fixAt(timestamp: number, lat = -34.6037, lng = -58.3816, speed: number | null = 5): PositionFix {
    return { lat, lng, accuracy: 8, speed, heading: 90, altitude: 25, timestamp };
  }

  location = {
    permission: async () => this.permissionState,
    current: () => {
      this.currentCalls += 1;
      return this.resolveFix();
    },
    watch: (onFix: (fix: PositionFix) => void, onError: (error: LocationError) => void) => {
      this.watchers.add(onFix);
      this.watchErrors.add(onError);
      return () => {
        this.watchers.delete(onFix);
        this.watchErrors.delete(onError);
      };
    },
  };

  watchErrors = new Set<(error: LocationError) => void>();

  private async resolveFix(): Promise<PositionFix> {
    const fix = this.nextFix ?? this.fixAt(this.now());
    if (fix instanceof LocationError) throw fix;
    return fix;
  }

  /** El seguimiento falla (por ejemplo, se revocó el permiso con la jornada en curso). */
  emitWatchError(error: LocationError): void {
    for (const e of [...this.watchErrors]) e(error);
  }

  battery = { level: async () => this.batteryLevel };
  wakeLock = { supported: false, acquire: async () => false, release: async () => {} };
  storage = { persist: async () => true };

  network = {
    online: () => this.isOnline,
    subscribe: (l: (o: boolean) => void) => {
      this.networkListeners.add(l);
      return () => this.networkListeners.delete(l);
    },
  };

  lifecycle = {
    visible: () => this.isVisible,
    subscribe: (l: (v: boolean) => void) => {
      this.visibilityListeners.add(l);
      return () => this.visibilityListeners.delete(l);
    },
  };

  platform: "ios" | "android" | "other" = "android";
  standalone = true;
  /** Llamadas a location.current(), para comprobar que el pedido sale dentro del toque. */
  currentCalls = 0;

  info() {
    return {
      runtime: "PWA" as const,
      model: "Teléfono de prueba",
      os_version: this.platform === "ios" ? "iOS 18.1" : "Android 14",
      app_version: "test",
      platform: this.platform,
      standalone: this.standalone,
    };
  }

  /** Entrega una fijación a quien esté haciendo watchPosition. */
  emitFix(fix: PositionFix): void {
    for (const w of this.watchers) w(fix);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    for (const l of this.visibilityListeners) l(visible);
  }

  setOnline(online: boolean): void {
    this.isOnline = online;
    for (const l of this.networkListeners) l(online);
  }
}

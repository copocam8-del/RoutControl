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
    current: async () => {
      const fix = this.nextFix ?? this.fixAt(this.now());
      if (fix instanceof LocationError) throw fix;
      return fix;
    },
    watch: (onFix: (fix: PositionFix) => void) => {
      this.watchers.add(onFix);
      return () => this.watchers.delete(onFix);
    },
  };

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

  info() {
    return { runtime: "PWA" as const, model: "Teléfono de prueba", os_version: "Android 14", app_version: "test" };
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

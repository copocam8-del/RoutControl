/** Implementación web (PWA) de DeviceServices. */
import type { LocationPermission } from "@routcontrol/domain";

import { config } from "../../config";
import {
  type DeviceInfo,
  type DeviceServices,
  LocationError,
  type LocationService,
  type PositionFix,
} from "../DeviceServices";

const finiteOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined || Number.isNaN(value) ? null : value;

export function toFix(position: GeolocationPosition): PositionFix {
  const c = position.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy,
    speed: finiteOrNull(c.speed),
    heading: finiteOrNull(c.heading),
    altitude: finiteOrNull(c.altitude),
    timestamp: position.timestamp,
  };
}

export function toLocationError(error: GeolocationPositionError): LocationError {
  const code =
    error.code === error.PERMISSION_DENIED
      ? "permission_denied"
      : error.code === error.TIMEOUT
        ? "timeout"
        : "unavailable";
  return new LocationError(code, error.message);
}

export function createWebLocation(geo: Geolocation | undefined = globalThis.navigator?.geolocation): LocationService {
  return {
    async permission(): Promise<LocationPermission> {
      if (!geo) return "denied";
      try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        // En el navegador no existe "siempre": a lo sumo "mientras se usa" (§4.2).
        return status.state === "granted" ? "while_in_use" : status.state === "denied" ? "denied" : "prompt";
      } catch {
        return "unknown"; // Safari viejo no implementa permissions.query para geolocalización
      }
    },
    current({ timeoutMs = 15_000 } = {}) {
      return new Promise((resolve, reject) => {
        if (!geo) return reject(new LocationError("unsupported"));
        geo.getCurrentPosition(
          (p) => resolve(toFix(p)),
          (e) => reject(toLocationError(e)),
          { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
        );
      });
    },
    watch(onFix, onError) {
      if (!geo) {
        onError(new LocationError("unsupported"));
        return () => {};
      }
      const id = geo.watchPosition(
        (p) => onFix(toFix(p)),
        (e) => onError(toLocationError(e)),
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
      );
      return () => geo.clearWatch(id);
    },
  };
}

interface BatteryManagerLike {
  level: number;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export function describeDevice(ua: string, maxTouchPoints = 0): Pick<DeviceInfo, "model" | "os_version" | "platform"> {
  const android = /Android\s([\d.]+)(?:;\s([^;)]+))?/.exec(ua);
  if (android) return { os_version: `Android ${android[1]}`, model: (android[2] ?? "Android").trim(), platform: "android" };
  const ios = /(iPhone|iPad|iPod); CPU (?:iPhone )?OS ([\d_]+)/.exec(ua);
  if (ios) return { os_version: `iOS ${ios[2]!.replace(/_/g, ".")}`, model: ios[1]!, platform: "ios" };
  // El iPad con iPadOS se presenta como una Mac; lo delata la pantalla táctil.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return { os_version: "iPadOS", model: "iPad", platform: "ios" };
  return { os_version: "", model: "Navegador", platform: "other" };
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || Boolean(globalThis.matchMedia?.("(display-mode: standalone)").matches);
}

export function createWebDeviceServices(): DeviceServices {
  let wakeLock: WakeLockSentinelLike | null = null;
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryManagerLike>;
    wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
  };

  return {
    location: createWebLocation(),
    battery: {
      async level() {
        try {
          return nav.getBattery ? (await nav.getBattery()).level : null;
        } catch {
          return null;
        }
      },
    },
    wakeLock: {
      supported: Boolean(nav.wakeLock),
      async acquire() {
        if (!nav.wakeLock) return false;
        try {
          wakeLock = await nav.wakeLock.request("screen");
          return true;
        } catch {
          return false;
        }
      },
      async release() {
        await wakeLock?.release();
        wakeLock = null;
      },
    },
    network: {
      online: () => navigator.onLine,
      subscribe(listener) {
        const on = () => listener(true);
        const off = () => listener(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
          window.removeEventListener("online", on);
          window.removeEventListener("offline", off);
        };
      },
    },
    storage: {
      async persist() {
        try {
          return navigator.storage?.persist ? await navigator.storage.persist() : null;
        } catch {
          return null;
        }
      },
    },
    lifecycle: {
      visible: () => document.visibilityState === "visible",
      subscribe(listener) {
        const handler = () => listener(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
    },
    info: () => ({
      runtime: "PWA",
      app_version: config.appVersion,
      standalone: isStandalone(),
      ...describeDevice(navigator.userAgent, navigator.maxTouchPoints),
    }),
  };
}

/**
 * Todo acceso al dispositivo pasa por acá (D2 de la planificación). Hoy existe solo la
 * implementación web (PWA); en la fase 2 se agrega la nativa (Capacitor) sin tocar pantallas
 * ni lógica.
 */
import type { LocationPermission } from "@routcontrol/domain";

export interface PositionFix {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  /** Momento de la fijación según el reloj del teléfono (ms desde epoch). */
  timestamp: number;
}

export type LocationErrorCode = "permission_denied" | "unavailable" | "timeout" | "unsupported";

export class LocationError extends Error {
  constructor(
    readonly code: LocationErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LocationError";
  }
}

export interface LocationService {
  permission(): Promise<LocationPermission>;
  /** Una fijación nueva (sin caché). */
  current(options?: { timeoutMs?: number }): Promise<PositionFix>;
  /** Seguimiento mientras la app está abierta. Devuelve la función para detenerlo. */
  watch(onFix: (fix: PositionFix) => void, onError: (error: LocationError) => void): () => void;
}

export interface BatteryService {
  /** Nivel de 0 a 1, o null si el navegador no lo informa (Safari). */
  level(): Promise<number | null>;
}

export interface WakeLockService {
  readonly supported: boolean;
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface NetworkService {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface StorageService {
  /** Pide almacenamiento persistente (que el navegador no borre IndexedDB). */
  persist(): Promise<boolean | null>;
}

export interface DeviceInfo {
  runtime: "PWA" | "NATIVE_ANDROID" | "NATIVE_IOS";
  model: string;
  os_version: string;
  app_version: string;
  /** Para mostrar los pasos de ajustes que corresponden a cada teléfono. */
  platform: "ios" | "android" | "other";
  /** Abierta como app instalada (pantalla de inicio) y no dentro del navegador. */
  standalone: boolean;
}

export interface AppLifecycleService {
  visible(): boolean;
  /** Cambios entre primer plano y segundo plano. */
  subscribe(listener: (visible: boolean) => void): () => void;
}

export interface DeviceServices {
  location: LocationService;
  battery: BatteryService;
  wakeLock: WakeLockService;
  network: NetworkService;
  storage: StorageService;
  lifecycle: AppLifecycleService;
  info(): DeviceInfo;
}

import { IconHome, IconMap, IconPackage, IconUser } from "@routcontrol/ui";
import { type ReactNode, useState } from "react";

import { HomeScreen } from "./HomeScreen";
import { MapScreen } from "./MapScreen";
import { PackagesScreen } from "./PackagesScreen";
import { useApp, useStore } from "./hooks";
import { ProfileScreen } from "./ProfileScreen";
import { TrackScreen } from "./TrackScreen";

export type Tab = "home" | "packages" | "map" | "tracks" | "profile";

/**
 * Pantallas con sesión y la barra inferior (Inicio.dc.html): Inicio (jornada), Paquetes, Mapa
 * (entregas del día, ADR-019), Recorridos y Perfil.
 */
export function MainShell() {
  const [tab, setTab] = useState<Tab>("home");
  // Recorrido abierto en "Recorridos" (por ejemplo, desde "Ver mi recorrido" de la jornada).
  const [openTrack, setOpenTrack] = useState<string | null>(null);
  // Ficha abierta en "Paquetes" (también desde "Próxima parada" de la jornada).
  const [openPackage, setOpenPackage] = useState<string | null>(null);
  const showNav = !(tab === "tracks" && openTrack) && !(tab === "packages" && openPackage);

  return (
    <div className="shell">
      <UpdateBanner />
      {tab === "home" ? (
        <HomeScreen
          onShowTrack={(id) => {
            setOpenTrack(id);
            setTab("tracks");
          }}
          onOpenPackage={(id) => {
            setOpenPackage(id);
            setTab("packages");
          }}
        />
      ) : null}
      {tab === "packages" ? <PackagesScreen selected={openPackage} onSelect={setOpenPackage} /> : null}
      {tab === "map" ? (
        <MapScreen
          onOpenPackage={(id) => {
            setOpenPackage(id);
            setTab("packages");
          }}
        />
      ) : null}
      {tab === "tracks" ? (
        <TrackScreen
          selected={openTrack}
          onSelect={setOpenTrack}
          onHome={() => {
            setOpenTrack(null);
            setTab("home");
          }}
        />
      ) : null}
      {tab === "profile" ? <ProfileScreen /> : null}
      {showNav ? (
        <BottomNav
          tab={tab}
          onChange={(next) => {
            setOpenTrack(null);
            setOpenPackage(null);
            setTab(next);
          }}
        />
      ) : null}
    </div>
  );
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange(tab: Tab): void }) {
  const item = (id: Tab, label: string, icon: ReactNode) => (
    <button
      type="button"
      className="bottom-nav__item"
      aria-current={tab === id ? "page" : undefined}
      onClick={() => onChange(id)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {item("home", "Inicio", <IconHome size={24} strokeWidth={tab === "home" ? 2.2 : 2} />)}
      {item("packages", "Paquetes", <IconPackage size={24} strokeWidth={tab === "packages" ? 2.2 : 2} />)}
      {item("map", "Mapa", <IconMap size={24} strokeWidth={tab === "map" ? 2.2 : 2} />)}
      {item("tracks", "Recorridos", <IconTrack size={24} strokeWidth={tab === "tracks" ? 2.2 : 2} />)}
      {item("profile", "Perfil", <IconUser size={24} strokeWidth={tab === "profile" ? 2.2 : 2} />)}
    </nav>
  );
}

/** Versión nueva durante la jornada: no se recarga sola (cortaría el seguimiento). */
function UpdateBanner() {
  const app = useApp();
  const { available } = useStore(app.updates);
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>Hay una versión nueva. Se instala sola al finalizar la jornada.</span>
      <button type="button" className="rc-btn rc-btn--secondary rc-btn--sm" onClick={() => void app.updates.update()}>
        Actualizar
      </button>
    </div>
  );
}

/** Recorridos: la línea de un recorrido con su inicio y su fin (Mapa usa el ícono del mapa). */
function IconTrack({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7" />
    </svg>
  );
}

import { IconHome, IconMap, IconUser } from "@routcontrol/ui";
import { type ReactNode, useState } from "react";

import { HomeScreen } from "./HomeScreen";
import { useApp, useStore } from "./hooks";
import { ProfileScreen } from "./ProfileScreen";
import { TrackScreen } from "./TrackScreen";

export type Tab = "home" | "tracks" | "profile";

/**
 * Pantallas con sesión y la barra inferior. Solo las secciones que ya existen: Inicio (jornada),
 * Recorridos y Perfil. "Paquetes" llega en la etapa 1, con las entregas.
 */
export function MainShell() {
  const [tab, setTab] = useState<Tab>("home");
  // Recorrido abierto en "Recorridos" (por ejemplo, desde "Ver mi recorrido" de la jornada).
  const [openTrack, setOpenTrack] = useState<string | null>(null);
  const showNav = !(tab === "tracks" && openTrack);

  return (
    <div className="shell">
      <UpdateBanner />
      {tab === "home" ? (
        <HomeScreen
          onShowTrack={(id) => {
            setOpenTrack(id);
            setTab("tracks");
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
      {item("tracks", "Recorridos", <IconMap size={24} strokeWidth={tab === "tracks" ? 2.2 : 2} />)}
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

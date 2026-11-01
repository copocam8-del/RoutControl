import { Alert, Button } from "@routcontrol/ui";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Cómo instalar la PWA: aviso del navegador en Android; instrucciones manuales en iPhone. */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (deferred) {
    return (
      <Button variant="accent" block onClick={() => void deferred.prompt().then(() => setDeferred(null))}>
        Instalar la app en el teléfono
      </Button>
    );
  }
  if (isIos()) {
    return (
      <Alert tone="info" title="Instalá la app en el iPhone">
        Tocá <strong>Compartir</strong> y después <strong>Agregar a inicio</strong>. Instalada, los datos guardados no se
        borran.
      </Alert>
    );
  }
  return null;
}

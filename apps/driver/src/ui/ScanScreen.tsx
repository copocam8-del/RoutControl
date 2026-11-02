import { Alert, Button, IconArrowLeft, IconCheck, LoadingState, TextField } from "@routcontrol/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { classifyScan, SCAN_LABEL, type ScanOutcome } from "../scan/session";
import { cleanCode } from "../scan/scanner";
import type { LocalPackage } from "../store/db";
import { useApp, useStore } from "./hooks";

interface ScanRow {
  code: string;
  outcome: ScanOutcome;
  pkg: LocalPackage | null;
  at: number;
}

/** Cada cuánto se analiza un cuadro de la cámara. */
const SCAN_EVERY_MS = 250;

/**
 * "Cargar paquetes" (ADR-014): escaneo continuo con la cámara, varios códigos por cuadro, sin
 * repetir, contra los paquetes asignados; más ingreso manual (etiqueta rota, sin cámara).
 */
export function ScanScreen({ onDone }: { onDone(): void }) {
  const app = useApp();
  const { packages } = useStore(app.deliveries);
  const video = useRef<HTMLVideoElement>(null);
  const seen = useRef(new Set<string>());
  const packagesRef = useRef(packages);
  packagesRef.current = packages;
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const total = useRef(packages.filter((p) => ["ASSIGNED", "IN_ROUTE", "FAILED", "RESCHEDULED"].includes(p.status)).length);
  const loaded = rows.filter((r) => r.outcome === "loaded").length;
  const alreadyLoaded = packages.filter((p) => p.status === "IN_ROUTE").length;

  function handle(raw: string) {
    const code = cleanCode(raw);
    if (!code) return;
    const { outcome, pkg } = classifyScan(code, packagesRef.current, seen.current);
    if (outcome === "duplicate") return; // el mismo código sigue en cuadro: no se repite
    seen.current.add(code.toUpperCase());
    setRows((prev) => [{ code, outcome, pkg, at: Date.now() }, ...prev]);
    if (outcome === "loaded" && pkg) void app.deliveries.markLoaded([pkg]);
    navigator.vibrate?.(outcome === "loaded" ? 60 : [40, 60, 40]);
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let busy = false;
    void (async () => {
      try {
        const [{ detector }, opened] = await Promise.all([app.scanner.createDetector(), app.scanner.openCamera()]);
        stream = opened;
        if (stopped) return;
        const el = video.current;
        if (el) {
          el.srcObject = stream;
          try {
            await el.play(); // algunos navegadores lo rechazan sin gesto: el video igual se muestra
          } catch {
            // sigue: el análisis espera a que haya cuadros
          }
        }
        setCamera("on");
        timer = setInterval(async () => {
          const el = video.current;
          if (busy || !el || (el.readyState < 2 && !app.scanner.skipReadyCheck)) return;
          busy = true;
          try {
            const found = await detector.detect(el);
            for (const f of found) handle(f.rawValue); // varios códigos por cuadro
          } catch {
            // un cuadro que no se pudo leer: se sigue con el próximo
          } finally {
            busy = false;
          }
        }, SCAN_EVERY_MS);
      } catch (error) {
        if (stopped) return;
        setCamera("off");
        const name = (error as { name?: string })?.name;
        setCameraError(
          name === "NotAllowedError"
            ? "La cámara está bloqueada para esta app. Habilitala en los ajustes del teléfono, o ingresá los códigos a mano."
            : "No se pudo usar la cámara. Ingresá los códigos a mano.",
        );
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  function submitManual(event: FormEvent) {
    event.preventDefault();
    handle(manual);
    setManual("");
  }

  return (
    <main className="screen screen--tabs">
      <header className="detail-header">
        <button type="button" className="rc-icon-btn" aria-label="Volver" onClick={onDone}>
          <IconArrowLeft />
        </button>
        <div className="detail-header__text">
          <h1>Cargar paquetes</h1>
          <span className="rc-muted" aria-live="polite">
            {alreadyLoaded} de {total.current} cargados
          </span>
        </div>
      </header>
      <div className="screen-body">
        <div className="scan-camera">
          <video ref={video} className="scan-camera__video" muted playsInline aria-label="Cámara" hidden={camera === "off"} />
          {camera === "on" ? <div className="scan-camera__frame" aria-hidden="true" /> : null}
          {camera === "starting" ? <LoadingState label="Abriendo la cámara…" /> : null}
        </div>
        {cameraError ? <Alert tone="warning">{cameraError}</Alert> : null}
        {camera === "on" ? <p className="rc-muted scan-hint">Apuntá a las etiquetas: se leen varias a la vez y no se repiten.</p> : null}

        <form className="scan-manual" onSubmit={submitManual}>
          <TextField
            label="Ingresar código a mano"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" disabled={!manual.trim()}>
            Agregar
          </Button>
        </form>

        {rows.length ? (
          <ul className="scan-results" aria-label="Escaneados">
            {rows.map((r) => (
              <li key={`${r.code}-${r.at}`} className={`scan-result scan-result--${r.outcome}`}>
                <span className="scan-result__icon" aria-hidden="true">
                  {r.outcome === "loaded" ? <IconCheck size={18} /> : "!"}
                </span>
                <span className="scan-result__text">
                  <strong className="rc-mono">{r.code}</strong>
                  <span>
                    {SCAN_LABEL[r.outcome]}
                    {r.pkg ? ` · ${r.pkg.recipient_name || r.pkg.address.raw_text}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {loaded ? <p className="rc-muted scan-hint">Cargaste {loaded} en esta tanda. Se envían solos cuando haya señal.</p> : null}

        <Button size="lg" block className="push-bottom" onClick={onDone}>
          Listo
        </Button>
      </div>
    </main>
  );
}

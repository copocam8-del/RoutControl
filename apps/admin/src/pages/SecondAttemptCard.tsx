import { type DeliveryPackage, SECOND_ATTEMPT_LABEL, type SecondAttempt, type SecondAttemptSuggestion } from "@routcontrol/domain";
import { Alert, Badge, Button, formatLongDate, formatTime, TextField, useLoad } from "@routcontrol/ui";
import { useCallback, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";

const describe = (e: unknown) => describeLoadError(e, "los segundos intentos");
const PLACEMENTS: SecondAttemptSuggestion[] = ["INSERT", "END", "NEXT_DAY"];

function km(m: number | null) {
  return m === null ? null : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

/** "de 14:00 a 18:00" / "desde 14:00" / "" */
export function windowText(start: string | null, end: string | null): string {
  if (start && end) return `de ${formatTime(start)} a ${formatTime(end)}`;
  if (start) return `desde ${formatTime(start)}`;
  if (end) return `hasta ${formatTime(end)}`;
  return "";
}

/** Hoy a la hora "HH:MM" del navegador, en ISO (para la franja del destinatario). */
function todayAt(hhmm: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h!, m!, 0, 0);
  return d.toISOString();
}

/**
 * Segundo intento (ADR-023), en la ficha del paquete no entregado: pedirlo (con la franja que dio
 * el destinatario), ver la sugerencia de desvío y decidir. Mismo lenguaje que el resto del panel.
 */
export function SecondAttemptCard({ pkg, onChanged }: { pkg: DeliveryPackage; onChanged(): void }) {
  const { api } = useAdmin();
  const load = useCallback(() => api.listSecondAttempts({ package: pkg.id }), [api, pkg.id]);
  const [state, reload] = useLoad<SecondAttempt[]>(load, describe);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestable = pkg.status === "FAILED" || pkg.status === "RESCHEDULED";
  const list = state.status === "ready" ? state.data : [];
  const pending = list.find((r) => r.decision === "PENDING");
  if (!requestable && list.length === 0) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
      onChanged();
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-card second-attempt" aria-label="Segundo intento">
      <h2>Segundo intento</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {pending ? (
        <div className="second-attempt__suggestion">
          <p className="second-attempt__reason">
            <Badge tone="accent">Sugerencia: {SECOND_ATTEMPT_LABEL[pending.suggestion]}</Badge> {pending.suggestion_reason}
          </p>
          <p className="rc-muted">
            {[
              pending.distance_m !== null ? `Está a ${km(pending.distance_m)} del repartidor` : null,
              `${pending.pending_count} paradas pendientes`,
              windowText(pending.window_start, pending.window_end) ? `El destinatario está ${windowText(pending.window_start, pending.window_end)}` : null,
              pending.note || null,
            ]
              .filter(Boolean)
              .join(" · ")}
            . El desvío es una estimación en línea recta.
          </p>
          <div className="second-attempt__actions">
            <Button disabled={busy} onClick={() => void run(() => api.decideSecondAttempt(pending.id, true))}>
              Aceptar: {SECOND_ATTEMPT_LABEL[pending.suggestion]}
            </Button>
            {PLACEMENTS.filter((p) => p !== pending.suggestion).map((p) => (
              <Button key={p} variant="secondary" disabled={busy} onClick={() => void run(() => api.decideSecondAttempt(pending.id, true, p))}>
                {SECOND_ATTEMPT_LABEL[p]}
              </Button>
            ))}
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.decideSecondAttempt(pending.id, false))}>
              Descartar
            </Button>
          </div>
        </div>
      ) : requestable ? (
        <form
          className="second-attempt__form"
          aria-label="Pedir segundo intento"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.requestSecondAttempt(pkg.id, { window_start: todayAt(from), window_end: todayAt(to), note }));
          }}
        >
          <p className="rc-muted">Calcula si conviene sumarlo a la ruta de hoy del repartidor, al final o mañana.</p>
          <div className="second-attempt__fields">
            <TextField label="El destinatario está desde" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="Hasta" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            <TextField
              className="second-attempt__note"
              label="Nota para el repartidor"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Por ejemplo: tocar timbre 3"
            />
          </div>
          <Button type="submit" loading={busy} loadingLabel="Calculando…">
            Pedir segundo intento
          </Button>
        </form>
      ) : null}
      {list.filter((r) => r.decision !== "PENDING").length ? (
        <ul className="second-attempt__history" aria-label="Pedidos anteriores">
          {list
            .filter((r) => r.decision !== "PENDING")
            .map((r) => (
              <li key={r.id}>
                {formatLongDate(r.requested_at)} · {formatTime(r.requested_at)} ·{" "}
                {r.decision === "ACCEPTED" ? `Aceptado: ${SECOND_ATTEMPT_LABEL[r.placement ?? r.suggestion]}` : "Descartado"}
                {windowText(r.window_start, r.window_end) ? ` · ${windowText(r.window_start, r.window_end)}` : ""}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}

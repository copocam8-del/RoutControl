import { NOTIFICATION_LABEL, type OrganizationSettings } from "@routcontrol/domain";
import { Alert, Button, Loadable, TextField, useLoad } from "@routcontrol/ui";
import { useCallback, useEffect, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";
import { DemoChip, PageTitle } from "../Layout";

const describe = (e: unknown) => describeLoadError(e, "la configuración");

type Form = Omit<OrganizationSettings, "can_edit">;
type AlertKey = "workday_started" | "workday_ended" | "no_signal" | "incident" | "route_finished";
const ALERTS: Array<[AlertKey, string]> = [
  ["workday_started", NOTIFICATION_LABEL.WORKDAY_STARTED],
  ["workday_ended", NOTIFICATION_LABEL.WORKDAY_ENDED],
  ["no_signal", NOTIFICATION_LABEL.NO_SIGNAL],
  ["incident", NOTIFICATION_LABEL.INCIDENT],
  ["route_finished", NOTIFICATION_LABEL.ROUTE_FINISHED],
];

/** Configuración de la empresa (ADR-025): alertas e umbrales. Editan dueño y admin. */
export function Settings() {
  const { api } = useAdmin();
  const load = useCallback(() => api.getSettings(), [api]);
  const [state, reload] = useLoad<OrganizationSettings>(load, describe);
  return (
    <>
      <PageTitle title="Configuración" description="Alertas del panel y umbrales de la empresa." actions={<DemoChip />} />
      <Loadable state={state} loadingLabel="Cargando la configuración…" onRetry={reload}>
        {(s) => <SettingsForm initial={s} />}
      </Loadable>
    </>
  );
}

function SettingsForm({ initial }: { initial: OrganizationSettings }) {
  const { api } = useAdmin();
  const [form, setForm] = useState<Form>({ alerts: initial.alerts, reception: initial.reception, second_attempt: initial.second_attempt });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  useEffect(() => setForm({ alerts: initial.alerts, reception: initial.reception, second_attempt: initial.second_attempt }), [initial]);
  const readOnly = !initial.can_edit;
  const pct = (n: number) => String(Math.round(n * 100));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.saveSettings(form);
      setForm({ alerts: saved.alerts, reception: saved.reception, second_attempt: saved.second_attempt });
      setMessage({ tone: "success", text: "Configuración guardada." });
    } catch (e) {
      setMessage({ tone: "error", text: actionError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="settings"
      aria-label="Configuración de la empresa"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {readOnly ? <Alert tone="info">Solo el dueño o un administrador pueden cambiar la configuración.</Alert> : null}
      <fieldset className="panel-card settings__group" disabled={readOnly} aria-labelledby="grupo-alertas">
        <h2 id="grupo-alertas">Alertas del panel</h2>
        <p className="rc-muted">Las ve todo el personal de la empresa, en Alertas y, si el inicio está abierto, al instante.</p>
        <ul className="settings__toggles">
          {ALERTS.map(([key, label]) => (
            <li key={key}>
              <label className="settings__toggle">
                <input
                  type="checkbox"
                  checked={form.alerts[key]}
                  onChange={(e) => setForm((f) => ({ ...f, alerts: { ...f.alerts, [key]: e.target.checked } }))}
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
        <TextField
          label="Avisar sin señal después de (minutos)"
          type="number"
          min={5}
          max={240}
          value={String(form.alerts.no_signal_minutes)}
          disabled={readOnly || !form.alerts.no_signal}
          onChange={(e) => setForm((f) => ({ ...f, alerts: { ...f.alerts, no_signal_minutes: Number(e.target.value) } }))}
        />
      </fieldset>

      <fieldset className="panel-card settings__group" disabled={readOnly} aria-labelledby="grupo-domicilios">
        <h2 id="grupo-domicilios">Indicador de los domicilios</h2>
        <p className="rc-muted">Cuánto recibe un domicilio para verse en verde o en amarillo (debajo, rojo). Con pocas visitas, gris.</p>
        <div className="settings__row">
          <TextField label="Verde desde (%)" type="number" min={5} max={100} value={pct(form.reception.green)}
            onChange={(e) => setForm((f) => ({ ...f, reception: { ...f.reception, green: Number(e.target.value) / 100 } }))} />
          <TextField label="Amarillo desde (%)" type="number" min={0} max={95} value={pct(form.reception.yellow)}
            onChange={(e) => setForm((f) => ({ ...f, reception: { ...f.reception, yellow: Number(e.target.value) / 100 } }))} />
          <TextField label="Visitas mínimas" type="number" min={1} max={50} value={String(form.reception.min_visits)}
            onChange={(e) => setForm((f) => ({ ...f, reception: { ...f.reception, min_visits: Number(e.target.value) } }))} />
        </div>
      </fieldset>

      <fieldset className="panel-card settings__group" disabled={readOnly} aria-labelledby="grupo-segundo">
        <h2 id="grupo-segundo">Segundo intento</h2>
        <p className="rc-muted">Hasta cuántos minutos de desvío se sugiere sumarlo a la ruta de hoy.</p>
        <div className="settings__row">
          <TextField label="Insertarlo si suma hasta (min)" type="number" min={1} max={120} value={String(form.second_attempt.insert_max_min)}
            onChange={(e) => setForm((f) => ({ ...f, second_attempt: { ...f.second_attempt, insert_max_min: Number(e.target.value) } }))} />
          <TextField label="Al final de la ruta si suma hasta (min)" type="number" min={1} max={240} value={String(form.second_attempt.end_max_min)}
            onChange={(e) => setForm((f) => ({ ...f, second_attempt: { ...f.second_attempt, end_max_min: Number(e.target.value) } }))} />
        </div>
      </fieldset>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {readOnly ? null : (
        <div className="form-actions">
          <Button type="submit" loading={busy} loadingLabel="Guardando…">
            Guardar
          </Button>
        </div>
      )}
    </form>
  );
}

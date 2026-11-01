import { isWithoutSignal, NO_SIGNAL_MINUTES, type WorkdayWithDriver } from "@routcontrol/domain";
import { Button, EmptyState, Loadable, Stats, useLoad } from "@routcontrol/ui";
import { useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { PageTitle } from "../Layout";
import { navigate, today } from "../router";
import { WorkdayTable } from "../WorkdayTable";

const describe = (e: unknown) => describeLoadError(e, "las jornadas de hoy");

/** Inicio: las jornadas de hoy, con datos reales del backend. */
export function Dashboard() {
  const { api } = useAdmin();
  const date = today();
  const load = useCallback(() => api.listWorkdays(date), [api, date]);
  const [state, reload] = useLoad<WorkdayWithDriver[]>(load, describe);
  const now = useNow(30_000);

  return (
    <>
      <PageTitle
        title="Jornadas de hoy"
        description={new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
        actions={
          <Button variant="secondary" size="sm" onClick={reload}>
            Actualizar
          </Button>
        }
      />
      <Loadable
        state={state}
        loadingLabel="Cargando las jornadas de hoy…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          <EmptyState
            title="Hoy todavía no empezó ninguna jornada."
            description="Cuando un repartidor toque “Iniciar jornada” en la app, aparece acá."
            action={
              <Button variant="secondary" onClick={() => navigate({ name: "drivers" })}>
                Ver repartidores
              </Button>
            }
          />
        }
      >
        {(items) => {
          const active = items.filter((w) => w.status === "ACTIVE");
          const silent = active.filter((w) => isWithoutSignal(w.last_point_at, w.started_at, now));
          return (
            <div className="rc-stack">
              <Stats
                label="Resumen de hoy"
                items={[
                  { label: "en curso", value: active.length },
                  { label: "finalizadas", value: items.length - active.length },
                  { label: `sin señal (+${NO_SIGNAL_MINUTES} min)`, value: silent.length },
                  { label: "repartidores con jornada", value: new Set(items.map((w) => w.driver.id)).size },
                ]}
              />
              <WorkdayTable workdays={items} now={now} caption="Jornadas de hoy" />
            </div>
          );
        }}
      </Loadable>
    </>
  );
}

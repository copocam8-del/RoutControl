import type { WorkdayWithDriver } from "@routcontrol/domain";
import { EmptyState, Loadable, TextField, useLoad } from "@routcontrol/ui";
import { useCallback } from "react";

import { describeLoadError, useAdmin } from "../adminApp";
import { useNow } from "../hooks";
import { PageTitle } from "../Layout";
import { navigate, today } from "../router";
import { WorkdayTable } from "../WorkdayTable";

const describe = (e: unknown) => describeLoadError(e, "las jornadas");

function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Jornadas de un día; cada fila abre su recorrido. */
export function Workdays({ date }: { date: string }) {
  const { api } = useAdmin();
  const load = useCallback(() => api.listWorkdays(date), [api, date]);
  const [state, reload] = useLoad<WorkdayWithDriver[]>(load, describe);
  const now = useNow(30_000);

  return (
    <>
      <PageTitle
        title="Jornadas"
        description={longDate(date)}
        actions={
          <TextField
            label="Día"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => e.target.value && navigate({ name: "workdays", date: e.target.value })}
            className="date-field"
          />
        }
      />
      <Loadable
        state={state}
        loadingLabel="Cargando jornadas…"
        onRetry={reload}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title="No hay jornadas ese día." description="Elegí otro día en el calendario." />}
      >
        {(items) => <WorkdayTable workdays={items} now={now} caption={`Jornadas del ${longDate(date)}`} />}
      </Loadable>
    </>
  );
}

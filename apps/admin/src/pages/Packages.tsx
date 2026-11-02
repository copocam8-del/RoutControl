import { type DeliveryPackage, type DriverSummary, PACKAGE_STATUS_LABEL, type PackageStatus } from "@routcontrol/domain";
import { Alert, Badge, type BadgeTone, Button, EmptyState, Loadable, TextField, useLoad } from "@routcontrol/ui";
import { type FormEvent, useCallback, useMemo, useState } from "react";

import { actionError, describeLoadError, useAdmin } from "../adminApp";
import { DemoChip } from "../Layout";
import { href, navigate } from "../router";

const describe = (e: unknown) => describeLoadError(e, "los paquetes");

export const STATUS_TONE: Record<PackageStatus, BadgeTone> = {
  CREATED: "neutral",
  ASSIGNED: "info",
  IN_ROUTE: "accent",
  DELIVERED: "success",
  FAILED: "warning",
  RESCHEDULED: "warning",
  RETURNED: "neutral",
  CANCELLED: "neutral",
};

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PACKAGE_STATUS_LABEL[status]}</Badge>;
}

type Group = "all" | "unassigned" | "assigned" | "route" | "delivered" | "failed";
const GROUPS: Array<{ id: Group; label: string; match: (p: DeliveryPackage) => boolean }> = [
  { id: "all", label: "Todos", match: () => true },
  { id: "unassigned", label: "Sin asignar", match: (p) => p.status === "CREATED" },
  { id: "assigned", label: "Asignados", match: (p) => p.status === "ASSIGNED" },
  { id: "route", label: "En camino", match: (p) => p.status === "IN_ROUTE" },
  { id: "delivered", label: "Entregados", match: (p) => p.status === "DELIVERED" },
  { id: "failed", label: "No entregados", match: (p) => p.status === "FAILED" || p.status === "RESCHEDULED" },
];

const ASSIGNABLE: PackageStatus[] = ["CREATED", "ASSIGNED", "FAILED", "RESCHEDULED"];

export function activeDrivers(drivers: DriverSummary[]) {
  return drivers.filter((d) => d.status === "ACTIVE" && d.membership_status === "ACTIVE");
}

/** Paquetes: lista con filtros, alta manual, importación y asignación (individual y masiva). */
export function Packages() {
  const { api } = useAdmin();
  const load = useCallback(async () => {
    const [packages, drivers] = await Promise.all([api.listPackages(), api.listDrivers()]);
    return { packages, drivers: activeDrivers(drivers) };
  }, [api]);
  const [state, reload] = useLoad(load, describe);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="page-title">
        <div className="page-title__text">
          <h1>Paquetes</h1>
          {state.status === "ready" ? <span className="page-title__description">{state.data.packages.length} paquetes</span> : null}
        </div>
        <div className="page-title__actions">
          <DemoChip />
          <a className="rc-btn rc-btn--secondary" href={href({ name: "import" })}>
            Importar archivo
          </a>
          <Button onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            Nuevo paquete
          </Button>
        </div>
      </div>
      <Loadable state={state} loadingLabel="Cargando paquetes…" onRetry={reload}>
        {(data) => (
          <>
            {creating ? (
              <NewPackageForm
                drivers={data.drivers}
                onCreated={() => {
                  setCreating(false);
                  reload();
                }}
                onCancel={() => setCreating(false)}
              />
            ) : null}
            <PackageTable packages={data.packages} drivers={data.drivers} onChanged={reload} />
          </>
        )}
      </Loadable>
    </>
  );
}

function PackageTable({ packages, drivers, onChanged }: { packages: DeliveryPackage[]; drivers: DriverSummary[]; onChanged(): void }) {
  const { api } = useAdmin();
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const q = query.trim().toLowerCase();
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, packages.filter(g.match).length])) as Record<Group, number>, [packages]);
  const shown = packages
    .filter(GROUPS.find((g) => g.id === group)!.match)
    .filter((p) => !q || [p.tracking_code, p.recipient_name, p.address.raw_text, p.assigned_driver?.name ?? ""].some((t) => t.toLowerCase().includes(q)));
  const selectable = shown.filter((p) => ASSIGNABLE.includes(p.status));
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign(target: string | null) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.bulkAssignPackages([...selected], target);
      const name = target ? drivers.find((d) => d.id === target)?.name : null;
      setMessage(
        result.failed.length
          ? { tone: "warning", text: `${result.assigned.length} ${target ? `asignados a ${name}` : "desasignados"}. ${result.failed.length} no se pudieron: ${result.failed.map((f) => f.detail).join(" ")}` }
          : { tone: "success", text: `${result.assigned.length} ${target ? `asignados a ${name}` : "desasignados"}.` },
      );
      setSelected(new Set());
      onChanged();
    } catch (e) {
      setMessage({ tone: "error", text: actionError(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!packages.length) {
    return (
      <section className="panel-card">
        <EmptyState
          title="Todavía no hay paquetes."
          description="Cargalos uno por uno con “Nuevo paquete” o importá un archivo CSV o Excel."
          action={
            <a className="rc-btn rc-btn--secondary" href={href({ name: "import" })}>
              Importar archivo
            </a>
          }
        />
      </section>
    );
  }

  return (
    <>
      <div className="filters" role="group" aria-label="Filtrar paquetes">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" className="filter-chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label} · {counts[g.id]}
          </button>
        ))}
      </div>
      <div className="search search--wide">
        <label htmlFor="buscar-paquete" className="rc-visually-hidden">
          Buscar paquete
        </label>
        <input id="buscar-paquete" type="search" placeholder="Código, destinatario, dirección o repartidor" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {selected.size ? (
        <div className="bulk-bar" role="group" aria-label="Asignar seleccionados">
          <strong>{selected.size} seleccionados</strong>
          <label className="rc-visually-hidden" htmlFor="asignar-a">
            Repartidor
          </label>
          <select id="asignar-a" className="select" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Elegí un repartidor…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button disabled={!driverId || busy} loading={busy} onClick={() => void assign(driverId)}>
            Asignar
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void assign(null)}>
            Desasignar
          </Button>
        </div>
      ) : null}
      <section className="panel-card panel-card--flush" aria-label="Lista de paquetes">
        {shown.length === 0 ? (
          <EmptyState title="No hay paquetes con este filtro." />
        ) : (
          <div className="table-wrap">
            <table className="rc-table workdays-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos los asignables"
                      checked={allSelected}
                      disabled={!selectable.length}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((p) => p.id)))}
                    />
                  </th>
                  <th scope="col">Código</th>
                  <th scope="col">Destinatario</th>
                  <th scope="col">Dirección</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Repartidor</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${p.tracking_code}`}
                        checked={selected.has(p.id)}
                        disabled={!ASSIGNABLE.includes(p.status)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td>
                      <a className="rc-mono" href={href({ name: "package", id: p.id })}>
                        {p.tracking_code}
                      </a>
                    </td>
                    <td>{p.recipient_name || <span className="rc-muted">—</span>}</td>
                    <td>{p.address.raw_text}</td>
                    <td>
                      <PackageStatusBadge status={p.status} />
                    </td>
                    <td>{p.assigned_driver?.name ?? <span className="rc-muted">Sin asignar</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function NewPackageForm({ drivers, onCreated, onCancel }: { drivers: DriverSummary[]; onCreated(): void; onCancel(): void }) {
  const { api } = useAdmin();
  const [form, setForm] = useState({ tracking_code: "", recipient_name: "", recipient_phone: "", address: "", notes: "", driver_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createPackage({
        tracking_code: form.tracking_code.trim(),
        recipient_name: form.recipient_name.trim(),
        recipient_phone: form.recipient_phone.trim(),
        notes: form.notes.trim(),
        address: { raw_text: form.address.trim() },
        driver_id: form.driver_id || null,
      });
      onCreated();
      navigate({ name: "package", id: created.id });
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-card new-package" onSubmit={(e) => void submit(e)} aria-label="Nuevo paquete">
      <h2>Nuevo paquete</h2>
      <div className="form-grid">
        <TextField label="Código de seguimiento" required value={form.tracking_code} onChange={set("tracking_code")} />
        <TextField label="Destinatario" value={form.recipient_name} onChange={set("recipient_name")} />
        <TextField label="Teléfono" type="tel" value={form.recipient_phone} onChange={set("recipient_phone")} />
        <TextField label="Dirección" required value={form.address} onChange={set("address")} placeholder="Calle, altura, localidad" />
        <TextField label="Observaciones" value={form.notes} onChange={set("notes")} />
        <label className="rc-field">
          <span className="rc-field__label">Repartidor</span>
          <select className="select" value={form.driver_id} onChange={set("driver_id")}>
            <option value="">Sin asignar</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy} loadingLabel="Creando…" disabled={!form.tracking_code.trim() || !form.address.trim()}>
          Crear paquete
        </Button>
      </div>
    </form>
  );
}

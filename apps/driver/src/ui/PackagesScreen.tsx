import {
  FAILURE_REASONS,
  googleMapsUrl,
  PACKAGE_STATUS_LABEL,
  type PackageStatus,
  telUrl,
  type VisitOutcome,
  wazeUrl,
  whatsappUrl,
} from "@routcontrol/domain";
import {
  Alert,
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  formatElapsed,
  IconArrowLeft,
  IconCamera,
  IconNavigate,
  IconPackage,
  IconPhone,
  IconSearch,
  IconWhatsApp,
  ListItem,
  LoadingState,
} from "@routcontrol/ui";
import { useEffect, useMemo, useState } from "react";

import { PENDING_STATUSES } from "../delivery/deliveries";
import { preparePhoto } from "../delivery/photo";
import type { LocalPackage } from "../store/db";
import { useApp, useNow, useStore } from "./hooks";

const STATUS_TONE: Record<PackageStatus, BadgeTone> = {
  CREATED: "neutral",
  ASSIGNED: "info",
  IN_ROUTE: "accent",
  DELIVERED: "success",
  FAILED: "warning",
  RESCHEDULED: "warning",
  RETURNED: "neutral",
  CANCELLED: "neutral",
};

type Filter = "pending" | "delivered" | "failed";

const FILTERS: Array<{ id: Filter; label: string; match: (s: PackageStatus) => boolean }> = [
  { id: "pending", label: "Pendientes", match: (s) => s === "ASSIGNED" || s === "IN_ROUTE" },
  { id: "delivered", label: "Entregados", match: (s) => s === "DELIVERED" },
  { id: "failed", label: "No entregados", match: (s) => s === "FAILED" || s === "RESCHEDULED" },
];

export function StatusBadge({ status }: { status: PackageStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PACKAGE_STATUS_LABEL[status]}</Badge>;
}

/** "Mis paquetes" (lista) y la ficha de entrega de cada uno. */
export function PackagesScreen({ selected, onSelect }: { selected: string | null; onSelect(id: string | null): void }) {
  const app = useApp();
  const state = useStore(app.deliveries);
  const pkg = selected ? state.packages.find((p) => p.id === selected) : null;
  if (selected && pkg) return <PackageDetail pkg={pkg} onBack={() => onSelect(null)} onOpen={onSelect} />;
  return <PackageList onSelect={onSelect} />;
}

function PackageList({ onSelect }: { onSelect(id: string): void }) {
  const app = useApp();
  const state = useStore(app.deliveries);
  const outbox = useStore(app.outbox);
  const [filter, setFilter] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, state.packages.filter((p) => f.match(p.status)).length])) as Record<Filter, number>,
    [state.packages],
  );
  const shown = state.packages
    .filter((p) => FILTERS.find((f) => f.id === filter)!.match(p.status))
    .filter((p) => !q || [p.tracking_code, p.recipient_name, p.address.raw_text].some((t) => t.toLowerCase().includes(q)));

  return (
    <main className="screen screen--tabs">
      <header className="screen-header">
        <h1 className="screen-title">Mis paquetes</h1>
        <p className="rc-muted screen-subtitle">
          {state.status === "ready" ? `${counts.pending} pendientes · ${counts.delivered} entregados` : "Los paquetes que tenés asignados."}
        </p>
      </header>
      <div className="screen-body">
        {state.offline && state.status === "ready" ? (
          <Alert tone="info">Sin conexión: ves la última lista guardada en el teléfono.</Alert>
        ) : null}
        {outbox.failed > 0 ? (
          <Alert tone="error" title="Hay registros que el servidor rechazó">
            Mirá el detalle en Perfil › Diagnóstico y avisale a tu supervisor.
          </Alert>
        ) : null}
        {state.status === "loading" ? <LoadingState label="Cargando tus paquetes…" /> : null}
        {state.status === "error" ? (
          <Alert tone="error" action={<Button variant="secondary" size="sm" onClick={() => void app.deliveries.refresh()}>Reintentar</Button>}>
            No se pudo cargar la lista: {state.error}
          </Alert>
        ) : null}
        {state.status === "ready" ? (
          state.packages.length === 0 ? (
            <EmptyState title="No tenés paquetes asignados." description="Cuando tu empresa te asigne paquetes, aparecen acá." />
          ) : (
            <>
              <div className="pkg-filters" role="group" aria-label="Filtrar paquetes">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className="pkg-filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} · {counts[f.id]}
                  </button>
                ))}
              </div>
              <label className="pkg-search">
                <span className="rc-visually-hidden">Buscar paquete</span>
                <IconSearch size={18} />
                <input type="search" placeholder="Código, destinatario o dirección" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {shown.length === 0 ? (
                <EmptyState title="No hay paquetes en esta lista." />
              ) : (
                <ul className="items" aria-label="Paquetes">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <ListItem
                        tone={p.status === "DELIVERED" ? "ok" : p.status === "FAILED" || p.status === "RESCHEDULED" ? "warn" : "accent"}
                        icon={<IconPackage />}
                        title={p.recipient_name || p.tracking_code}
                        detail={`${p.address.raw_text} · ${p.tracking_code}`}
                        trailing={<StatusBadge status={p.status} />}
                        onClick={() => onSelect(p.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        ) : null}
      </div>
    </main>
  );
}

/** Llamar, WhatsApp y Navegar (enlaces externos, sin API de Google). */
export function ContactActions({ pkg }: { pkg: LocalPackage }) {
  const app = useApp();
  const [navigating, setNavigating] = useState(false);
  const tel = telUrl(pkg.recipient_phone);
  const wa = whatsappUrl(pkg.recipient_phone);
  return (
    <>
      <div className="contact-actions">
        {tel ? (
          <a className="contact-action" href={tel} onClick={() => void app.deliveries.logContact(pkg, "PHONE")}>
            <IconPhone />
            Llamar
          </a>
        ) : null}
        {wa ? (
          <a className="contact-action" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => void app.deliveries.logContact(pkg, "WHATSAPP")}>
            <IconWhatsApp />
            WhatsApp
          </a>
        ) : null}
        <button type="button" className="contact-action" aria-expanded={navigating} onClick={() => setNavigating((v) => !v)}>
          <IconNavigate />
          Navegar
        </button>
      </div>
      {navigating ? (
        <div className="navigate-choices" role="group" aria-label="Navegar con">
          <a className="rc-btn rc-btn--secondary rc-btn--block" href={googleMapsUrl(pkg.address)} target="_blank" rel="noopener noreferrer">
            Google Maps
          </a>
          <a className="rc-btn rc-btn--secondary rc-btn--block" href={wazeUrl(pkg.address)} target="_blank" rel="noopener noreferrer">
            Waze
          </a>
        </div>
      ) : null}
      {!tel ? <p className="rc-muted contact-note">Este paquete no tiene teléfono del destinatario.</p> : null}
    </>
  );
}

function PackageDetail({ pkg, onBack, onOpen }: { pkg: LocalPackage; onBack(): void; onOpen(id: string): void }) {
  const app = useApp();
  const state = useStore(app.deliveries);
  const wd = useStore(app.workday);
  const active = state.activeVisit;
  const visiting = active?.package_id === pkg.id;
  const pending = PENDING_STATUSES.includes(pkg.status);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      await app.deliveries.startVisit(pkg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la visita.");
    }
  }

  return (
    <main className="screen">
      <header className="detail-header">
        <button type="button" className="rc-icon-btn" aria-label="Volver" onClick={onBack}>
          <IconArrowLeft />
        </button>
        <div className="detail-header__text">
          <h1>Ficha de entrega</h1>
          <span className="rc-muted">{pkg.tracking_code}</span>
        </div>
      </header>
      <div className="screen-body">
        <section className="stop-card" aria-label="Destino">
          <div className="stop-card__head">
            <span className="rc-eyebrow">Destino</span>
            <StatusBadge status={pkg.status} />
          </div>
          <div className="stop-card__who">
            <span className="stop-card__icon" aria-hidden="true">
              <IconPackage size={22} />
            </span>
            <div>
              <div className="stop-card__address">{pkg.address.raw_text}</div>
              <div className="rc-muted">{[pkg.recipient_name, pkg.recipient_phone].filter(Boolean).join(" · ") || "Sin datos del destinatario"}</div>
            </div>
          </div>
          {pkg.notes ? <p className="stop-card__notes">{pkg.notes}</p> : null}
          <ContactActions pkg={pkg} />
        </section>

        {error ? <Alert tone="error">{error}</Alert> : null}

        {pending && visiting ? <VisitPanel pkg={pkg} onDone={onBack} /> : null}
        {pending && !visiting && active ? (
          <Alert tone="warning" title="Tenés otra visita en curso" action={<Button variant="secondary" size="sm" onClick={() => onOpen(active.package_id)}>Ir a esa visita</Button>}>
            Terminala antes de empezar esta.
          </Alert>
        ) : null}
        {pending && !active ? (
          wd.phase === "active" ? (
            <Button size="lg" block onClick={() => void start()}>
              Llegué: iniciar visita
            </Button>
          ) : (
            <Alert tone="info">Para registrar la visita, iniciá la jornada desde Inicio.</Alert>
          )
        ) : null}
        {!pending ? (
          <Alert tone={pkg.status === "DELIVERED" ? "success" : "info"} title={PACKAGE_STATUS_LABEL[pkg.status]}>
            Este paquete ya no tiene visitas pendientes.
          </Alert>
        ) : null}
      </div>
    </main>
  );
}

/** La visita en curso: cronómetro, resultado, motivo, foto y confirmar. */
function VisitPanel({ pkg, onDone }: { pkg: LocalPackage; onDone(): void }) {
  const app = useApp();
  const { activeVisit } = useStore(app.deliveries);
  const now = useNow();
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [reason, setReason] = useState<VisitOutcome | null>(null);
  const [attribution, setAttribution] = useState<"RECIPIENT" | "LOGISTIC" | null>(null);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<{ data: ArrayBuffer; type: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  if (!activeVisit) return null;
  const outcome: VisitOutcome | null = delivered ? "DELIVERED" : reason;
  const needsNotes = outcome === "OTHER" && !notes.trim();
  const needsAttribution = outcome === "OTHER" && !attribution;
  const ready = outcome !== null && !needsNotes && !needsAttribution;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    const prepared = await preparePhoto(file);
    setPhoto(prepared);
    setPreview(typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([prepared.data], { type: prepared.type })) : null);
  }

  async function confirm() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      await app.deliveries.finishVisit({ outcome, notes: notes.trim(), attribution, photo });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la visita.");
      setBusy(false);
    }
  }

  return (
    <section className="visit-panel" aria-label="Visita en curso">
      <div className="visit-panel__clock">
        <span className="clock__label">Visita en curso</span>
        <span className="visit-panel__time" aria-label="Tiempo de visita">
          {formatElapsed(activeVisit.started_at, now)}
        </span>
      </div>

      <div className="visit-result" role="group" aria-label="Resultado">
        <button type="button" className="visit-result__option visit-result__option--ok" aria-pressed={delivered === true} onClick={() => { setDelivered(true); setReason(null); }}>
          Entregado
        </button>
        <button type="button" className="visit-result__option visit-result__option--fail" aria-pressed={delivered === false} onClick={() => setDelivered(false)}>
          No entregado
        </button>
      </div>

      {delivered === false ? (
        <fieldset className="visit-reasons">
          <legend>¿Qué pasó?</legend>
          {FAILURE_REASONS.map((r) => (
            <label key={r.outcome} className="visit-reason">
              <input type="radio" name="motivo" value={r.outcome} checked={reason === r.outcome} onChange={() => setReason(r.outcome)} />
              {r.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      {outcome === "OTHER" ? (
        <fieldset className="visit-reasons">
          <legend>¿De quién fue el problema?</legend>
          <label className="visit-reason">
            <input type="radio" name="atribucion" checked={attribution === "RECIPIENT"} onChange={() => setAttribution("RECIPIENT")} />
            Del destinatario
          </label>
          <label className="visit-reason">
            <input type="radio" name="atribucion" checked={attribution === "LOGISTIC"} onChange={() => setAttribution("LOGISTIC")} />
            De la logística (dirección, acceso, otro)
          </label>
        </fieldset>
      ) : null}

      {outcome ? (
        <label className="rc-field">
          <span className="rc-field__label">{outcome === "OTHER" ? "Contá qué pasó" : "Observaciones (opcional)"}</span>
          <textarea className="rc-field__input visit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      ) : null}

      {outcome ? (
        <div className="visit-photo">
          {preview ? <img src={preview} alt="Foto de la visita" className="visit-photo__preview" /> : null}
          <label className="rc-btn rc-btn--secondary rc-btn--block visit-photo__pick">
            <IconCamera />
            {photo ? "Sacar otra foto" : "Agregar foto (opcional)"}
            <input type="file" accept="image/*" capture="environment" className="rc-visually-hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          {photo ? <p className="rc-muted visit-photo__hint">La foto queda en el teléfono y se sube cuando haya señal.</p> : null}
        </div>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button size="lg" block disabled={!ready} loading={busy} loadingLabel="Guardando…" onClick={() => void confirm()}>
        {outcome === "DELIVERED" ? "Confirmar entrega" : "Confirmar"}
      </Button>
      <Button variant="ghost" block onClick={() => void app.deliveries.cancelVisit()}>
        Cancelar visita
      </Button>
      <p className="rc-muted visit-photo__hint">
        {pkg.recipient_name ? `${pkg.recipient_name} · ` : ""}
        {pkg.tracking_code}
      </p>
    </section>
  );
}

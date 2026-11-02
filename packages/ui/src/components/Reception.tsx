import { RECEPTION_LABEL, type Reception, type ReceptionLevel } from "@routcontrol/domain";

import { Badge, type BadgeTone } from "./Surfaces";

const TONE: Record<ReceptionLevel, BadgeTone> = { green: "success", yellow: "warning", red: "error", gray: "neutral" };

/**
 * Indicador de recepción del domicilio (§7.3, ADR-022), como el chip "Suele recibir" de
 * Jornada.dc.html: un punto y el texto, en el tono del nivel. Informativo.
 */
export function ReceptionBadge({ reception }: { reception: Reception | undefined | null }) {
  if (!reception) return null;
  const pct = reception.score === null ? "" : ` (${Math.round(reception.score * 100)} %)`;
  const title =
    reception.level === "gray"
      ? `Menos de 3 visitas que cuenten (${reception.computable}).`
      : `Recibió${pct} en ${reception.computable} visitas que cuentan (las más recientes pesan más).`;
  return (
    <span className="rc-reception" title={title}>
      <Badge tone={TONE[reception.level]}>
        <span className={`rc-reception__dot rc-reception__dot--${reception.level}`} aria-hidden="true" />
        {RECEPTION_LABEL[reception.level]}
      </Badge>
    </span>
  );
}

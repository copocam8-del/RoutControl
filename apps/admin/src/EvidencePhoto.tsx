import { useEffect, useState } from "react";

import { useAdmin } from "./adminApp";

/** Foto de una visita: la API exige la sesión, así que se baja y se muestra desde memoria. */
export function EvidencePhoto({ id, alt }: { id: string; alt: string }) {
  const { api } = useAdmin();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    api
      .evidencePhoto(id)
      .then((blob) => {
        if (!alive || typeof URL.createObjectURL !== "function") return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id]);

  if (failed) return <span className="evidence evidence--failed">No se pudo cargar la foto</span>;
  if (!src) return <span className="evidence evidence--loading" aria-label="Cargando foto" />;
  return (
    <a className="evidence" href={src} target="_blank" rel="noopener noreferrer">
      <img src={src} alt={alt} />
    </a>
  );
}

/**
 * `fetch` de Node que se comporta como el navegador frente a la API: guarda las cookies que
 * manda el servidor (respetando Path), las devuelve en las peticiones siguientes y agrega el Origin
 * de la página. Solo para las pruebas contra el backend real.
 */
export function browserLikeFetch(origin: string, opts: { online?: () => boolean } = {}) {
  const jar = new Map<string, { value: string; path: string }>();

  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (opts.online && !opts.online()) throw new TypeError("Failed to fetch (modo avión simulado)");
    const url = new URL(String(input), origin);
    const headers = new Headers(init.headers);
    const cookies = [...jar.entries()]
      .filter(([, c]) => url.pathname.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`);
    if (cookies.length && init.credentials === "include") headers.set("Cookie", cookies.join("; "));
    if ((init.method ?? "GET") !== "GET") headers.set("Origin", origin);

    const response = await fetch(url, { ...init, headers, credentials: undefined });
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      const path = attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) ?? "/";
      if (!value || attrs.some((a) => a.toLowerCase() === "max-age=0")) jar.delete(name!);
      else jar.set(name!, { value, path });
    }
    return response;
  };

  return { fetch: fetchImpl, jar };
}

import { liveMessageSchema, type LivePosition } from "@routcontrol/domain";

/**
 * Cliente del mapa en vivo (ADR-017). Abre `/ws/live`, se autentica con el primer mensaje (el
 * token no va en la URL) y entrega las posiciones. Si se corta, reintenta con espera creciente;
 * si el servidor rechaza el token (4401/4403), lo renueva antes de reintentar. Mientras no está
 * conectado, el inicio sigue con la consulta cada 30 s.
 */
export type LiveStatus = "connecting" | "live" | "offline";

export interface LiveOptions {
  origin: string;
  getToken: (force: boolean) => Promise<string | null>;
  onPosition: (p: LivePosition) => void;
  onStatus: (s: LiveStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  /** Espera antes del reintento n (desde 0). */
  retryDelayMs?: (attempt: number) => number;
}

export function liveUrl(origin: string, here: string = globalThis.location?.href ?? "http://localhost/"): string {
  const url = new URL("/ws/live", origin || here);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const defaultDelay = (n: number) => Math.min(30_000, 1_000 * 2 ** n);

export function connectLive(opts: LiveOptions): () => void {
  const WS = opts.WebSocketImpl ?? globalThis.WebSocket;
  const delay = opts.retryDelayMs ?? defaultDelay;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let forceToken = false;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    opts.onStatus("offline");
    timer = setTimeout(() => void open(), delay(attempt++));
  };

  async function open() {
    timer = null;
    if (stopped || !WS) return;
    opts.onStatus("connecting");
    let token: string | null;
    try {
      token = await opts.getToken(forceToken);
    } catch {
      token = null;
    }
    if (stopped) return;
    if (!token) return schedule();
    forceToken = false;
    const ws = new WS(liveUrl(opts.origin));
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", access: token }));
    ws.onmessage = (m) => {
      let data: unknown;
      try {
        data = JSON.parse(String(m.data));
      } catch {
        return;
      }
      const parsed = liveMessageSchema.safeParse(data);
      if (!parsed.success) return;
      if (parsed.data.type === "ready") {
        attempt = 0;
        opts.onStatus("live");
      } else if (parsed.data.type === "position") {
        opts.onPosition(parsed.data);
      }
    };
    ws.onclose = (e) => {
      if (socket !== ws) return;
      socket = null;
      if (e.code === 4401 || e.code === 4403) forceToken = true;
      schedule();
    };
  }

  void open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    const ws = socket;
    socket = null;
    ws?.close();
  };
}

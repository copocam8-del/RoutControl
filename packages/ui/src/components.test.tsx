import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Alert,
  Avatar,
  Button,
  Chip,
  formatLongDate,
  formatSpan,
  formatTime,
  greeting,
  initials,
  ListItem,
  splitName,
  Wordmark,
  Checkbox,
  EmptyState,
  ErrorState,
  formatAgo,
  formatDistance,
  formatDuration,
  formatElapsed,
  Loadable,
  type LoadState,
  StatusLine,
  TextField,
  useLoad,
} from "./index";

describe("Button", () => {
  it("cargando: deshabilitado, aria-busy y texto de carga", () => {
    render(
      <Button loading loadingLabel="Ingresando…">
        Ingresar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Ingresando…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("es type=button por defecto (no envía formularios sin querer)", () => {
    render(<Button>Algo</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("aplica la variante y el tamaño", () => {
    render(
      <Button variant="accent" size="lg" block>
        Grande
      </Button>,
    );
    expect(screen.getByRole("button").className).toBe("rc-btn rc-btn--accent rc-btn--lg rc-btn--block");
  });
});

describe("TextField", () => {
  it("asocia etiqueta, ayuda y error al campo", () => {
    render(<TextField label="Email" hint="El de tu empresa" error="Falta el email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = input
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(["El de tu empresa", "Falta el email"]);
  });

  it("pasa los atributos del input (teclados de teléfono)", () => {
    render(<TextField label="Email" type="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} />);
    const input = screen.getByLabelText("Email");
    expect([input.getAttribute("type"), input.getAttribute("autocapitalize"), input.getAttribute("autocorrect")]).toEqual([
      "email",
      "off",
      "off",
    ]);
  });
});

describe("Checkbox", () => {
  it("se activa tocando el texto", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Mostrar contraseña" onChange={onChange} />);
    await userEvent.click(screen.getByText("Mostrar contraseña"));
    expect(onChange).toHaveBeenCalled();
  });
});

describe("Alert", () => {
  it("error y advertencia se anuncian enseguida; info y éxito, con cortesía", () => {
    render(
      <>
        <Alert tone="error">e</Alert>
        <Alert tone="warning">w</Alert>
        <Alert tone="info">i</Alert>
        <Alert tone="success">s</Alert>
      </>,
    );
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["e", "w"]);
    expect(screen.getAllByRole("status").map((a) => a.textContent)).toEqual(["i", "s"]);
  });
});

describe("StatusLine", () => {
  it("con onClick es un botón", async () => {
    const onClick = vi.fn();
    render(<StatusLine tone="error" title="GPS detenido" detail="Tocá para revisar" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: /GPS detenido/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Loadable: un solo estado a la vez", () => {
  const view = (state: LoadState<string[]>, onRetry = vi.fn()) =>
    render(
      <Loadable
        state={state}
        onRetry={onRetry}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Nada todavía" />}
        loadingLabel="Cargando datos…"
      >
        {(d) => <p>datos: {d.join(",")}</p>}
      </Loadable>,
    );

  it("cargando", () => {
    view({ status: "loading" });
    expect(screen.getByRole("status").textContent).toBe("Cargando datos…");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("error con Reintentar, sin 'Cargando'", async () => {
    const onRetry = vi.fn();
    view({ status: "error", message: "Sin conexión" }, onRetry);
    expect(screen.getByRole("alert").textContent).toBe("Sin conexión");
    expect(screen.queryByText(/Cargando/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("vacío", () => {
    view({ status: "ready", data: [] });
    expect(screen.getByText("Nada todavía")).toBeTruthy();
  });

  it("datos", () => {
    view({ status: "ready", data: ["a", "b"] });
    expect(screen.getByText("datos: a,b")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("sin onRetry no muestra un botón que no hace nada", () => {
    render(<ErrorState message="Algo falló" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("useLoad", () => {
  const describeError = () => "falló";

  it("cargando → datos", async () => {
    const load = async () => 42;
    const { result } = renderHook(() => useLoad(load, describeError));
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: 42 }));
  });

  it("cargando → error → reintentar → datos", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("x");
      return "ok";
    };
    const { result } = renderHook(() => useLoad(load, describeError));
    await waitFor(() => expect(result.current[0]).toEqual({ status: "error", message: "falló" }));
    result.current[1]();
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "ok" }));
  });

  it("una respuesta vieja no pisa la nueva", async () => {
    let resolveSlow!: (v: string) => void;
    const slow = () => new Promise<string>((r) => (resolveSlow = r));
    const fast = async () => "nueva";
    const { result, rerender } = renderHook(({ load }) => useLoad(load, describeError), {
      initialProps: { load: slow as () => Promise<string> },
    });
    rerender({ load: fast });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "nueva" }));
    resolveSlow("vieja");
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current[0]).toEqual({ status: "ready", data: "nueva" });
  });
});

describe("formatos", () => {
  it("duraciones, distancias, cronómetro y 'hace'", () => {
    expect([formatDuration(59), formatDuration(1200), formatDuration(3900)]).toEqual(["1 min", "20 min", "1 h 05 min"]);
    expect([formatDistance(850.4), formatDistance(1234.5)]).toEqual(["850 m", "1,2 km"]);
    expect(formatElapsed("2026-11-01T12:00:00Z", Date.parse("2026-11-01T13:02:03Z"))).toBe("1:02:03");
    expect([formatAgo(null, 0), formatAgo(0, 30_000), formatAgo(0, 600_000)]).toEqual(["nunca", "hace 30 s", "hace 10 min"]);
  });
});

describe("formatos de las maquetas", () => {
  it("hora en 24 h, fecha larga con mayúscula, duración entre dos momentos y saludo", () => {
    expect(formatTime(new Date(2026, 10, 1, 19, 5).toISOString())).toBe("19:05");
    expect(formatLongDate(new Date(2026, 10, 1, 10))).toBe("Domingo 1 de noviembre");
    expect(formatSpan("2026-11-01T08:12:00Z", "2026-11-01T16:40:00Z")).toBe("8 h 28 min");
    expect([greeting(new Date(2026, 10, 1, 8)), greeting(new Date(2026, 10, 1, 15)), greeting(new Date(2026, 10, 1, 23))]).toEqual([
      "Buen día,",
      "Buenas tardes,",
      "Buenas noches,",
    ]);
  });
});

describe("marca y avatar", () => {
  it.each([
    ["Juan Pérez", "JP"],
    ["Repartidor 1 (demo)", "R1"],
    ["repartidor1@norte.demo", "R1"],
    ["Dueña Norte (demo)", "DN"],
    ["camila", "CA"],
  ])("iniciales de %s → %s", (name, expected) => expect(initials(name)).toBe(expected));

  it("el nombre se parte en dos colores (Route + Control) y cualquier otro queda entero", () => {
    expect(splitName("RouteControl")).toEqual(["Route", "Control"]);
    expect(splitName("Repartos")).toEqual(["Repartos", ""]);
    render(<Wordmark name="RouteControl" />);
    expect(screen.getByText("Control").className).toBe("rc-brand__accent");
  });

  it("el avatar es decorativo (el nombre ya está escrito al lado)", () => {
    const { container } = render(<Avatar name="Juan Pérez" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Chip y ListItem", () => {
  it("una pastilla con onClick es un botón; sin onClick, no", async () => {
    const onClick = vi.fn();
    render(
      <>
        <Chip tone="ok">Conectado</Chip>
        <Chip onClick={onClick}>Empresa</Chip>
      </>,
    );
    expect(screen.queryByRole("button", { name: "Conectado" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Empresa" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("una fila solo es botón si hace algo", async () => {
    const onClick = vi.fn();
    render(
      <>
        <ListItem icon="i" title="Batería al 34%" detail="Llevá el cargador" />
        <ListItem icon="i" title="Diagnóstico" onClick={onClick} />
      </>,
    );
    expect(screen.queryByRole("button", { name: /Batería/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Diagnóstico/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("TextField con ícono y botón", () => {
  it("el botón queda dentro del campo y la etiqueta sigue asociada al input", () => {
    render(<TextField label="Contraseña" icon={<svg />} trailing={<button type="button">Mostrar</button>} />);
    const input = screen.getByLabelText("Contraseña");
    expect(input.tagName).toBe("INPUT");
    expect(input.closest(".rc-field")?.className).toContain("rc-field--trailing");
    expect(screen.getByRole("button", { name: "Mostrar" })).toBeTruthy();
  });
});

describe("useLoad con actualización periódica", () => {
  const describeError = () => "falló";

  it("vuelve a consultar sin pasar por 'cargando' y, si falla, deja los datos que había", async () => {
    let n = 0;
    const seen: unknown[] = [];
    const load = async () => {
      n += 1;
      if (n === 3) throw new Error("corte");
      return n;
    };
    const { result } = renderHook(() => {
      const r = useLoad(load, describeError, 40);
      seen.push(r[0]);
      return r;
    });
    await waitFor(() => expect((result.current[0] as { data?: number }).data ?? 0).toBeGreaterThanOrEqual(4), { timeout: 2000 });
    // Después del primer dato nunca volvió a "cargando" ni mostró el error del corte (el intento 3).
    const firstReady = seen.findIndex((s) => (s as { status: string }).status === "ready");
    expect(seen.slice(firstReady).every((s) => (s as { status: string }).status === "ready")).toBe(true);
    expect(seen.some((s) => (s as { data?: number }).data === 3)).toBe(false);
  });
});

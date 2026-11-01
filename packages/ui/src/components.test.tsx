import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Alert,
  Button,
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

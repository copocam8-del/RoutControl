import { Alert, Button, Card, Checkbox, TextField } from "@routcontrol/ui";
import { type FormEvent, useState } from "react";

import { useAdmin, useSession } from "../adminApp";
import { Brand } from "../Brand";

export function Login() {
  const { session, config } = useAdmin();
  const state = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await session.login(email, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <Card className="login__card">
        <Brand name={config.appName} subtitle="Panel de administración" />
        {state.status === "choose_organization" ? (
          <div className="rc-stack">
            <h1 className="login__title">¿Qué empresa querés administrar?</h1>
            {state.options.map((org) => (
              <Button key={org.id} variant="secondary" block onClick={() => void session.chooseOrganization(org.id)}>
                {org.name}
              </Button>
            ))}
          </div>
        ) : (
          <form className="rc-stack" onSubmit={(e) => void submit(e)}>
            <h1 className="login__title">Ingresar</h1>
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Contraseña"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Checkbox label="Mostrar contraseña" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            {state.status === "anonymous" && state.error ? <Alert tone="error">{state.error}</Alert> : null}
            <Button type="submit" block loading={busy} loadingLabel="Ingresando…">
              Ingresar
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

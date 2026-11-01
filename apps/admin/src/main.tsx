import "@routcontrol/ui/styles.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createAdminApp } from "./adminApp";
import { config } from "./config";

document.title = `${config.appName} · Panel`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App app={createAdminApp()} />
  </StrictMode>,
);

import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createApp } from "./app";
import { config } from "./config";
import { registerServiceWorker } from "./pwa";
import { App } from "./ui/App";

document.title = config.appName;
const app = createApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App app={app} />
  </StrictMode>,
);

registerServiceWorker();

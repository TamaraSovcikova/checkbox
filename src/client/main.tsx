import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Keep the installed PWA current. vite-plugin-pwa (registerType: autoUpdate) +
// the SW's skipWaiting/clientsClaim already swap in a new build and reload on the
// next app open. This adds an hourly update() poll so a long-open phone PWA also
// picks up new deploys without being manually reopened.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready
    .then((reg) => {
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch(() => {});
}

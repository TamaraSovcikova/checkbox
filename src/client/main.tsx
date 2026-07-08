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

// Ask the browser to keep our storage (the offline mutation queue + SW caches)
// from being evicted under disk pressure. The server (D1) is the source of truth,
// so this only hardens the offline experience; safe to ignore if unsupported.
if (navigator.storage?.persist) {
  navigator.storage.persisted().then((p) => {
    if (!p) navigator.storage.persist().catch(() => {});
  });
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/* Wait for the legacy loader to finish (script.js drops body.is-loading and
   adds #loader.is-done) before taking over the page with the React app. */
function boot() {
  const root = document.getElementById("root");
  if (!root) return;

  const loader = document.getElementById("loader");
  const body = document.body;

  const start = () => {
    root.hidden = false;
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  };

  if (!loader || (loader.classList.contains("is-done") && !body.classList.contains("is-loading"))) {
    start();
    return;
  }

  const observer = new MutationObserver(() => {
    if (loader.classList.contains("is-done")) {
      observer.disconnect();
      window.setTimeout(start, 120);
    }
  });
  observer.observe(loader, { attributes: true, attributeFilter: ["class"] });

  /* safety net: never trap the app behind the loader */
  window.setTimeout(start, 26000);
}

void boot();

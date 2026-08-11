import React from "react";
import ReactDOM from "react-dom/client";

import "../../../../src/index.css";

import { installResponsiveHarnessRuntime } from "./runtime";

installResponsiveHarnessRuntime(import.meta.env.VITE_RESPONSIVE_HARNESS_SENTINEL ?? null);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("responsive_harness_root_not_found");
}

// Install the fail-closed browser instrumentation before production modules evaluate.
void import("./HarnessApp").then(({ HarnessApp }) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <HarnessApp />
    </React.StrictMode>,
  );
});

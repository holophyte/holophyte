import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function init() {
  // Fetch Convex URL from the server (env vars aren't available in the browser bundle)
  const res = await fetch("/api/config");
  const config = await res.json();
  const convexUrl = config.convexUrl;

  if (!convexUrl) {
    console.error("CONVEX_URL not configured");
    return;
  }

  const convex = new ConvexReactClient(convexUrl);

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");
  const root = createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </React.StrictMode>,
  );
}

init();

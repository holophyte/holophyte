import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL ?? "",
);

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
);

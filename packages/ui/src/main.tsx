import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyAccent, readAccentCache } from "./appearance/accent.ts";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";

applyAccent(readAccentCache());

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

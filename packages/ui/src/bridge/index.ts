import type { KarontBridge } from "@karont/contract";
import { createWebBridge } from "./webBridge.ts";

declare global {
  interface Window {
    karont?: KarontBridge;
  }
}

export function getBridge(): KarontBridge | null {
  if (typeof window === "undefined") return null;
  if (window.karont) return window.karont;
  if (!import.meta.env.DEV) return null;
  const token = document.querySelector<HTMLMetaElement>('meta[name="karont-dev-bridge"]')?.content;
  if (!token) return null;
  webBridge ??= createWebBridge(token);
  return webBridge;
}

let webBridge: KarontBridge | null = null;

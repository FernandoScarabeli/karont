import type { KarontBridge } from "@karont/contract";

declare global {
  interface Window {
    karont?: KarontBridge;
  }
}

export function getBridge(): KarontBridge | null {
  return typeof window === "undefined" ? null : (window.karont ?? null);
}

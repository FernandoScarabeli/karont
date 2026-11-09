export type AccentId = "ivory" | "magenta" | "turquoise" | "lime" | "blue" | "coral";

export type AccentOption = { id: AccentId; name: string; color: string };

export const ACCENT_SETTING = "appearance.accent";
export const ACCENT_CACHE_KEY = "karont.accent";
export const DEFAULT_ACCENT: AccentId = "ivory";

/** Lista fixa, nesta ordem. Os valores espelham os tokens --k-accent-* de styles/tokens.css. */
export const ACCENTS: readonly AccentOption[] = [
  { id: "ivory", name: "Marfim", color: "#F3EEE3" },
  { id: "magenta", name: "Magenta", color: "#FF4F8B" },
  { id: "turquoise", name: "Turquesa", color: "#2DD4C4" },
  { id: "lime", name: "Lima", color: "#C6F135" },
  { id: "blue", name: "Azul elétrico", color: "#5B8CFF" },
  { id: "coral", name: "Coral", color: "#FF7A59" },
];

export function normalizeAccent(value: unknown): AccentId {
  return ACCENTS.find((accent) => accent.id === value)?.id ?? DEFAULT_ACCENT;
}

/** Grava a cor no <html>. No marfim (padrão) o atributo some. */
export function applyAccent(id: AccentId): void {
  const dataset = document.documentElement.dataset;
  if (id === DEFAULT_ACCENT) delete dataset.accent;
  else dataset.accent = id;
}

/** Cache local só para não piscar na abertura. O valor do serviço é o que vale. */
export function readAccentCache(): AccentId {
  try {
    return normalizeAccent(window.localStorage.getItem(ACCENT_CACHE_KEY));
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function writeAccentCache(id: AccentId): void {
  try {
    window.localStorage.setItem(ACCENT_CACHE_KEY, id);
  } catch {
    // Sem armazenamento local: só perde o cache.
  }
}

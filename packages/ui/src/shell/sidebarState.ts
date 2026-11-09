/** Chave em `settings` com a largura e o estado (recolhida ou não) da barra lateral. */
export const SIDEBAR_SETTING = "shell.sidebar";

export type SidebarSetting = { width: number; collapsed: boolean };

export type SidebarLimits = { min: number; max: number; defaultWidth: number };

/** Valor salvo válido, ou o padrão. A largura sempre cai dentro dos limites. */
export function parseSidebarSetting(value: unknown, limits: SidebarLimits): SidebarSetting {
  const fallback: SidebarSetting = { width: limits.defaultWidth, collapsed: false };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const { width, collapsed } = value as Record<string, unknown>;
  if (typeof width !== "number" || !Number.isFinite(width)) return fallback;
  if (typeof collapsed !== "boolean") return fallback;
  return { width: Math.round(Math.min(limits.max, Math.max(limits.min, width))), collapsed };
}

export function sameSidebarSetting(left: SidebarSetting, right: SidebarSetting): boolean {
  return left.width === right.width && left.collapsed === right.collapsed;
}

/** Lê um token de medida em pixels (ex.: `--k-sidebar-min-width`). */
export function readPixelToken(name: string, fallback: number): number {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

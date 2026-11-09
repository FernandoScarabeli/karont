import type { UsageWindow } from "@karont/contract";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Duração curta e sem zeros soltos: "menos de 1 min", "37 min", "4h 17min", "3d 2h". */
export function formatDuration(ms: number): string {
  if (!(ms >= MINUTE_MS)) return "menos de 1 min";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/** Há quanto tempo algo foi visto. `now` em milissegundos; data futura conta como agora. */
export function formatAgo(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (!(elapsed >= MINUTE_MS)) return "agora há pouco";
  if (elapsed < HOUR_MS) return `há ${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `há ${Math.floor(elapsed / HOUR_MS)}h`;
  return `há ${Math.floor(elapsed / DAY_MS)}d`;
}

export type WindowView = {
  /** A janela já zerou: o valor guardado é antigo e não deve ser mostrado. */
  expired: boolean;
  /** Porcentagem a mostrar; `null` quando vencida. */
  percent: number | null;
  /** Milissegundos até zerar; `null` quando não se sabe ou já zerou. */
  resetsIn: number | null;
};

export function windowView(window: UsageWindow, now: number): WindowView {
  if (window.resetsAt === null) {
    return { expired: false, percent: window.usedPercent, resetsIn: null };
  }
  const remaining = new Date(window.resetsAt).getTime() - now;
  if (remaining <= 0) return { expired: true, percent: null, resetsIn: null };
  return { expired: false, percent: window.usedPercent, resetsIn: remaining };
}

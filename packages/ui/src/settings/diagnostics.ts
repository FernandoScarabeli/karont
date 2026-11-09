import type { Agent } from "@karont/contract";

export type DiagnosticsCli = { id: string; name: string; location: string };

/** Só as CLIs encontradas; na personalizada sem caminho, mostra o comando. */
export function foundClis(agents: readonly Agent[]): DiagnosticsCli[] {
  const clis: DiagnosticsCli[] = [];
  for (const agent of agents) {
    if (!agent.found) continue;
    const location = agent.path ?? (agent.kind === "custom" ? agent.command : "");
    clis.push({ id: agent.id, name: agent.name, location });
  }
  return clis;
}

/** Data e hora em pt-BR; devolve o texto original se a data for inválida. */
export function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

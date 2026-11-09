import type { Agent, Project } from "@karont/contract";
import { findChatAgents } from "../agents/chatAgents.ts";
import { TERMINAL_CHOICE } from "../projects/initialAgent.ts";

export const MAX_PROJECT_NAME_LENGTH = 80;
export const ONBOARDING_STEP_COUNT = 4;

/** Com quem começar: o primeiro agente de chat encontrado; sem nenhum, Terminal. */
export function initialChoice(agents: readonly Agent[]): string {
  return findChatAgents(agents)[0]?.id ?? TERMINAL_CHOICE;
}

/** Uma escolha só vale se ainda existir entre os agentes de chat (ou for Terminal). */
export function validChoice(choice: string, agents: readonly Agent[]): string {
  if (choice === TERMINAL_CHOICE) return choice;
  return findChatAgents(agents).some((agent) => agent.id === choice)
    ? choice
    : initialChoice(agents);
}

/** Agentes encontrados que não conversam (só Terminal) e os não encontrados. */
export function groupOtherAgents(agents: readonly Agent[]): {
  foundWithoutChat: Agent[];
  missing: Agent[];
} {
  const chatIds = new Set(findChatAgents(agents).map((agent) => agent.id));
  return {
    foundWithoutChat: agents.filter((agent) => agent.found && !chatIds.has(agent.id)),
    missing: agents.filter((agent) => !agent.found),
  };
}

/** Tira as barras do fim (`/` ou `\`), menos quando o caminho é só a raiz. */
export function trimTrailingSeparators(path: string): string {
  const trimmed = path.trim();
  const stripped = trimmed.replace(/[\\/]+$/u, "");
  return stripped === "" ? trimmed : stripped;
}

/** Nome do projeto: o último pedaço do caminho, sem barra final, cortado a 80 caracteres. */
export function projectNameFromPath(path: string): string {
  const last = trimTrailingSeparators(path).split(/[\\/]/u).filter(Boolean).at(-1);
  return Array.from(last ?? "")
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .join("");
}

/** Projeto que já usa essa pasta, comparando sem a barra final. */
export function findProjectByPath(projects: readonly Project[], path: string): Project | undefined {
  const target = trimTrailingSeparators(path);
  return projects.find((project) => trimTrailingSeparators(project.path) === target);
}

/** Caminho absoluto no estilo de Linux, Windows ou rede. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\");
}

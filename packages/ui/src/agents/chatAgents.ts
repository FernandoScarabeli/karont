import type { Agent } from "@karont/contract";

/** Agentes com chat estruturado no Karont. O restante abre só como Terminal. */
const CHAT_AGENT_IDS: ReadonlySet<string> = new Set(["claude", "codex"]);

export function isChatAgentId(agentId: string): boolean {
  return CHAT_AGENT_IDS.has(agentId);
}

/** Agentes encontrados nesta máquina que sabem conversar. */
export function findChatAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter((agent) => agent.found && isChatAgentId(agent.id));
}

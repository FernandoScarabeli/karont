import type { AgentUsage } from "@karont/contract";

/** Troca a linha do agente (ou acrescenta) sem mexer na ordem das outras. */
export function upsertUsage(list: AgentUsage[], incoming: AgentUsage): AgentUsage[] {
  const index = list.findIndex((item) => item.agent === incoming.agent);
  if (index === -1) return [...list, incoming];
  const next = list.slice();
  next[index] = incoming;
  return next;
}

/** Junta a lista pedida com o que já chegou por evento; vale o mais recente de cada agente. */
export function mergeListed(current: AgentUsage[], listed: AgentUsage[]): AgentUsage[] {
  let next = listed;
  for (const item of current) {
    const found = next.find((candidate) => candidate.agent === item.agent);
    if (!found || Date.parse(item.observedAt) > Date.parse(found.observedAt)) {
      next = upsertUsage(next, item);
    }
  }
  return next;
}

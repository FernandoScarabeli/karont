export const TERMINAL_CHOICE = "terminal";

export type InitialAgentInput = {
  /** Escolha manual do usuário no composer; sempre vence. */
  manualChoice: string | null;
  /** `defaultAgent` do projeto, ou nulo/indefinido sem projeto ou sem agente padrão. */
  projectDefault: string | null | undefined;
  /** Último agente usado (ou `terminal`), já lido das configurações. */
  lastUsed: string | null | undefined;
  /** Ids dos agentes de chat encontrados. `null` enquanto a lista não chegou. */
  foundAgentIds: readonly string[] | null;
};

/**
 * Agente inicial do composer: escolha manual, depois o padrão do projeto (se estiver
 * entre os encontrados), depois o último usado, depois Terminal. É pura: o resultado
 * não depende da ordem em que o projeto e os agentes carregaram.
 */
export function resolveInitialAgent({
  manualChoice,
  projectDefault,
  lastUsed,
  foundAgentIds,
}: InitialAgentInput): string {
  if (manualChoice) return manualChoice;
  const found = foundAgentIds ?? [];
  if (projectDefault && found.includes(projectDefault)) return projectDefault;
  if (lastUsed === TERMINAL_CHOICE) return TERMINAL_CHOICE;
  if (lastUsed && found.includes(lastUsed)) return lastUsed;
  return TERMINAL_CHOICE;
}

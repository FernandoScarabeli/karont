import type { Conversation } from "@karont/contract";

type OfferConversation = Pick<Conversation, "projectId" | "state" | "worktreeId">;

const BUSY_STATES: ReadonlySet<Conversation["state"]> = new Set(["queued", "working", "waiting"]);

/**
 * Decide se a primeira mensagem de uma nova conversa deve parar para oferecer uma cópia
 * separada: só para agente (nunca Terminal), num projeto que usa Git, quando outra conversa
 * do mesmo projeto já está ocupada na pasta do projeto (sem `worktreeId`).
 */
export function shouldOfferSeparateCopy(input: {
  projectId: string | undefined;
  isTerminal: boolean;
  usesGit: boolean;
  conversations: readonly OfferConversation[];
}): boolean {
  if (!input.projectId || input.isTerminal || !input.usesGit) return false;
  return input.conversations.some(
    (conversation) =>
      conversation.projectId === input.projectId &&
      BUSY_STATES.has(conversation.state) &&
      conversation.worktreeId === undefined,
  );
}

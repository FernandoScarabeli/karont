import type { Conversation, Project } from "@karont/contract";

export type ConversationGroups = {
  /** Conversas de cada projeto existente, na ordem recebida. */
  byProject: Map<string, Conversation[]>;
  /** Conversas sem projeto, ou de um projeto que não existe mais. */
  loose: Conversation[];
};

/**
 * Separa as conversas por projeto e as soltas, mantendo a ordem recebida.
 * Enquanto os projetos carregam, conversa com `projectId` não vai para as soltas,
 * para não pular de lugar quando a lista chegar.
 */
export function groupConversations(
  conversations: readonly Conversation[],
  projects: readonly Project[],
  projectsLoading: boolean,
): ConversationGroups {
  const byProject = new Map<string, Conversation[]>(
    projects.map((project) => [project.id, [] as Conversation[]]),
  );
  const loose: Conversation[] = [];
  for (const conversation of conversations) {
    const group = conversation.projectId ? byProject.get(conversation.projectId) : undefined;
    if (group) group.push(conversation);
    else if (!conversation.projectId || !projectsLoading) loose.push(conversation);
  }
  return { byProject, loose };
}

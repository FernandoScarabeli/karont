import { z } from "zod";
import { conversationAgentSchema } from "./conversations.ts";

export const SEARCH_QUERY_MAX = 200;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 20;

/** Trecho em segmentos (nunca HTML): `match` marca o que a tela destaca. */
export const searchSnippetSegmentSchema = z.strictObject({
  text: z.string(),
  match: z.boolean(),
});
export type SearchSnippetSegment = z.infer<typeof searchSnippetSegmentSchema>;

export const searchConversationResultSchema = z.strictObject({
  conversationId: z.string().min(1),
  title: z.string().min(1).max(240),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  agent: conversationAgentSchema,
  archived: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type SearchConversationResult = z.infer<typeof searchConversationResultSchema>;

export const searchProjectResultSchema = z.strictObject({
  projectId: z.string().min(1),
  name: z.string().min(1),
  icon: z.string(),
  workspaceId: z.string().min(1),
});
export type SearchProjectResult = z.infer<typeof searchProjectResultSchema>;

export const searchMessageResultSchema = z.strictObject({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  conversationTitle: z.string().min(1).max(240),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  agent: conversationAgentSchema,
  archived: z.boolean(),
  author: z.enum(["user", "agent"]),
  createdAt: z.iso.datetime({ offset: true }),
  snippet: z.array(searchSnippetSegmentSchema),
});
export type SearchMessageResult = z.infer<typeof searchMessageResultSchema>;

export const searchResultSchema = z.strictObject({
  conversations: z.array(searchConversationResultSchema),
  projects: z.array(searchProjectResultSchema),
  messages: z.array(searchMessageResultSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchMethods = {
  "search.query": {
    params: z.strictObject({
      query: z.string().min(1).max(SEARCH_QUERY_MAX),
      limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
    }),
    result: searchResultSchema,
  },
} as const;

import { z } from "zod";
import {
  conversationAgentSchema,
  errorPartSchema,
  permissionPartSchema,
  planPartSchema,
  questionPartSchema,
} from "./conversations.ts";

/** Limite de itens por lista; `total` conta todos. */
export const MAX_INBOX_ITEMS = 100;

const inboxItemBase = {
  /** Estável: a mesma pendência mantém o id entre listas. */
  id: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  partId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  conversationTitle: z.string().min(1).max(240),
  agent: conversationAgentSchema,
  createdAt: z.iso.datetime({ offset: true }),
};

/**
 * Cada item traz a parte da mensagem como o chat a vê. A tela responde pelos mesmos métodos
 * do chat: `conversation.respond` (permissão, pergunta, plano) e `conversation.retry` (erro).
 */
export const inboxItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...inboxItemBase,
    kind: z.literal("permission"),
    part: permissionPartSchema.extend({ state: z.literal("pending") }),
  }),
  z.strictObject({
    ...inboxItemBase,
    kind: z.literal("question"),
    part: questionPartSchema.extend({ state: z.literal("pending") }),
  }),
  z.strictObject({
    ...inboxItemBase,
    kind: z.literal("plan"),
    part: planPartSchema.extend({ state: z.literal("pending") }),
  }),
  z.strictObject({
    ...inboxItemBase,
    kind: z.literal("error"),
    part: errorPartSchema,
  }),
]);
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxItemKind = InboxItem["kind"];

export const inboxListSchema = z.strictObject({
  items: z.array(inboxItemSchema).max(MAX_INBOX_ITEMS),
  total: z.number().int().nonnegative(),
});
export type InboxList = z.infer<typeof inboxListSchema>;

export const inboxMethods = {
  "inbox.list": {
    params: z.strictObject({}),
    result: inboxListSchema,
  },
  "inbox.dismiss": {
    params: z.strictObject({ conversationId: z.string().min(1) }),
    result: z.strictObject({ dismissed: z.boolean() }),
  },
} as const;

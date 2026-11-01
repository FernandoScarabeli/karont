import { z } from "zod";

export const conversationAgentSchema = z.enum(["claude", "codex"]);
export const conversationModeSchema = z.enum(["read-only", "edit", "full"]);
export const reasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export const conversationStateSchema = z.enum(["idle", "working", "waiting", "error"]);
export const conversationSchema = z.strictObject({
  id: z.string().min(1),
  agent: conversationAgentSchema,
  title: z.string().min(1).max(240),
  cwd: z.string().min(1).max(4_096),
  mode: conversationModeSchema,
  model: z.string().min(1).max(80).optional(),
  effort: reasoningEffortSchema.optional(),
  state: conversationStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Conversation = z.infer<typeof conversationSchema>;

const messagePartBase = { id: z.string().min(1) };
export const questionOptionSchema = z.strictObject({
  label: z.string(),
  description: z.string().optional(),
});
export const messagePartSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...messagePartBase, type: z.literal("text"), markdown: z.string() }),
  z.strictObject({ ...messagePartBase, type: z.literal("thinking"), text: z.string() }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("action"),
    actionType: z.enum(["read", "edit", "write", "command", "search", "web", "other"]),
    title: z.string().max(240),
    input: z.string().max(8_192),
    output: z.string().max(65_600),
    truncated: z.boolean(),
    state: z.enum(["running", "waiting", "ok", "error"]),
    durationMs: z.number().int().min(0).nullable(),
  }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("permission"),
    tool: z.string().max(120),
    summary: z.string().max(8_192),
    description: z.string().max(8_192).optional(),
    options: z.array(z.enum(["allow", "always", "deny"])).min(1),
    state: z.enum(["pending", "allowed", "denied"]),
  }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("question"),
    questions: z
      .array(
        z.strictObject({
          question: z.string(),
          header: z.string().optional(),
          options: z.array(questionOptionSchema),
          multiSelect: z.boolean(),
          freeText: z.boolean(),
        }),
      )
      .min(1),
    state: z.enum(["pending", "answered"]),
  }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("plan"),
    markdown: z.string(),
    state: z.enum(["pending", "approved", "rejected"]),
    comment: z.string().optional(),
  }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("todos"),
    items: z.array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        state: z.enum(["pending", "working", "done"]),
        note: z.string().optional(),
      }),
    ),
  }),
  z.strictObject({
    ...messagePartBase,
    type: z.literal("error"),
    errorType: z.enum(["cli-not-found", "not-logged-in", "failed", "interrupted"]),
    text: z.string(),
    retryable: z.boolean(),
  }),
]);
export type MessagePart = z.infer<typeof messagePartSchema>;
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  author: z.enum(["user", "agent"]),
  status: z.enum(["streaming", "done", "interrupted", "error"]),
  parts: z.array(messagePartSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ConversationMessage = z.infer<typeof messageSchema>;

export const conversationOptionsSchema = z.strictObject({
  mode: conversationModeSchema.optional(),
  model: z.string().min(1).max(80).nullable().optional(),
  effort: reasoningEffortSchema.nullable().optional(),
});
export const conversationSendParamsSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1).max(65_536),
  plan: z.boolean().optional(),
});
export const agentModelsSchema = z.strictObject({
  agent: conversationAgentSchema,
  models: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      efforts: z.array(reasoningEffortSchema).optional(),
      defaultEffort: reasoningEffortSchema.optional(),
    }),
  ),
  efforts: z.array(reasoningEffortSchema),
  fetchedAt: z.iso.datetime({ offset: true }).optional(),
});

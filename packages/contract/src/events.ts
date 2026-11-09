import { z } from "zod";
import {
  conversationContextUsageSchema,
  conversationSchema,
  messagePartSchema,
  messageSchema,
} from "./conversations.ts";
import { inboxListSchema } from "./inbox.ts";
import {
  projectSchema,
  queueStatusSchema,
  recentFolderSchema,
  terminalInfoSchema,
  workspaceSchema,
} from "./methods.ts";
import { restorePointSummarySchema } from "./restore.ts";
import { agentUsageSchema } from "./usage.ts";
import { worktreeSchema } from "./worktrees.ts";

export const events = {
  "dev.streamTest.delta": z.strictObject({
    streamId: z.string(),
    seq: z.number().int().min(0),
    text: z.string(),
  }),
  "dev.streamTest.done": z.strictObject({
    streamId: z.string(),
    totalChunks: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
  }),
  "bridge.status": z.strictObject({
    state: z.enum(["connecting", "connected", "disconnected"]),
    detail: z.string().optional(),
  }),
  "terminals.output": z.strictObject({
    id: z.string().min(1),
    seq: z.number().int().min(0),
    data: z.string(),
  }),
  "terminals.resync": z.strictObject({ id: z.string().min(1) }),
  "terminals.exit": z.strictObject({
    id: z.string().min(1),
    exitCode: z.number().int().nullable(),
    signal: z.number().int().nullable(),
  }),
  "terminals.changed": z.strictObject({
    terminals: z.array(terminalInfoSchema),
  }),
  "folders.changed": z.strictObject({ folders: z.array(recentFolderSchema).max(8) }),
  "queue.changed": queueStatusSchema,
  "inbox.changed": inboxListSchema,
  "restore.changed": z.strictObject({
    conversationId: z.string().min(1),
    point: restorePointSummarySchema,
  }),
  "usage.updated": agentUsageSchema,
  "worktrees.changed": z.strictObject({
    projectId: z.string().min(1),
    worktrees: z.array(worktreeSchema),
  }),
  "projects.changed": z.strictObject({ projects: z.array(projectSchema) }),
  "workspaces.changed": z.strictObject({ workspaces: z.array(workspaceSchema) }),
  "conversations.workspaceMoved": z
    .strictObject({
      workspaceId: z.string().min(1),
      fromWorkspaceId: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(),
    })
    .refine(
      (payload) => (payload.fromWorkspaceId === undefined) !== (payload.projectId === undefined),
      "Informe exatamente um entre fromWorkspaceId e projectId.",
    ),
  "conversation.messageCreated": z.strictObject({
    conversationId: z.string(),
    message: messageSchema,
  }),
  "conversation.partUpdated": z.discriminatedUnion("kind", [
    z.strictObject({
      conversationId: z.string(),
      messageId: z.string(),
      kind: z.literal("upsert"),
      part: messagePartSchema,
    }),
    z.strictObject({
      conversationId: z.string(),
      messageId: z.string(),
      kind: z.literal("delta"),
      partId: z.string(),
      startOffset: z.number().int().nonnegative(),
      delta: z.string(),
      startedAt: z.number().int().nonnegative().optional(),
      endedAt: z.number().int().nonnegative().optional(),
    }),
  ]),
  "conversation.stateChanged": z.union([
    z.strictObject({ conversation: conversationSchema }),
    z.strictObject({
      conversation: conversationSchema,
      messageId: z.string(),
      messageStatus: z.enum(["streaming", "done", "interrupted", "error"]),
      messageStartedAt: z.number().int().nonnegative().optional(),
      messageEndedAt: z.number().int().nonnegative().optional(),
    }),
  ]),
  "conversation.contextUsage": z.strictObject({
    conversationId: z.string().min(1),
    ...conversationContextUsageSchema.shape,
  }),
  "conversation.deletedAll": z.strictObject({ deleted: z.number().int().nonnegative() }),
  "conversation.removed": z.strictObject({ id: z.string().min(1) }),
} as const satisfies Record<string, z.ZodType>;

export type EventName = keyof typeof events;
export type PayloadOf<E extends EventName> = z.infer<(typeof events)[E]>;
export type AnyEvent = { [E in EventName]: { event: E; payload: PayloadOf<E> } }[EventName];

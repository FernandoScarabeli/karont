import { z } from "zod";
import { conversationSchema, messagePartSchema, messageSchema } from "./conversations.ts";
import { recentFolderSchema, terminalInfoSchema } from "./methods.ts";

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
    }),
  ]),
} as const satisfies Record<string, z.ZodType>;

export type EventName = keyof typeof events;
export type PayloadOf<E extends EventName> = z.infer<(typeof events)[E]>;
export type AnyEvent = { [E in EventName]: { event: E; payload: PayloadOf<E> } }[EventName];

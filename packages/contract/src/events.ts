import { z } from "zod";

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
} as const satisfies Record<string, z.ZodType>;

export type EventName = keyof typeof events;
export type PayloadOf<E extends EventName> = z.infer<(typeof events)[E]>;
export type AnyEvent = { [E in EventName]: { event: E; payload: PayloadOf<E> } }[EventName];

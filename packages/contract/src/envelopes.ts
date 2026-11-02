import { z } from "zod";
import { type EventName, events } from "./events.ts";
import { type MethodName, methods } from "./methods.ts";

export const ERROR_CODES = [
  "invalid_request",
  "unknown_method",
  "unauthorized",
  "too_large",
  "unavailable",
  "internal",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

const idSchema = z.string().min(1).max(64);
const methodNameSchema = z.enum(Object.keys(methods) as [MethodName, ...MethodName[]]);
const eventNameSchema = z.enum(Object.keys(events) as [EventName, ...EventName[]]);
const requiredUnknown = z.unknown();

export const requestEnvelopeSchema = z
  .strictObject({
    type: z.literal("request"),
    id: idSchema,
    method: methodNameSchema,
    params: requiredUnknown,
  })
  .refine((value) => Object.hasOwn(value, "params"));

export const responseEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .strictObject({
      type: z.literal("response"),
      id: idSchema,
      ok: z.literal(true),
      result: requiredUnknown,
    })
    .refine((value) => Object.hasOwn(value, "result")),
  z.strictObject({
    type: z.literal("response"),
    id: idSchema,
    ok: z.literal(false),
    error: z.strictObject({ code: errorCodeSchema, message: z.string().max(2_000) }),
  }),
]);

export const eventEnvelopeSchema = z
  .strictObject({ type: z.literal("event"), event: eventNameSchema, payload: requiredUnknown })
  .refine((value) => Object.hasOwn(value, "payload"));

export const helloFrameSchema = z.strictObject({
  type: z.literal("hello"),
  contractVersion: z.number().int(),
  nonce: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const authFrameSchema = z.strictObject({
  type: z.literal("auth"),
  mac: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const readyFrameSchema = z.strictObject({ type: z.literal("ready") });

export const serverFrameSchema = z.discriminatedUnion("type", [
  helloFrameSchema,
  readyFrameSchema,
  responseEnvelopeSchema,
  eventEnvelopeSchema,
]);

export const clientFrameSchema = z.discriminatedUnion("type", [
  authFrameSchema,
  requestEnvelopeSchema,
]);

export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type HelloFrame = z.infer<typeof helloFrameSchema>;
export type AuthFrame = z.infer<typeof authFrameSchema>;
export type ReadyFrame = z.infer<typeof readyFrameSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
export type ClientFrame = z.infer<typeof clientFrameSchema>;

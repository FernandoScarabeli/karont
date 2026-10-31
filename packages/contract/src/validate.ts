import { z } from "zod";
import type { ErrorCode } from "./envelopes.ts";
import { type AnyEvent, type EventName, events, type PayloadOf } from "./events.ts";
import { type MethodName, methods, type ParamsOf, type ResultOf } from "./methods.ts";

export type ValidationError = {
  code: Extract<ErrorCode, "invalid_request" | "unknown_method">;
  message: string;
};
export type ValidationFailure = { ok: false; error: ValidationError };

export type ParsedRequest = {
  [M in MethodName]: { type: "request"; id: string; method: M; params: ParamsOf<M> };
}[MethodName];

const invalidRequest = (message: string): { ok: false; error: ValidationError } => ({
  ok: false,
  error: { code: "invalid_request", message },
});

export type ParseRequestResult = { ok: true; request: ParsedRequest } | ValidationFailure;
export type ParseResult<T> = { ok: true; result: T } | ValidationFailure;
export type ParseEventResult = { ok: true; event: AnyEvent } | ValidationFailure;

export function isMethodName(value: unknown): value is MethodName {
  return typeof value === "string" && Object.hasOwn(methods, value);
}

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && Object.hasOwn(events, value);
}

const requestHeaderSchema = z.strictObject({
  type: z.literal("request"),
  id: z.string().min(1).max(64),
  method: z.string(),
  params: z.unknown(),
});

export function parseRequest(input: unknown): ParseRequestResult {
  try {
    const header = requestHeaderSchema.safeParse(input);
    if (!header.success || !Object.hasOwn(input as object, "params")) {
      return invalidRequest("Envelope de requisição inválido.");
    }
    if (!isMethodName(header.data.method)) {
      return { ok: false, error: { code: "unknown_method", message: "Método desconhecido." } };
    }

    const parsedParams = methods[header.data.method].params.safeParse(header.data.params);
    if (!parsedParams.success) {
      return invalidRequest("Parâmetros inválidos para o método.");
    }

    return {
      ok: true,
      request: {
        type: "request",
        id: header.data.id,
        method: header.data.method,
        params: parsedParams.data,
      } as ParsedRequest,
    };
  } catch {
    return invalidRequest("Envelope de requisição inválido.");
  }
}

export function parseResult<M extends MethodName>(
  method: M,
  input: unknown,
): ParseResult<ResultOf<M>> {
  try {
    const parsed = methods[method].result.safeParse(input);
    if (!parsed.success) return invalidRequest("Resultado inválido para o método.");
    return { ok: true, result: parsed.data as ResultOf<M> };
  } catch {
    return invalidRequest("Resultado inválido para o método.");
  }
}

const eventEnvelopeHeaderSchema = z.strictObject({
  type: z.literal("event"),
  event: z.string(),
  payload: z.unknown(),
});

export function parseEvent(input: unknown): ParseEventResult {
  try {
    const envelope = eventEnvelopeHeaderSchema.safeParse(input);
    if (!envelope.success || !Object.hasOwn(input as object, "payload")) {
      return invalidRequest("Envelope de evento inválido.");
    }
    if (!isEventName(envelope.data.event)) {
      return invalidRequest("Evento desconhecido.");
    }

    const parsedPayload = events[envelope.data.event].safeParse(envelope.data.payload);
    if (!parsedPayload.success) return invalidRequest("Payload de evento inválido.");

    return {
      ok: true,
      event: { event: envelope.data.event, payload: parsedPayload.data } as {
        [E in EventName]: { event: E; payload: PayloadOf<E> };
      }[EventName],
    };
  } catch {
    return invalidRequest("Envelope de evento inválido.");
  }
}

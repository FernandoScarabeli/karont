import type { ErrorCode } from "./envelopes.ts";
import type { AnyEvent } from "./events.ts";
import type { MethodName, ParamsOf, ResultOf } from "./methods.ts";

export const CONTRACT_VERSION = 1;

export type { NativeBridge, NativeResult } from "./bridge.ts";
export type {
  AuthFrame,
  ClientFrame,
  ErrorCode,
  EventEnvelope,
  HelloFrame,
  ReadyFrame,
  RequestEnvelope,
  ResponseEnvelope,
  ServerFrame,
} from "./envelopes.ts";
export {
  authFrameSchema,
  clientFrameSchema,
  ERROR_CODES,
  errorCodeSchema,
  eventEnvelopeSchema,
  helloFrameSchema,
  MAX_FRAME_BYTES,
  readyFrameSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  serverFrameSchema,
} from "./envelopes.ts";
export type { AnyEvent, EventName, PayloadOf } from "./events.ts";
export { events } from "./events.ts";
export type { JsonValue, MethodName, ParamsOf, ResultOf, SettingKey } from "./methods.ts";
export { jsonValueSchema, MAX_SETTING_BYTES, methods, settingKeySchema } from "./methods.ts";
export type {
  ParsedRequest,
  ParseEventResult,
  ParseRequestResult,
  ParseResult,
  ValidationError,
  ValidationFailure,
} from "./validate.ts";
export { isEventName, isMethodName, parseEvent, parseRequest, parseResult } from "./validate.ts";

export interface KarontBridge {
  request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: AnyEvent) => void): () => void;
}

export class BridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

import {
  type ErrorCode,
  MAX_FRAME_BYTES,
  type ParsedRequest,
  parseRequest,
} from "@karont/contract";

export type IpcValidationResult =
  | { ok: true; request: ParsedRequest }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function validateIpcPayload(payload: unknown): IpcValidationResult {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return invalidRequest();
  }
  if (serialized === undefined) return invalidRequest();
  if (new TextEncoder().encode(serialized).byteLength > MAX_FRAME_BYTES) {
    return { ok: false, error: { code: "too_large", message: "A requisição excede 1 MiB." } };
  }

  if (
    !isRecord(payload) ||
    !Object.hasOwn(payload, "method") ||
    !Object.hasOwn(payload, "params")
  ) {
    return invalidRequest();
  }
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("method") || !keys.includes("params")) {
    return invalidRequest();
  }

  const parsed = parseRequest({
    type: "request",
    id: "ipc",
    method: payload.method,
    params: payload.params,
  });
  return parsed.ok ? { ok: true, request: parsed.request } : parsed;
}

function invalidRequest(): IpcValidationResult {
  return {
    ok: false,
    error: { code: "invalid_request", message: "Envelope de requisição inválido." },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { ErrorCode } from "./envelopes.ts";

export type NativeResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface NativeBridge {
  request(method: string, params: unknown): Promise<NativeResult>;
  onEvent(listener: (event: unknown) => void): () => void;
}

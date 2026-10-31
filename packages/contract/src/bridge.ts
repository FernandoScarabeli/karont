import { z } from "zod";
import type { ErrorCode } from "./envelopes.ts";

const absolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes("\u0000") &&
      (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")),
  );

export const pickFolderOptionsSchema = z
  .strictObject({ defaultPath: absolutePathSchema.optional() })
  .optional();

export type PickFolderOptions = z.infer<typeof pickFolderOptionsSchema>;
export type PickFolderResult = { path: string } | null;

export type NativeResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface NativeBridge {
  request(method: string, params: unknown): Promise<NativeResult>;
  onEvent(listener: (event: unknown) => void): () => void;
  pickFolder(options?: PickFolderOptions): Promise<PickFolderResult>;
}

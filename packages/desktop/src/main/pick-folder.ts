import { type PickFolderOptions, pickFolderOptionsSchema } from "@karont/contract";

export type PickFolderOptionsValidation =
  | { ok: true; options: Exclude<PickFolderOptions, undefined> }
  | { ok: false };

export function validatePickFolderOptions(input: unknown): PickFolderOptionsValidation {
  const parsed = pickFolderOptionsSchema.safeParse(input);
  return parsed.success ? { ok: true, options: parsed.data ?? {} } : { ok: false };
}

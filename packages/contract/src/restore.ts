import { z } from "zod";

export const restoreStateSchema = z.enum(["ready", "unavailable", "incomplete", "undone"]);
export const restoreUnavailableReasonSchema = z.enum(["no-git", "home", "timeout", "failed"]);

export const restorePointSummarySchema = z.strictObject({
  messageId: z.string().min(1),
  state: restoreStateSchema,
  reason: restoreUnavailableReasonSchema.optional(),
  changedFiles: z.number().int().nonnegative(),
  concurrent: z.boolean(),
  headMoved: z.boolean(),
});

export type RestorePointSummary = z.infer<typeof restorePointSummarySchema>;

export const MAX_RESTORE_CHANGED_FILES = 2_000;
export const MAX_RESTORE_PATCH_BYTES = 256 * 1024;

const restorePathSchema = z.string().min(1).max(4_096);

export const restoreFileChangeSchema = z.strictObject({
  path: restorePathSchema,
  oldPath: restorePathSchema.optional(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
});

export type RestoreFileChange = z.infer<typeof restoreFileChangeSchema>;

const restoreTargetSchema = z.strictObject({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});

export const restoreMethods = {
  "restore.list": {
    params: z.strictObject({ conversationId: z.string().min(1) }),
    result: z.strictObject({ points: z.array(restorePointSummarySchema) }),
  },
  "restore.changes": {
    params: restoreTargetSchema,
    result: z.strictObject({
      files: z.array(restoreFileChangeSchema).max(MAX_RESTORE_CHANGED_FILES),
      truncated: z.boolean(),
    }),
  },
  "restore.diff": {
    params: restoreTargetSchema.extend({ path: restorePathSchema }),
    result: z.strictObject({
      patch: z.string(),
      binary: z.boolean(),
      truncated: z.boolean(),
    }),
  },
  "restore.undoPreview": {
    params: restoreTargetSchema,
    result: z.strictObject({
      files: z.number().int().nonnegative(),
      userChanged: z.array(restorePathSchema),
      headMoved: z.boolean(),
      concurrent: z.boolean(),
      submodulesSkipped: z.array(restorePathSchema),
    }),
  },
  "restore.undo": {
    params: restoreTargetSchema,
    result: z.strictObject({
      restored: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    }),
  },
} as const;

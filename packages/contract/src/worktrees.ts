import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const worktreeSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  repoRoot: z.string().min(1).max(4_096),
  path: z.string().min(1).max(4_096),
  branch: z.string().min(1).max(512),
  baseCommit: z.string().min(1),
  createdAt: isoDateTimeSchema,
  mergedAt: isoDateTimeSchema.nullable(),
});

export type Worktree = z.infer<typeof worktreeSchema>;

export const worktreeStatusSchema = z.strictObject({
  dirtyFiles: z.number().int().nonnegative(),
  unmergedCommits: z.number().int().nonnegative(),
  busyConversations: z.number().int().nonnegative(),
  missing: z.boolean(),
});

export type WorktreeStatus = z.infer<typeof worktreeStatusSchema>;

export const worktreeMergeBlockedSchema = z.enum([
  "missing",
  "busy",
  "target-busy",
  "detached",
  "target-dirty",
  "target-merging",
  "nothing",
]);

export type WorktreeMergeBlocked = z.infer<typeof worktreeMergeBlockedSchema>;

export const worktreeMergePreviewSchema = z.strictObject({
  targetBranch: z.string().min(1).max(512).nullable(),
  commits: z.number().int().nonnegative(),
  uncommittedFiles: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  conflicts: z.array(z.string().max(4_096)),
  blocked: worktreeMergeBlockedSchema.nullable(),
  targetDirtyFiles: z.array(z.string().max(4_096)),
});

export type WorktreeMergePreview = z.infer<typeof worktreeMergePreviewSchema>;

export const worktreeMethods = {
  "worktrees.list": {
    params: z.strictObject({ projectId: z.string().min(1) }),
    result: z.strictObject({ worktrees: z.array(worktreeSchema) }),
  },
  "worktrees.create": {
    params: z.strictObject({ projectId: z.string().min(1) }),
    result: z.strictObject({ worktree: worktreeSchema }),
  },
  "worktrees.status": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: worktreeStatusSchema,
  },
  "worktrees.remove": {
    params: z.strictObject({ id: z.string().min(1), force: z.boolean().optional() }),
    result: z.strictObject({ removed: z.literal(true), branchKept: z.boolean() }),
  },
  "worktrees.mergePreview": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: worktreeMergePreviewSchema,
  },
  "worktrees.merge": {
    params: z.strictObject({ id: z.string().min(1) }),
    result: z.strictObject({
      merged: z.literal(true),
      commit: z.string().min(1),
      targetBranch: z.string().min(1).max(512),
    }),
  },
} as const;

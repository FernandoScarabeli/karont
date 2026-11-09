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
} as const;

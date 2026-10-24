import { z } from 'zod';
declare const EROS_APP_VERSION: string;
export const APP_VERSION = EROS_APP_VERSION;
export const VERSION = 1;
export const permissionModeSchema = z.enum(['ask', 'auto', 'full', 'readOnly']);
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export const capabilitySchema = z
  .object({
    mode: permissionModeSchema,
    status: z.enum(['available', 'partial', 'unavailable']),
    detail: z.string().max(500),
  })
  .strict();
export const approvalSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    dotId: z.string(),
    projectId: z.string(),
    operation: z.literal('rollback'),
    status: z.enum(['pending', 'denied', 'applied', 'failed']),
    createdAt: z.number(),
    decidedAt: z.number().nullable(),
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;
export const diagnosticItemSchema = z
  .object({
    category: z.string().max(80),
    label: z.string().max(80),
    status: z.enum(['available', 'unavailable', 'error', 'unverified']),
    value: z.string().max(500),
  })
  .strict();
export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>;
export const diagnosticSchema = z.array(diagnosticItemSchema).max(80);
export const runStateSchema = z.enum([
  'queued',
  'running',
  'paused',
  'waiting_quota',
  'waiting_approval',
  'recovery_needed',
  'completed',
  'failed',
  'cancelled',
]);
const idSchema = z.string().uuid();
const safeIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/);
export const layoutSchema = z
  .object({
    columns: z.union([z.literal(2), z.literal(4)]),
    editor: z.string().max(16000),
    editorOpen: z.boolean(),
  })
  .strict();
export const defaultLayout = {
  columns: 4 as const,
  editor:
    '// eros · Fase 0\n// Editor local de teste. Nenhum agente conectado.\n\nconst mensagem = "Olá, eros";\n',
  editorOpen: false,
};
export const requestSchema = z.discriminatedUnion('method', [
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.enum(['checkpoints.list', 'runs.pause', 'recovery.inspect']),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('checkpoints.create'),
      value: z.object({ runId: idSchema, operationId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.resume'),
      value: z
        .object({
          runId: idSchema,
          operationId: idSchema,
          newSessionConfirmed: z.boolean().default(false),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.autoResume'),
      value: z.object({ runId: idSchema, enabled: z.boolean() }).strict(),
    })
    .strict(),
  z.object({ id: z.number().int().nonnegative(), method: z.literal('snapshot') }).strict(),
  z.object({ id: z.number().int().nonnegative(), method: z.enum(['ping', 'shutdown']) }).strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('layout'),
      value: layoutSchema,
    })
    .strict(),
  z
    .object({ id: z.number().int().nonnegative(), method: z.literal('stream'), value: z.boolean() })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.enum(['approvals.list', 'diagnostics']),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('approvals.decide'),
      value: z.object({ approvalId: idSchema, allow: z.boolean() }).strict(),
    })
    .strict(),
  z.object({ id: z.number().int().nonnegative(), method: z.literal('dots.list') }).strict(),
  z.object({ id: z.number().int().nonnegative(), method: z.literal('projects.list') }).strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.list'),
      value: z.object({ limit: z.number().int().min(1).max(100).default(40) }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.start'),
      value: z
        .object({
          dotId: safeIdSchema,
          projectId: safeIdSchema,
          permissionMode: permissionModeSchema.default('ask'),
          elevatedConfirmed: z.boolean().default(false),
          operationId: idSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('terminal.attach'),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({ id: z.number().int().nonnegative(), method: z.literal('terminal.detachAll') })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('terminal.write'),
      value: z.object({ runId: idSchema, data: z.string().max(8192) }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('terminal.resize'),
      value: z
        .object({
          runId: idSchema,
          cols: z.number().int().min(20).max(300),
          rows: z.number().int().min(5).max(120),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.cancel'),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('worktree.remove'),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('runs.diff'),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('rollback.preview'),
      value: z.object({ runId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('rollback.apply'),
      value: z.object({ runId: idSchema, confirmed: z.literal(true) }).strict(),
    })
    .strict(),
]);
export const snapshotSchema = z
  .object({
    pid: z.number(),
    uptime: z.number(),
    heartbeat: z.number(),
    sequence: z.number(),
    streaming: z.boolean(),
    layout: layoutSchema,
    rss: z.number(),
    cpuMicros: z.number(),
    journal: z.literal('wal'),
    fts: z.literal(true),
  })
  .strict();
export type Layout = z.infer<typeof layoutSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Request = z.infer<typeof requestSchema>;
export type Command =
  | { method: 'checkpoints.list' | 'runs.pause' | 'recovery.inspect'; value: { runId: string } }
  | { method: 'checkpoints.create'; value: { runId: string; operationId: string } }
  | {
      method: 'runs.resume';
      value: { runId: string; operationId: string; newSessionConfirmed?: boolean };
    }
  | { method: 'runs.autoResume'; value: { runId: string; enabled: boolean } }
  | { method: 'snapshot' | 'ping' | 'shutdown' | 'approvals.list' | 'diagnostics' }
  | { method: 'approvals.decide'; value: { approvalId: string; allow: boolean } }
  | { method: 'layout'; value: Layout }
  | { method: 'stream'; value: boolean }
  | { method: 'dots.list' | 'projects.list' | 'terminal.detachAll' }
  | { method: 'runs.list'; value: { limit: number } }
  | {
      method: 'runs.start';
      value: {
        dotId: string;
        projectId: string;
        permissionMode?: PermissionMode;
        elevatedConfirmed?: boolean;
        operationId?: string;
      };
    }
  | {
      method:
        'terminal.attach' | 'runs.cancel' | 'runs.diff' | 'rollback.preview' | 'worktree.remove';
      value: { runId: string };
    }
  | { method: 'terminal.write'; value: { runId: string; data: string } }
  | { method: 'terminal.resize'; value: { runId: string; cols: number; rows: number } }
  | { method: 'rollback.apply'; value: { runId: string; confirmed: true } };

export const dotSchema = z
  .object({
    id: safeIdSchema,
    name: z.string().min(1).max(80),
    role: z.string().min(1).max(1600),
    executable: z.string().min(1).max(4096),
    args: z.array(z.string().max(2048)).max(32),
    projectIds: z.array(safeIdSchema).max(20),
    adapter: z.enum(['generic', 'codex']).default('generic'),
    autoResume: z.boolean().default(true),
  })
  .strict();
export const projectSchema = z
  .object({
    id: safeIdSchema,
    name: z.string().min(1).max(120),
    root: z.string().min(1).max(4096),
    gitRoot: z.string().min(1).max(4096),
  })
  .strict();

export const runSchema = z
  .object({
    autoResumeEnabled: z.boolean(),
    id: idSchema,
    dotId: safeIdSchema,
    projectId: safeIdSchema,
    state: runStateSchema,
    createdAt: z.number(),
    startedAt: z.number().nullable(),
    finishedAt: z.number().nullable(),
    exitCode: z.number().nullable(),
    error: z.string().nullable(),
    branch: z.string().nullable(),
    sessionId: idSchema.nullable(),
    pid: z.number().nullable(),
    permissionMode: permissionModeSchema,
  })
  .strict();
export const terminalEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('continuity.notice'),
      runId: idSchema,
      eventId: z.string().max(100),
      kind: z.enum(['quota.confirmed', 'auto_resume.scheduled', 'run.resumed', 'resume.failed']),
    })
    .strict(),
  z.object({ type: z.literal('approval.updated'), approval: approvalSchema }).strict(),
  z.object({ type: z.literal('run.updated'), run: runSchema }).strict(),
  z
    .object({ type: z.literal('terminal.output'), runId: idSchema, data: z.string().max(16384) })
    .strict(),
  z
    .object({
      type: z.literal('terminal.snapshot'),
      runId: idSchema,
      data: z.string().max(4096),
      final: z.boolean(),
    })
    .strict(),
]);
export const terminalSessionSchema = z
  .object({ run: runSchema, cols: z.number().int(), rows: z.number().int() })
  .strict();
export const fileChangeSchema = z
  .object({
    path: z.string().max(4096),
    kind: z.enum(['created', 'modified', 'deleted']),
    beforeHash: z.string().nullable(),
    afterHash: z.string().nullable(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  })
  .strict();
export const dotListSchema = z
  .array(
    z
      .object({
        id: safeIdSchema,
        name: z.string().min(1).max(80),
        role: z.string().max(1600),
        projectIds: z.array(safeIdSchema).max(20),
        capabilities: z.array(capabilitySchema).length(4),
      })
      .strict(),
  )
  .max(8);
export const projectListSchema = z
  .array(z.object({ id: safeIdSchema, name: z.string().min(1).max(120) }).strict())
  .max(100);
export const diffResultSchema = z
  .object({
    run: runSchema,
    files: z.array(fileChangeSchema).max(100),
    totalFiles: z.number().int().nonnegative(),
    diff: z.string().max(65536),
    diffTruncated: z.boolean(),
    filesTruncated: z.boolean(),
  })
  .strict();
export const rollbackResultSchema = z
  .object({
    run: runSchema,
    files: z.array(fileChangeSchema).max(100),
    totalFiles: z.number().int().nonnegative(),
    filesTruncated: z.boolean(),
    conflicts: z.array(z.string().max(4096)).max(100),
    conflictsTruncated: z.boolean(),
    approvalId: idSchema.optional(),
    applied: z.boolean(),
    canRollback: z.boolean(),
  })
  .strict();
export type Dot = z.infer<typeof dotSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Run = z.infer<typeof runSchema>;
export type TerminalEvent = z.infer<typeof terminalEventSchema>;

export const checkpointSchema = z
  .object({
    id: idSchema,
    createdAt: z.number(),
    origin: z.string().max(40),
    state: runStateSchema,
  })
  .strict();
export const recoverySchema = z
  .object({
    runId: idSchema,
    state: runStateSchema,
    reason: z.string().nullable(),
    lastCheckpoint: checkpointSchema.nullable(),
    worktreeAvailable: z.boolean(),
    worktreeChanged: z.boolean().nullable(),
    survivingProcess: z.boolean(),
    sessionRecoverable: z.boolean(),
    nativeResume: z.literal(false),
    uncertainOperations: z.array(z.string().max(40)).max(100),
    canStartNewSession: z.boolean(),
    autoResume: z.literal('unavailable'),
    risk: z.string().max(500),
  })
  .strict();

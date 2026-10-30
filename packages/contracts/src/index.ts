import { z } from 'zod';
declare const KARONT_APP_VERSION: string;
export const APP_VERSION = KARONT_APP_VERSION;
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
    '// Karont · Fase 0\n// Editor local de teste. Nenhum agente conectado.\n\nconst mensagem = "Olá, Karont";\n',
  editorOpen: false,
};
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

const operationIdSchema = idSchema;
const cursorSchema = z.string().min(1).max(256);
const pageLimitSchema = z.number().int().min(1).max(100).default(100);
const nameSchema = z.string().trim().min(1).max(120);
const messageBodySchema = z.string().superRefine((value, ctx) => {
  if (new TextEncoder().encode(value).byteLength > 8000)
    ctx.addIssue({ code: 'custom', message: 'Mensagem excede 8.000 bytes UTF-8' });
});
const pageRequestSchema = z
  .object({ cursor: cursorSchema.optional(), limit: pageLimitSchema })
  .strict();
const projectListRequestSchema = z
  .object({
    workspaceId: idSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: pageLimitSchema,
  })
  .strict();
const chatListRequestSchema = z
  .object({
    scope: z.enum(['all', 'favorites', 'recent', 'free']).default('all'),
    workspaceId: idSchema.optional(),
    projectId: safeIdSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: pageLimitSchema,
  })
  .strict();
const chatContextSchema = z
  .object({
    workspaceId: idSchema.nullable().optional(),
    projectId: safeIdSchema.nullable().optional(),
    dotId: safeIdSchema.nullable().optional(),
    title: nameSchema,
    operationId: operationIdSchema,
  })
  .strict();

export const workspaceSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const projectIconSchema = z.enum([
  'folder',
  'code-xml',
  'globe',
  'terminal',
  'layers',
  'briefcase',
  'book-open',
  'rocket',
]);
export const workspaceProjectSchema = z
  .object({
    id: safeIdSchema,
    name: nameSchema,
    workspaceId: idSchema,
    origin: z.enum(['config', 'ui']),
    icon: projectIconSchema.default('folder'),
    root: z.string().default(''),
    available: z.boolean(),
    dotIds: z.array(safeIdSchema).max(8),
  })
  .strict();
const chatOriginSchema = z
  .object({
    workspaceName: z.string().max(120).nullable(),
    projectName: z.string().max(120).nullable(),
  })
  .strict();
export const chatSummarySchema = z
  .object({
    id: idSchema,
    workspaceId: idSchema.nullable(),
    projectId: safeIdSchema.nullable(),
    dotId: safeIdSchema.nullable(),
    title: nameSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastOpenedAt: z.number().int().nonnegative(),
    favorite: z.boolean(),
    revision: z.number().int().positive(),
    origin: chatOriginSchema,
    runCount: z.number().int().nonnegative(),
  })
  .strict();
export const chatSchema = chatSummarySchema
  .omit({ origin: true, runCount: true })
  .extend({ draft: z.string().max(8000) })
  .strict();
export const chatDetailsSchema = z.object({ chat: chatSchema, origin: chatOriginSchema }).strict();
export const workspacePageSchema = z
  .object({ items: z.array(workspaceSchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();
export const projectPageSchema = z
  .object({ items: z.array(workspaceProjectSchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();
export const chatPageSchema = z
  .object({ items: z.array(chatSummarySchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();
export const messageSchema = z
  .object({
    id: idSchema,
    chatId: idSchema,
    sequence: z.number().int().positive(),
    role: z.literal('user'),
    body: messageBodySchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export const messageSaveResultSchema = z
  .object({ message: messageSchema, chat: chatDetailsSchema })
  .strict();
export const deliverySchema = z
  .object({
    chatId: idSchema,
    messageId: idSchema,
    runId: idSchema,
    operationId: idSchema,
    status: z.enum(['pending', 'sent', 'uncertain']),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const deliveryListSchema = z.array(deliverySchema).max(100);
export const messagePageSchema = z
  .object({
    items: z.array(messageSchema).max(100),
    deliveries: deliveryListSchema,
    nextCursor: cursorSchema.nullable(),
  })
  .strict();
export const navigationSchema = z
  .object({
    workspaceId: idSchema.nullable(),
    projectId: safeIdSchema.nullable(),
    chatId: idSchema.nullable(),
  })
  .strict();
export const movePreviewSchema = z
  .object({
    chatId: idSchema,
    title: nameSchema,
    revision: z.number().int().positive(),
    source: chatOriginSchema,
    destinationWorkspaceId: idSchema,
    destinationWorkspaceName: nameSchema,
    destinationProjectId: safeIdSchema,
    destinationProjectName: nameSchema,
    dotId: safeIdSchema.nullable(),
    dotName: z.string().max(80).nullable(),
    authorized: z.boolean(),
    hasNonterminalRun: z.boolean(),
    canMove: z.boolean(),
  })
  .strict();
export const addProjectResultSchema = z
  .object({ project: workspaceProjectSchema, duplicate: z.boolean() })
  .strict();

export const taskStateSchema = z.enum(['todo', 'in_progress', 'review', 'done']);
const taskAssigneeFieldsSchema = z
  .object({ kind: z.enum(['local', 'dot']), id: z.string().min(1).max(80) })
  .strict();
export const taskAssigneeInputSchema = taskAssigneeFieldsSchema.superRefine((value, ctx) => {
  if (value.kind === 'local' && value.id !== 'local-user')
    ctx.addIssue({ code: 'custom', message: 'Responsável local inválido' });
  if (value.kind === 'dot' && !/^[a-zA-Z0-9._-]+$/.test(value.id))
    ctx.addIssue({ code: 'custom', message: 'ID de Dot inválido' });
});
export const taskAssigneeSchema = z
  .object({
    kind: z.enum(['local', 'dot']),
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    available: z.boolean(),
  })
  .strict();
const taskDescriptionSchema = z.string().superRefine((value, ctx) => {
  if (new TextEncoder().encode(value).byteLength > 16000)
    ctx.addIssue({ code: 'custom', message: 'Descrição excede 16.000 bytes UTF-8' });
});
export const taskOriginSchema = z
  .object({
    workspaceId: idSchema,
    workspaceName: nameSchema,
    projectName: nameSchema,
    chatId: idSchema.nullable(),
    chatTitle: nameSchema.nullable(),
    messageId: idSchema.nullable(),
  })
  .strict();
export const taskRunSchema = z
  .object({
    id: idSchema,
    state: runStateSchema,
    dotId: safeIdSchema,
    dotName: z.string().max(80).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export const taskSummarySchema = z
  .object({
    id: idSchema,
    projectId: safeIdSchema,
    title: nameSchema,
    state: taskStateSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    assignees: z.array(taskAssigneeSchema).max(8),
    origin: taskOriginSchema,
    runCount: z.number().int().nonnegative(),
  })
  .strict();
export const taskDetailsSchema = taskSummarySchema
  .extend({ description: taskDescriptionSchema, runs: z.array(taskRunSchema).max(100) })
  .strict();
export const taskPageSchema = z
  .object({ items: z.array(taskSummarySchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();
export const taskEventSchema = z
  .object({
    id: z.number().int().positive(),
    taskId: idSchema,
    kind: z.enum([
      'task.created',
      'task.updated',
      'task.state_changed',
      'task.assignees_changed',
      'task.run_linked',
      'task.run_unlinked',
    ]),
    createdAt: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.string().max(1000)),
  })
  .strict();
export const taskEventPageSchema = z
  .object({ items: z.array(taskEventSchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();
const taskListRequestSchema = z
  .object({
    workspaceId: idSchema.optional(),
    projectId: safeIdSchema.optional(),
    state: taskStateSchema.optional(),
    assignee: taskAssigneeInputSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: pageLimitSchema,
  })
  .strict();
const taskCreateSchema = z
  .object({
    projectId: safeIdSchema,
    title: nameSchema,
    description: taskDescriptionSchema.default(''),
    state: taskStateSchema.default('todo'),
    assignees: z.array(taskAssigneeInputSchema).max(8).default([]),
    originChatId: idSchema.nullable().default(null),
    originMessageId: idSchema.nullable().default(null),
    operationId: operationIdSchema,
  })
  .strict();
const taskUpdateSchema = z
  .object({
    taskId: idSchema,
    title: nameSchema.optional(),
    description: taskDescriptionSchema.optional(),
    state: taskStateSchema.optional(),
    expectedRevision: z.number().int().positive(),
    operationId: operationIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined || value.description !== undefined || value.state !== undefined,
  );
const taskAssigneesSetSchema = z
  .object({
    taskId: idSchema,
    assignees: z.array(taskAssigneeInputSchema).max(8),
    expectedRevision: z.number().int().positive(),
    operationId: operationIdSchema,
  })
  .strict();
const taskRunLinkSchema = z
  .object({
    taskId: idSchema,
    runId: idSchema,
    expectedRevision: z.number().int().positive(),
    operationId: operationIdSchema,
  })
  .strict();
const taskEventsRequestSchema = z
  .object({ taskId: idSchema, cursor: cursorSchema.optional(), limit: pageLimitSchema })
  .strict();

export const runSchema = z
  .object({
    autoResumeEnabled: z.boolean(),
    id: idSchema,
    chatId: idSchema.nullable(),
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
export const chatRunPageSchema = z
  .object({ items: z.array(runSchema).max(100), nextCursor: cursorSchema.nullable() })
  .strict();

export const terminalEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.updated'), workspaceId: idSchema }).strict(),
  z
    .object({ type: z.literal('project.updated'), projectId: safeIdSchema, workspaceId: idSchema })
    .strict(),
  z
    .object({
      type: z.literal('chat.updated'),
      chatId: idSchema,
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('message.created'),
      chatId: idSchema,
      messageId: idSchema,
      revision: z.number().int().positive(),
      sequence: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('message.delivery.updated'),
      chatId: idSchema,
      messageId: idSchema,
      runId: idSchema,
      operationId: idSchema,
      status: z.enum(['pending', 'sent', 'uncertain']),
    })
    .strict(),
  z
    .object({
      type: z.literal('task.updated'),
      taskId: idSchema,
      revision: z.number().int().positive(),
    })
    .strict(),
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
        projectIds: z.array(safeIdSchema).max(100),
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

export const requestSchema = z.discriminatedUnion('method', [
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('workspaces.list'),
      value: pageRequestSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('workspaces.create'),
      value: z.object({ name: nameSchema, operationId: operationIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('workspaces.rename'),
      value: z
        .object({ workspaceId: idSchema, name: nameSchema, operationId: operationIdSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('projects.list'),
      value: projectListRequestSchema.optional(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('projects.update'),
      value: z
        .object({
          projectId: safeIdSchema,
          name: nameSchema,
          root: z.string().min(1).max(4096),
          icon: projectIconSchema,
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('projects.add'),
      value: z
        .object({
          workspaceId: idSchema,
          name: nameSchema,
          root: z.string().min(1).max(4096),
          icon: projectIconSchema.default('folder'),
          dotIds: z
            .array(safeIdSchema)
            .max(8)
            .refine((ids) => new Set(ids).size === ids.length),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.list'),
      value: chatListRequestSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.create'),
      value: chatContextSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.get'),
      value: z.object({ chatId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.rename'),
      value: z
        .object({
          chatId: idSchema,
          title: nameSchema,
          expectedRevision: z.number().int().positive(),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.open'),
      value: z.object({ chatId: idSchema, operationId: operationIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.favorite'),
      value: z
        .object({
          chatId: idSchema,
          favorite: z.boolean(),
          expectedRevision: z.number().int().positive(),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.draft'),
      value: z
        .object({
          chatId: idSchema,
          draft: messageBodySchema,
          expectedRevision: z.number().int().positive(),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.move.preview'),
      value: z
        .object({ chatId: idSchema, projectId: safeIdSchema, dotId: safeIdSchema.optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.move'),
      value: z
        .object({
          chatId: idSchema,
          projectId: safeIdSchema,
          dotId: safeIdSchema,
          expectedRevision: z.number().int().positive(),
          confirmed: z.literal(true),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('messages.list'),
      value: z
        .object({ chatId: idSchema, cursor: cursorSchema.optional(), limit: pageLimitSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('messages.save'),
      value: z
        .object({
          chatId: idSchema,
          body: messageBodySchema,
          expectedRevision: z.number().int().positive(),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('messages.send'),
      value: z
        .object({
          chatId: idSchema,
          messageId: idSchema,
          runId: idSchema,
          reviewedUncertain: z.boolean().default(false),
          operationId: operationIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('messages.deliveries'),
      value: z.object({ chatId: idSchema, messageId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('chats.runs.list'),
      value: z
        .object({ chatId: idSchema, cursor: cursorSchema.optional(), limit: pageLimitSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.list'),
      value: taskListRequestSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.get'),
      value: z.object({ taskId: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.create'),
      value: taskCreateSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.update'),
      value: taskUpdateSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.assignees.set'),
      value: taskAssigneesSetSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.enum(['tasks.runs.link', 'tasks.runs.unlink']),
      value: taskRunLinkSchema,
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('tasks.events.list'),
      value: taskEventsRequestSchema,
    })
    .strict(),
  z.object({ id: z.number().int().nonnegative(), method: z.literal('navigation.get') }).strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('navigation.set'),
      value: navigationSchema.extend({ operationId: operationIdSchema }).strict(),
    })
    .strict(),
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
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.enum([
        'snapshot',
        'ping',
        'shutdown',
        'approvals.list',
        'diagnostics',
        'dots.list',
        'terminal.detachAll',
      ]),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('approvals.decide'),
      value: z.object({ approvalId: idSchema, allow: z.boolean() }).strict(),
    })
    .strict(),
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
          chatId: idSchema.optional(),
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
    .object({
      id: z.number().int().nonnegative(),
      method: z.literal('terminal.write'),
      value: z
        .object({
          runId: idSchema,
          data: z.string().superRefine((value, ctx) => {
            if (new TextEncoder().encode(value).byteLength > 8192)
              ctx.addIssue({
                code: 'custom',
                message: 'Entrada de terminal excede o limite em bytes',
              });
          }),
        })
        .strict(),
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
export type Request = z.infer<typeof requestSchema>;
export type Command =
  | { method: 'workspaces.list'; value: { cursor?: string; limit?: number } }
  | { method: 'workspaces.create'; value: { name: string; operationId: string } }
  | {
      method: 'workspaces.rename';
      value: { workspaceId: string; name: string; operationId: string };
    }
  | { method: 'projects.list'; value?: { workspaceId?: string; cursor?: string; limit?: number } }
  | {
      method: 'projects.update';
      value: {
        projectId: string;
        name: string;
        root: string;
        icon: z.infer<typeof projectIconSchema>;
        operationId: string;
      };
    }
  | {
      method: 'projects.add';
      value: {
        workspaceId: string;
        name: string;
        root: string;
        icon?: z.infer<typeof projectIconSchema>;
        dotIds: string[];
        operationId: string;
      };
    }
  | {
      method: 'chats.list';
      value: {
        scope?: 'all' | 'favorites' | 'recent' | 'free';
        workspaceId?: string;
        projectId?: string;
        cursor?: string;
        limit?: number;
      };
    }
  | {
      method: 'chats.create';
      value: {
        workspaceId?: string | null;
        projectId?: string | null;
        dotId?: string | null;
        title: string;
        operationId: string;
      };
    }
  | { method: 'chats.get'; value: { chatId: string } }
  | {
      method: 'chats.rename';
      value: { chatId: string; title: string; expectedRevision: number; operationId: string };
    }
  | { method: 'chats.open'; value: { chatId: string; operationId: string } }
  | {
      method: 'chats.favorite';
      value: { chatId: string; favorite: boolean; expectedRevision: number; operationId: string };
    }
  | {
      method: 'chats.draft';
      value: { chatId: string; draft: string; expectedRevision: number; operationId: string };
    }
  | { method: 'chats.move.preview'; value: { chatId: string; projectId: string; dotId?: string } }
  | {
      method: 'chats.move';
      value: {
        chatId: string;
        projectId: string;
        dotId: string;
        expectedRevision: number;
        confirmed: true;
        operationId: string;
      };
    }
  | { method: 'messages.list'; value: { chatId: string; cursor?: string; limit?: number } }
  | {
      method: 'messages.save';
      value: { chatId: string; body: string; expectedRevision: number; operationId: string };
    }
  | {
      method: 'messages.send';
      value: {
        chatId: string;
        messageId: string;
        runId: string;
        reviewedUncertain?: boolean;
        operationId: string;
      };
    }
  | { method: 'messages.deliveries'; value: { chatId: string; messageId: string } }
  | { method: 'chats.runs.list'; value: { chatId: string; cursor?: string; limit?: number } }
  | {
      method: 'tasks.list';
      value: {
        workspaceId?: string;
        projectId?: string;
        state?: z.infer<typeof taskStateSchema>;
        assignee?: z.infer<typeof taskAssigneeInputSchema>;
        cursor?: string;
        limit?: number;
      };
    }
  | { method: 'tasks.get'; value: { taskId: string } }
  | {
      method: 'tasks.create';
      value: {
        projectId: string;
        title: string;
        description?: string;
        state?: z.infer<typeof taskStateSchema>;
        assignees?: z.infer<typeof taskAssigneeInputSchema>[];
        originChatId?: string | null;
        originMessageId?: string | null;
        operationId: string;
      };
    }
  | {
      method: 'tasks.update';
      value: {
        taskId: string;
        title?: string;
        description?: string;
        state?: z.infer<typeof taskStateSchema>;
        expectedRevision: number;
        operationId: string;
      };
    }
  | {
      method: 'tasks.assignees.set';
      value: {
        taskId: string;
        assignees: z.infer<typeof taskAssigneeInputSchema>[];
        expectedRevision: number;
        operationId: string;
      };
    }
  | {
      method: 'tasks.runs.link' | 'tasks.runs.unlink';
      value: { taskId: string; runId: string; expectedRevision: number; operationId: string };
    }
  | { method: 'tasks.events.list'; value: { taskId: string; cursor?: string; limit?: number } }
  | { method: 'navigation.get' }
  | {
      method: 'navigation.set';
      value: {
        workspaceId: string | null;
        projectId: string | null;
        chatId: string | null;
        operationId: string;
      };
    }
  | { method: 'checkpoints.list' | 'runs.pause' | 'recovery.inspect'; value: { runId: string } }
  | { method: 'checkpoints.create'; value: { runId: string; operationId: string } }
  | {
      method: 'runs.resume';
      value: { runId: string; operationId: string; newSessionConfirmed?: boolean };
    }
  | { method: 'runs.autoResume'; value: { runId: string; enabled: boolean } }
  | {
      method:
        | 'snapshot'
        | 'ping'
        | 'shutdown'
        | 'approvals.list'
        | 'diagnostics'
        | 'dots.list'
        | 'terminal.detachAll';
    }
  | { method: 'approvals.decide'; value: { approvalId: string; allow: boolean } }
  | { method: 'layout'; value: Layout }
  | { method: 'stream'; value: boolean }
  | { method: 'runs.list'; value: { limit: number } }
  | {
      method: 'runs.start';
      value: {
        dotId: string;
        projectId: string;
        chatId?: string;
        permissionMode?: PermissionMode;
        elevatedConfirmed?: boolean;
        operationId?: string;
      };
    }
  | {
      method:
        | 'terminal.attach'
        | 'runs.cancel'
        | 'runs.diff'
        | 'rollback.preview'
        | 'worktree.remove';
      value: { runId: string };
    }
  | { method: 'terminal.write'; value: { runId: string; data: string } }
  | { method: 'terminal.resize'; value: { runId: string; cols: number; rows: number } }
  | { method: 'rollback.apply'; value: { runId: string; confirmed: true } };

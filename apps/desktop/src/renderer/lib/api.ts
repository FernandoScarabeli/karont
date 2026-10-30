import type {
  Layout,
  Snapshot,
  TerminalEvent,
  PermissionMode,
  Approval,
  DiagnosticItem,
  capabilitySchema,
  workspaceSchema,
  workspaceProjectSchema,
  chatSummarySchema,
  chatDetailsSchema,
  messageSchema,
  messagePageSchema,
  deliverySchema,
  movePreviewSchema,
  navigationSchema,
  messageSaveResultSchema,
  taskAssigneeInputSchema,
  taskDetailsSchema,
  taskEventSchema,
  taskStateSchema,
  taskSummarySchema,
} from '../../../../../packages/contracts/src';
export type UiDot = {
  id: string;
  name: string;
  role: string;
  projectIds: string[];
  capabilities: import('zod').infer<typeof capabilitySchema>[];
};
export type UiProject = { id: string; name: string };
export type UiWorkspace = import('zod').infer<typeof workspaceSchema>;
export type UiWorkspaceProject = import('zod').infer<typeof workspaceProjectSchema>;
export type UiChatSummary = import('zod').infer<typeof chatSummarySchema>;
export type UiChatDetails = import('zod').infer<typeof chatDetailsSchema>;
export type UiMessage = import('zod').infer<typeof messageSchema>;
export type UiMessagePage = import('zod').infer<typeof messagePageSchema>;
export type UiDelivery = import('zod').infer<typeof deliverySchema>;
export type UiMovePreview = import('zod').infer<typeof movePreviewSchema>;
export type UiNavigation = import('zod').infer<typeof navigationSchema>;
export type UiMessageSave = import('zod').infer<typeof messageSaveResultSchema>;
export type UiTask = import('zod').infer<typeof taskDetailsSchema>;
export type UiTaskSummary = import('zod').infer<typeof taskSummarySchema>;
export type UiTaskAssignee = import('zod').infer<typeof taskAssigneeInputSchema>;
export type UiTaskEvent = import('zod').infer<typeof taskEventSchema>;
export type UiTaskState = import('zod').infer<typeof taskStateSchema>;
export type UiPage<T> = { items: T[]; nextCursor: string | null };
export type UiRun = {
  autoResumeEnabled: boolean;
  permissionMode: PermissionMode;
  id: string;
  chatId: string | null;
  dotId: string;
  projectId: string;
  state: import('zod').infer<typeof import('../../../../../packages/contracts/src').runStateSchema>;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  error: string | null;
  branch: string | null;
  sessionId: string | null;
  pid: number | null;
};
export type UiFileChange = {
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  beforeHash: string | null;
  afterHash: string | null;
  additions: number;
  deletions: number;
};
export type UiDiff = {
  run: UiRun;
  files: UiFileChange[];
  totalFiles: number;
  diff: string;
  diffTruncated: boolean;
  filesTruncated: boolean;
};
export type UiRollback = {
  approvalId?: string;
  run: UiRun;
  files: UiFileChange[];
  totalFiles: number;
  filesTruncated: boolean;
  conflicts: string[];
  conflictsTruncated: boolean;
  canRollback: boolean;
  applied: boolean;
};
export type UiSession = { run: UiRun; cols: number; rows: number };
export type KarontBridge = {
  readonly runtime: { readonly sandboxed: boolean; readonly contextIsolated: boolean };
  snapshot(): Promise<Snapshot>;
  layout(value: Layout): Promise<Snapshot>;
  stream(value: boolean): Promise<Snapshot>;
  close(): Promise<void>;
  approvals(): Promise<Approval[]>;
  decideApproval(approvalId: string, allow: boolean): Promise<Approval>;
  diagnostics(): Promise<DiagnosticItem[]>;
  report(): Promise<string>;
  saveReport(): Promise<boolean>;
  copyReport(): Promise<boolean>;
  notifications(
    enabled?: boolean,
  ): Promise<{ enabled: boolean; history: { event: string; status: string; at: number }[] }>;
  focusTarget(): Promise<string | undefined>;
  onFocusRun(listener: (id: string) => void): () => void;
  workspaces(cursor?: string, limit?: number): Promise<UiPage<UiWorkspace>>;
  createWorkspace(name: string): Promise<UiWorkspace>;
  renameWorkspace(workspaceId: string, name: string): Promise<UiWorkspace>;
  dots(): Promise<UiDot[]>;
  projects: {
    (): Promise<UiProject[]>;
    (workspaceId: string, cursor?: string, limit?: number): Promise<UiPage<UiWorkspaceProject>>;
  };
  projectIndex(cursor?: string, limit?: number): Promise<UiPage<UiWorkspaceProject>>;
  updateProject(input: {
    projectId: string;
    name: string;
    root: string;
    icon: UiWorkspaceProject['icon'];
  }): Promise<UiWorkspaceProject>;
  chooseProjectFolder(): Promise<string | null>;
  addProject(input: {
    workspaceId: string;
    name: string;
    root: string;
    icon: UiWorkspaceProject['icon'];
    dotIds: string[];
  }): Promise<{ cancelled: true } | { project: UiWorkspaceProject; duplicate: boolean }>;
  chats(input: {
    scope?: 'all' | 'favorites' | 'recent' | 'free';
    workspaceId?: string;
    projectId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<UiPage<UiChatSummary>>;
  createChat(input: {
    workspaceId?: string | null;
    projectId?: string | null;
    dotId?: string | null;
    title: string;
  }): Promise<UiChatDetails>;
  chat(chatId: string): Promise<UiChatDetails>;
  renameChat(chatId: string, title: string, expectedRevision: number): Promise<UiChatDetails>;
  openChat(chatId: string): Promise<UiChatDetails>;
  favoriteChat(chatId: string, favorite: boolean, expectedRevision: number): Promise<UiChatDetails>;
  saveDraft(chatId: string, draft: string, expectedRevision: number): Promise<UiChatDetails>;
  previewMoveChat(chatId: string, projectId: string, dotId?: string): Promise<UiMovePreview>;
  moveChat(
    chatId: string,
    projectId: string,
    dotId: string,
    expectedRevision: number,
  ): Promise<UiChatDetails>;
  messages(chatId: string, cursor?: string, limit?: number): Promise<UiMessagePage>;
  saveMessage(chatId: string, body: string, expectedRevision: number): Promise<UiMessageSave>;
  sendMessage(input: {
    chatId: string;
    messageId: string;
    runId: string;
    reviewedUncertain?: boolean;
  }): Promise<UiDelivery>;
  messageDeliveries(chatId: string, messageId: string): Promise<UiDelivery[]>;
  chatRuns(chatId: string, cursor?: string, limit?: number): Promise<UiPage<UiRun>>;
  tasks(input: {
    workspaceId?: string;
    projectId?: string;
    state?: UiTaskState;
    assignee?: UiTaskAssignee;
    cursor?: string;
    limit?: number;
  }): Promise<UiPage<UiTaskSummary>>;
  task(taskId: string): Promise<UiTask>;
  createTask(
    input: {
      projectId: string;
      title: string;
      description?: string;
      state?: UiTaskState;
      assignees?: UiTaskAssignee[];
      originChatId?: string | null;
      originMessageId?: string | null;
    },
    operationId?: string,
  ): Promise<UiTask>;
  updateTask(input: {
    taskId: string;
    title?: string;
    description?: string;
    state?: UiTaskState;
    expectedRevision: number;
  }): Promise<UiTask>;
  setTaskAssignees(input: {
    taskId: string;
    assignees: UiTaskAssignee[];
    expectedRevision: number;
  }): Promise<UiTask>;
  linkTaskRun(input: { taskId: string; runId: string; expectedRevision: number }): Promise<UiTask>;
  unlinkTaskRun(input: {
    taskId: string;
    runId: string;
    expectedRevision: number;
  }): Promise<UiTask>;
  taskEvents(taskId: string, cursor?: string, limit?: number): Promise<UiPage<UiTaskEvent>>;
  navigation(): Promise<UiNavigation>;
  setNavigation(input: UiNavigation): Promise<UiNavigation>;
  runs(limit?: number): Promise<UiRun[]>;
  startRun(
    dotId: string,
    projectId: string,
    permissionMode?: PermissionMode,
    elevatedConfirmed?: boolean,
    chatId?: string,
  ): Promise<UiRun>;
  attachTerminal(runId: string): Promise<UiSession>;
  detachTerminals(): Promise<{ ok: boolean }>;
  writeTerminal(runId: string, data: string): Promise<{ ok: boolean }>;
  resizeTerminal(runId: string, cols: number, rows: number): Promise<{ ok: boolean }>;
  checkpoints(runId: string): Promise<Checkpoint[]>;
  checkpoint(runId: string, operationId: string): Promise<Checkpoint[]>;
  recovery(runId: string): Promise<Recovery>;
  pauseRun(runId: string): Promise<UiRun>;
  resumeRun(runId: string, operationId: string, newSessionConfirmed?: boolean): Promise<UiRun>;
  autoResume(runId: string, enabled: boolean): Promise<{ enabled: boolean; supported: false }>;
  cancelRun(runId: string): Promise<UiRun>;
  diff(runId: string): Promise<UiDiff>;
  rollbackPreview(runId: string): Promise<UiRollback>;
  rollbackApply(runId: string): Promise<UiRollback>;
  removeWorktree(runId: string): Promise<{ ok: boolean }>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
};
declare global {
  interface Window {
    karont: KarontBridge;
  }
}

export type Checkpoint = import('zod').infer<
  typeof import('../../../../../packages/contracts/src').checkpointSchema
>;
export type Recovery = import('zod').infer<
  typeof import('../../../../../packages/contracts/src').recoverySchema
>;

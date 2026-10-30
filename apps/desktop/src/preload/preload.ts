import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalEvent } from '../../../../packages/contracts/src';
import type { KarontBridge } from '../shared/bridge';

contextBridge.exposeInMainWorld('karont', {
  runtime: {
    sandboxed: process.sandboxed === true,
    contextIsolated: process.contextIsolated === true,
  },
  snapshot: () => ipcRenderer.invoke('karont:command', { method: 'snapshot' }),
  layout: (value: unknown) => ipcRenderer.invoke('karont:command', { method: 'layout', value }),
  stream: (value: boolean) => ipcRenderer.invoke('karont:command', { method: 'stream', value }),
  close: () => ipcRenderer.invoke('karont:command', { method: 'close' }),
  approvals: () => ipcRenderer.invoke('karont:approvals:list'),
  decideApproval: (approvalId: string, allow: boolean) =>
    ipcRenderer.invoke('karont:approvals:decide', { approvalId, allow }),
  diagnostics: () => ipcRenderer.invoke('karont:diagnostics'),
  report: () => ipcRenderer.invoke('karont:report'),
  saveReport: () => ipcRenderer.invoke('karont:report:save'),
  copyReport: () => ipcRenderer.invoke('karont:report:copy'),
  notifications: (enabled?: boolean) => ipcRenderer.invoke('karont:notifications', enabled),
  focusTarget: () => ipcRenderer.invoke('karont:focus-target'),
  onFocusRun: (listener: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('karont:focus-run', handler);
    return () => ipcRenderer.removeListener('karont:focus-run', handler);
  },
  workspaces: (cursor?: string, limit = 100) =>
    ipcRenderer.invoke('karont:workspaces:list', { cursor, limit }),
  createWorkspace: (name: string) =>
    ipcRenderer.invoke('karont:workspaces:create', { name, operationId: crypto.randomUUID() }),
  renameWorkspace: (workspaceId: string, name: string) =>
    ipcRenderer.invoke('karont:workspaces:rename', {
      workspaceId,
      name,
      operationId: crypto.randomUUID(),
    }),
  dots: () => ipcRenderer.invoke('karont:dots:list'),
  projects: (workspaceId?: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke(
      'karont:projects:list',
      workspaceId ? { workspaceId, cursor, limit } : undefined,
    ),
  projectIndex: (cursor?: string, limit = 100) =>
    ipcRenderer.invoke('karont:projects:list', { cursor, limit }),
  updateProject: (input: { projectId: string; name: string; root: string; icon: string }) =>
    ipcRenderer.invoke('karont:projects:update', { ...input, operationId: crypto.randomUUID() }),
  chooseProjectFolder: () => ipcRenderer.invoke('karont:projects:choose-folder'),
  addProject: (input: {
    workspaceId: string;
    name: string;
    root: string;
    icon: string;
    dotIds: string[];
  }) => ipcRenderer.invoke('karont:projects:add', input),
  chats: (input: {
    scope?: 'all' | 'favorites' | 'recent' | 'free';
    workspaceId?: string;
    projectId?: string;
    cursor?: string;
    limit?: number;
  }) => ipcRenderer.invoke('karont:chats:list', { ...input, limit: input.limit ?? 100 }),
  createChat: (input: {
    workspaceId?: string | null;
    projectId?: string | null;
    dotId?: string | null;
    title: string;
  }) => ipcRenderer.invoke('karont:chats:create', { ...input, operationId: crypto.randomUUID() }),
  chat: (chatId: string) => ipcRenderer.invoke('karont:chats:get', { chatId }),
  renameChat: (chatId: string, title: string, expectedRevision: number) =>
    ipcRenderer.invoke('karont:chats:rename', {
      chatId,
      title,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  openChat: (chatId: string) =>
    ipcRenderer.invoke('karont:chats:open', { chatId, operationId: crypto.randomUUID() }),
  favoriteChat: (chatId: string, favorite: boolean, expectedRevision: number) =>
    ipcRenderer.invoke('karont:chats:favorite', {
      chatId,
      favorite,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  saveDraft: (chatId: string, draft: string, expectedRevision: number) =>
    ipcRenderer.invoke('karont:chats:draft', {
      chatId,
      draft,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  previewMoveChat: (chatId: string, projectId: string, dotId?: string) =>
    ipcRenderer.invoke('karont:chats:move-preview', {
      chatId,
      projectId,
      ...(dotId ? { dotId } : {}),
    }),
  moveChat: (chatId: string, projectId: string, dotId: string, expectedRevision: number) =>
    ipcRenderer.invoke('karont:chats:move', {
      chatId,
      projectId,
      dotId,
      expectedRevision,
      confirmed: true,
      operationId: crypto.randomUUID(),
    }),
  messages: (chatId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('karont:messages:list', { chatId, cursor, limit }),
  saveMessage: (chatId: string, body: string, expectedRevision: number) =>
    ipcRenderer.invoke('karont:messages:save', {
      chatId,
      body,
      expectedRevision,
      operationId: crypto.randomUUID(),
    }),
  sendMessage: (input: {
    chatId: string;
    messageId: string;
    runId: string;
    reviewedUncertain?: boolean;
  }) => ipcRenderer.invoke('karont:messages:send', { ...input, operationId: crypto.randomUUID() }),
  messageDeliveries: (chatId: string, messageId: string) =>
    ipcRenderer.invoke('karont:messages:deliveries', { chatId, messageId }),
  chatRuns: (chatId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('karont:chats:runs', { chatId, cursor, limit }),
  tasks: (input: {
    workspaceId?: string;
    projectId?: string;
    state?: string;
    assignee?: { kind: 'local' | 'dot'; id: string };
    cursor?: string;
    limit?: number;
  }) => ipcRenderer.invoke('karont:tasks:list', { ...input, limit: input.limit ?? 100 }),
  task: (taskId: string) => ipcRenderer.invoke('karont:tasks:get', { taskId }),
  createTask: (
    input: {
      projectId: string;
      title: string;
      description?: string;
      state?: string;
      assignees?: { kind: 'local' | 'dot'; id: string }[];
      originChatId?: string | null;
      originMessageId?: string | null;
    },
    operationId = crypto.randomUUID(),
  ) => ipcRenderer.invoke('karont:tasks:create', { ...input, operationId }),
  updateTask: (input: {
    taskId: string;
    title?: string;
    description?: string;
    state?: string;
    expectedRevision: number;
  }) => ipcRenderer.invoke('karont:tasks:update', { ...input, operationId: crypto.randomUUID() }),
  setTaskAssignees: (input: {
    taskId: string;
    assignees: { kind: 'local' | 'dot'; id: string }[];
    expectedRevision: number;
  }) =>
    ipcRenderer.invoke('karont:tasks:assignees:set', {
      ...input,
      operationId: crypto.randomUUID(),
    }),
  linkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
    ipcRenderer.invoke('karont:tasks:runs:link', { ...input, operationId: crypto.randomUUID() }),
  unlinkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
    ipcRenderer.invoke('karont:tasks:runs:unlink', { ...input, operationId: crypto.randomUUID() }),
  taskEvents: (taskId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('karont:tasks:events:list', { taskId, cursor, limit }),
  navigation: () => ipcRenderer.invoke('karont:navigation:get'),
  setNavigation: (input: {
    workspaceId: string | null;
    projectId: string | null;
    chatId: string | null;
  }) => ipcRenderer.invoke('karont:navigation:set', { ...input, operationId: crypto.randomUUID() }),
  runs: (limit = 40) => ipcRenderer.invoke('karont:runs:list', { limit }),
  startRun: (
    dotId: string,
    projectId: string,
    permissionMode = 'ask',
    elevatedConfirmed = false,
    chatId?: string,
  ) =>
    ipcRenderer.invoke('karont:runs:start', {
      dotId,
      projectId,
      permissionMode,
      elevatedConfirmed,
      ...(chatId ? { chatId } : {}),
      operationId: crypto.randomUUID(),
    }),
  attachTerminal: (runId: string) => ipcRenderer.invoke('karont:terminal:attach', { runId }),
  detachTerminals: () => ipcRenderer.invoke('karont:terminal:detach-all'),
  writeTerminal: (runId: string, data: string) =>
    ipcRenderer.invoke('karont:terminal:write', { runId, data }),
  resizeTerminal: (runId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('karont:terminal:resize', { runId, cols, rows }),
  checkpoints: (runId: string) => ipcRenderer.invoke('karont:checkpoints:list', { runId }),
  checkpoint: (runId: string, operationId: string) =>
    ipcRenderer.invoke('karont:checkpoints:create', { runId, operationId }),
  recovery: (runId: string) => ipcRenderer.invoke('karont:recovery:inspect', { runId }),
  pauseRun: (runId: string) => ipcRenderer.invoke('karont:runs:pause', { runId }),
  resumeRun: (runId: string, operationId: string, newSessionConfirmed = false) =>
    ipcRenderer.invoke('karont:runs:resume', { runId, operationId, newSessionConfirmed }),
  autoResume: (runId: string, enabled: boolean) =>
    ipcRenderer.invoke('karont:runs:autoResume', { runId, enabled }),
  cancelRun: (runId: string) => ipcRenderer.invoke('karont:runs:cancel', { runId }),
  removeWorktree: (runId: string) => ipcRenderer.invoke('karont:worktree:remove', { runId }),
  diff: (runId: string) => ipcRenderer.invoke('karont:runs:diff', { runId }),
  rollbackPreview: (runId: string) => ipcRenderer.invoke('karont:rollback:preview', { runId }),
  rollbackApply: (runId: string) =>
    ipcRenderer.invoke('karont:rollback:apply', { runId, confirmed: true }),
  onEvent: (listener: (event: TerminalEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalEvent) => listener(value);
    ipcRenderer.on('karont:event', handler);
    return () => ipcRenderer.removeListener('karont:event', handler);
  },
} satisfies KarontBridge);

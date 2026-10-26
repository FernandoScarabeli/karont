import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('eros', {
  runtime: {
    sandboxed: process.sandboxed === true,
    contextIsolated: process.contextIsolated === true,
  },
  snapshot: () => ipcRenderer.invoke('eros:command', { method: 'snapshot' }),
  layout: (value: unknown) => ipcRenderer.invoke('eros:command', { method: 'layout', value }),
  stream: (value: boolean) => ipcRenderer.invoke('eros:command', { method: 'stream', value }),
  close: () => ipcRenderer.invoke('eros:command', { method: 'close' }),
  approvals: () => ipcRenderer.invoke('eros:approvals:list'),
  decideApproval: (approvalId: string, allow: boolean) =>
    ipcRenderer.invoke('eros:approvals:decide', { approvalId, allow }),
  diagnostics: () => ipcRenderer.invoke('eros:diagnostics'),
  report: () => ipcRenderer.invoke('eros:report'),
  saveReport: () => ipcRenderer.invoke('eros:report:save'),
  copyReport: () => ipcRenderer.invoke('eros:report:copy'),
  notifications: (enabled?: boolean) => ipcRenderer.invoke('eros:notifications', enabled),
  focusTarget: () => ipcRenderer.invoke('eros:focus-target'),
  onFocusRun: (listener: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on('eros:focus-run', handler);
    return () => ipcRenderer.removeListener('eros:focus-run', handler);
  },
  workspaces: (cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:workspaces:list', { cursor, limit }),
  createWorkspace: (name: string) =>
    ipcRenderer.invoke('eros:workspaces:create', { name, operationId: crypto.randomUUID() }),
  renameWorkspace: (workspaceId: string, name: string) =>
    ipcRenderer.invoke('eros:workspaces:rename', { workspaceId, name, operationId: crypto.randomUUID() }),
  dots: () => ipcRenderer.invoke('eros:dots:list'),
  projects: (workspaceId?: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:projects:list', workspaceId ? { workspaceId, cursor, limit } : undefined),
  projectIndex: (cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:projects:list', { cursor, limit }),
  updateProject: (input: { projectId: string; name: string; root: string; icon: string }) => ipcRenderer.invoke('eros:projects:update', { ...input, operationId: crypto.randomUUID() }),
  chooseProjectFolder: () => ipcRenderer.invoke('eros:projects:choose-folder'),
  addProject: (input: { workspaceId: string; name: string; root: string; icon: string; dotIds: string[] }) =>
    ipcRenderer.invoke('eros:projects:add', input),
  chats: (input: { scope?: 'all' | 'favorites' | 'recent' | 'free'; workspaceId?: string; projectId?: string; cursor?: string; limit?: number }) =>
    ipcRenderer.invoke('eros:chats:list', { ...input, limit: input.limit ?? 100 }),
  createChat: (input: { workspaceId?: string | null; projectId?: string | null; dotId?: string | null; title: string }) =>
    ipcRenderer.invoke('eros:chats:create', { ...input, operationId: crypto.randomUUID() }),
  chat: (chatId: string) => ipcRenderer.invoke('eros:chats:get', { chatId }),
  renameChat: (chatId: string, title: string, expectedRevision: number) =>
    ipcRenderer.invoke('eros:chats:rename', { chatId, title, expectedRevision, operationId: crypto.randomUUID() }),
  openChat: (chatId: string) =>
    ipcRenderer.invoke('eros:chats:open', { chatId, operationId: crypto.randomUUID() }),
  favoriteChat: (chatId: string, favorite: boolean, expectedRevision: number) =>
    ipcRenderer.invoke('eros:chats:favorite', { chatId, favorite, expectedRevision, operationId: crypto.randomUUID() }),
  saveDraft: (chatId: string, draft: string, expectedRevision: number) =>
    ipcRenderer.invoke('eros:chats:draft', { chatId, draft, expectedRevision, operationId: crypto.randomUUID() }),
  previewMoveChat: (chatId: string, projectId: string, dotId?: string) =>
    ipcRenderer.invoke('eros:chats:move-preview', { chatId, projectId, ...(dotId ? { dotId } : {}) }),
  moveChat: (chatId: string, projectId: string, dotId: string, expectedRevision: number) =>
    ipcRenderer.invoke('eros:chats:move', { chatId, projectId, dotId, expectedRevision, confirmed: true, operationId: crypto.randomUUID() }),
  messages: (chatId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:messages:list', { chatId, cursor, limit }),
  saveMessage: (chatId: string, body: string, expectedRevision: number) =>
    ipcRenderer.invoke('eros:messages:save', { chatId, body, expectedRevision, operationId: crypto.randomUUID() }),
  sendMessage: (input: { chatId: string; messageId: string; runId: string; reviewedUncertain?: boolean }) =>
    ipcRenderer.invoke('eros:messages:send', { ...input, operationId: crypto.randomUUID() }),
  messageDeliveries: (chatId: string, messageId: string) =>
    ipcRenderer.invoke('eros:messages:deliveries', { chatId, messageId }),
  chatRuns: (chatId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:chats:runs', { chatId, cursor, limit }),
  tasks: (input: { workspaceId?: string; projectId?: string; state?: string; assignee?: { kind: 'local' | 'dot'; id: string }; cursor?: string; limit?: number }) =>
    ipcRenderer.invoke('eros:tasks:list', { ...input, limit: input.limit ?? 100 }),
  task: (taskId: string) => ipcRenderer.invoke('eros:tasks:get', { taskId }),
  createTask: (input: { projectId: string; title: string; description?: string; state?: string; assignees?: { kind: 'local' | 'dot'; id: string }[]; originChatId?: string | null; originMessageId?: string | null }, operationId = crypto.randomUUID()) =>
    ipcRenderer.invoke('eros:tasks:create', { ...input, operationId }),
  updateTask: (input: { taskId: string; title?: string; description?: string; state?: string; expectedRevision: number }) =>
    ipcRenderer.invoke('eros:tasks:update', { ...input, operationId: crypto.randomUUID() }),
  setTaskAssignees: (input: { taskId: string; assignees: { kind: 'local' | 'dot'; id: string }[]; expectedRevision: number }) =>
    ipcRenderer.invoke('eros:tasks:assignees:set', { ...input, operationId: crypto.randomUUID() }),
  linkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
    ipcRenderer.invoke('eros:tasks:runs:link', { ...input, operationId: crypto.randomUUID() }),
  unlinkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
    ipcRenderer.invoke('eros:tasks:runs:unlink', { ...input, operationId: crypto.randomUUID() }),
  taskEvents: (taskId: string, cursor?: string, limit = 100) =>
    ipcRenderer.invoke('eros:tasks:events:list', { taskId, cursor, limit }),
  navigation: () => ipcRenderer.invoke('eros:navigation:get'),
  setNavigation: (input: { workspaceId: string | null; projectId: string | null; chatId: string | null }) =>
    ipcRenderer.invoke('eros:navigation:set', { ...input, operationId: crypto.randomUUID() }),
  runs: (limit = 40) => ipcRenderer.invoke('eros:runs:list', { limit }),
  startRun: (dotId: string, projectId: string, permissionMode = 'ask', elevatedConfirmed = false, chatId?: string) =>
    ipcRenderer.invoke('eros:runs:start', {
      dotId,
      projectId,
      permissionMode,
      elevatedConfirmed,
      ...(chatId ? { chatId } : {}),
      operationId: crypto.randomUUID(),
    }),
  attachTerminal: (runId: string) => ipcRenderer.invoke('eros:terminal:attach', { runId }),
  detachTerminals: () => ipcRenderer.invoke('eros:terminal:detach-all'),
  writeTerminal: (runId: string, data: string) =>
    ipcRenderer.invoke('eros:terminal:write', { runId, data }),
  resizeTerminal: (runId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('eros:terminal:resize', { runId, cols, rows }),
  checkpoints: (runId: string) => ipcRenderer.invoke('eros:checkpoints:list', { runId }),
  checkpoint: (runId: string, operationId: string) =>
    ipcRenderer.invoke('eros:checkpoints:create', { runId, operationId }),
  recovery: (runId: string) => ipcRenderer.invoke('eros:recovery:inspect', { runId }),
  pauseRun: (runId: string) => ipcRenderer.invoke('eros:runs:pause', { runId }),
  resumeRun: (runId: string, operationId: string, newSessionConfirmed = false) =>
    ipcRenderer.invoke('eros:runs:resume', { runId, operationId, newSessionConfirmed }),
  autoResume: (runId: string, enabled: boolean) =>
    ipcRenderer.invoke('eros:runs:autoResume', { runId, enabled }),
  cancelRun: (runId: string) => ipcRenderer.invoke('eros:runs:cancel', { runId }),
  removeWorktree: (runId: string) => ipcRenderer.invoke('eros:worktree:remove', { runId }),
  diff: (runId: string) => ipcRenderer.invoke('eros:runs:diff', { runId }),
  rollbackPreview: (runId: string) => ipcRenderer.invoke('eros:rollback:preview', { runId }),
  rollbackApply: (runId: string) =>
    ipcRenderer.invoke('eros:rollback:apply', { runId, confirmed: true }),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on('eros:event', handler);
    return () => ipcRenderer.removeListener('eros:event', handler);
  },
});

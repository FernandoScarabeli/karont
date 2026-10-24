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
  dots: () => ipcRenderer.invoke('eros:dots:list'),
  projects: () => ipcRenderer.invoke('eros:projects:list'),
  runs: (limit = 40) => ipcRenderer.invoke('eros:runs:list', { limit }),
  startRun: (dotId: string, projectId: string, permissionMode = 'ask', elevatedConfirmed = false) =>
    ipcRenderer.invoke('eros:runs:start', {
      dotId,
      projectId,
      permissionMode,
      elevatedConfirmed,
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

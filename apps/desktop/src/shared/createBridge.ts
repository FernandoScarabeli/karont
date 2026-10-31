import type { TerminalEvent } from '../../../../packages/contracts/src';
import type { KarontBridge } from './bridge';

export type BridgeTransport = {
  runtime: KarontBridge['runtime'];
  invoke(channel: string, value?: unknown): Promise<any>;
  on(channel: string, listener: (value: any) => void): () => void;
};

export function createKarontBridge(t: BridgeTransport): KarontBridge {
  return {
    runtime: t.runtime,
    snapshot: () => t.invoke('karont:command', { method: 'snapshot' }),
    layout: (value: unknown) => t.invoke('karont:command', { method: 'layout', value }),
    stream: (value: boolean) => t.invoke('karont:command', { method: 'stream', value }),
    close: () => t.invoke('karont:command', { method: 'close' }),
    approvals: () => t.invoke('karont:approvals:list'),
    decideApproval: (approvalId: string, allow: boolean) =>
      t.invoke('karont:approvals:decide', { approvalId, allow }),
    diagnostics: () => t.invoke('karont:diagnostics'),
    report: () => t.invoke('karont:report'),
    saveReport: () => t.invoke('karont:report:save'),
    copyReport: () => t.invoke('karont:report:copy'),
    notifications: (enabled?: boolean) => t.invoke('karont:notifications', enabled),
    focusTarget: () => t.invoke('karont:focus-target'),
    onFocusRun: (listener: (id: string) => void) => t.on('karont:focus-run', listener),
    workspaces: (cursor?: string, limit = 100) =>
      t.invoke('karont:workspaces:list', { cursor, limit }),
    createWorkspace: (name: string) =>
      t.invoke('karont:workspaces:create', { name, operationId: crypto.randomUUID() }),
    renameWorkspace: (workspaceId: string, name: string) =>
      t.invoke('karont:workspaces:rename', {
        workspaceId,
        name,
        operationId: crypto.randomUUID(),
      }),
    dots: () => t.invoke('karont:dots:list'),
    projects: (workspaceId?: string, cursor?: string, limit = 100) =>
      t.invoke('karont:projects:list', workspaceId ? { workspaceId, cursor, limit } : undefined),
    projectIndex: (cursor?: string, limit = 100) =>
      t.invoke('karont:projects:list', { cursor, limit }),
    updateProject: (input: { projectId: string; name: string; root: string; icon: string }) =>
      t.invoke('karont:projects:update', { ...input, operationId: crypto.randomUUID() }),
    chooseProjectFolder: () => t.invoke('karont:projects:choose-folder'),
    addProject: (input: {
      workspaceId: string;
      name: string;
      root: string;
      icon: string;
      dotIds: string[];
    }) => t.invoke('karont:projects:add', input),
    chats: (input: {
      scope?: 'all' | 'favorites' | 'recent' | 'free';
      workspaceId?: string;
      projectId?: string;
      cursor?: string;
      limit?: number;
    }) => t.invoke('karont:chats:list', { ...input, limit: input.limit ?? 100 }),
    createChat: (input: {
      workspaceId?: string | null;
      projectId?: string | null;
      dotId?: string | null;
      title: string;
    }) => t.invoke('karont:chats:create', { ...input, operationId: crypto.randomUUID() }),
    chat: (chatId: string) => t.invoke('karont:chats:get', { chatId }),
    renameChat: (chatId: string, title: string, expectedRevision: number) =>
      t.invoke('karont:chats:rename', {
        chatId,
        title,
        expectedRevision,
        operationId: crypto.randomUUID(),
      }),
    openChat: (chatId: string) =>
      t.invoke('karont:chats:open', { chatId, operationId: crypto.randomUUID() }),
    favoriteChat: (chatId: string, favorite: boolean, expectedRevision: number) =>
      t.invoke('karont:chats:favorite', {
        chatId,
        favorite,
        expectedRevision,
        operationId: crypto.randomUUID(),
      }),
    saveDraft: (chatId: string, draft: string, expectedRevision: number) =>
      t.invoke('karont:chats:draft', {
        chatId,
        draft,
        expectedRevision,
        operationId: crypto.randomUUID(),
      }),
    previewMoveChat: (chatId: string, projectId: string, dotId?: string) =>
      t.invoke('karont:chats:move-preview', {
        chatId,
        projectId,
        ...(dotId ? { dotId } : {}),
      }),
    moveChat: (chatId: string, projectId: string, dotId: string, expectedRevision: number) =>
      t.invoke('karont:chats:move', {
        chatId,
        projectId,
        dotId,
        expectedRevision,
        confirmed: true,
        operationId: crypto.randomUUID(),
      }),
    messages: (chatId: string, cursor?: string, limit = 100) =>
      t.invoke('karont:messages:list', { chatId, cursor, limit }),
    saveMessage: (chatId: string, body: string, expectedRevision: number) =>
      t.invoke('karont:messages:save', {
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
    }) => t.invoke('karont:messages:send', { ...input, operationId: crypto.randomUUID() }),
    messageDeliveries: (chatId: string, messageId: string) =>
      t.invoke('karont:messages:deliveries', { chatId, messageId }),
    chatRuns: (chatId: string, cursor?: string, limit = 100) =>
      t.invoke('karont:chats:runs', { chatId, cursor, limit }),
    tasks: (input: {
      workspaceId?: string;
      projectId?: string;
      state?: string;
      assignee?: { kind: 'local' | 'dot'; id: string };
      cursor?: string;
      limit?: number;
    }) => t.invoke('karont:tasks:list', { ...input, limit: input.limit ?? 100 }),
    task: (taskId: string) => t.invoke('karont:tasks:get', { taskId }),
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
    ) => t.invoke('karont:tasks:create', { ...input, operationId }),
    updateTask: (input: {
      taskId: string;
      title?: string;
      description?: string;
      state?: string;
      expectedRevision: number;
    }) => t.invoke('karont:tasks:update', { ...input, operationId: crypto.randomUUID() }),
    setTaskAssignees: (input: {
      taskId: string;
      assignees: { kind: 'local' | 'dot'; id: string }[];
      expectedRevision: number;
    }) =>
      t.invoke('karont:tasks:assignees:set', {
        ...input,
        operationId: crypto.randomUUID(),
      }),
    linkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
      t.invoke('karont:tasks:runs:link', { ...input, operationId: crypto.randomUUID() }),
    unlinkTaskRun: (input: { taskId: string; runId: string; expectedRevision: number }) =>
      t.invoke('karont:tasks:runs:unlink', { ...input, operationId: crypto.randomUUID() }),
    taskEvents: (taskId: string, cursor?: string, limit = 100) =>
      t.invoke('karont:tasks:events:list', { taskId, cursor, limit }),
    navigation: () => t.invoke('karont:navigation:get'),
    setNavigation: (input: {
      workspaceId: string | null;
      projectId: string | null;
      chatId: string | null;
    }) => t.invoke('karont:navigation:set', { ...input, operationId: crypto.randomUUID() }),
    runs: (limit = 40) => t.invoke('karont:runs:list', { limit }),
    startRun: (
      dotId: string,
      projectId: string,
      permissionMode = 'ask',
      elevatedConfirmed = false,
      chatId?: string,
    ) =>
      t.invoke('karont:runs:start', {
        dotId,
        projectId,
        permissionMode,
        elevatedConfirmed,
        ...(chatId ? { chatId } : {}),
        operationId: crypto.randomUUID(),
      }),
    attachTerminal: (runId: string) => t.invoke('karont:terminal:attach', { runId }),
    detachTerminals: () => t.invoke('karont:terminal:detach-all'),
    writeTerminal: (runId: string, data: string) =>
      t.invoke('karont:terminal:write', { runId, data }),
    resizeTerminal: (runId: string, cols: number, rows: number) =>
      t.invoke('karont:terminal:resize', { runId, cols, rows }),
    checkpoints: (runId: string) => t.invoke('karont:checkpoints:list', { runId }),
    checkpoint: (runId: string, operationId: string) =>
      t.invoke('karont:checkpoints:create', { runId, operationId }),
    recovery: (runId: string) => t.invoke('karont:recovery:inspect', { runId }),
    pauseRun: (runId: string) => t.invoke('karont:runs:pause', { runId }),
    resumeRun: (runId: string, operationId: string, newSessionConfirmed = false) =>
      t.invoke('karont:runs:resume', { runId, operationId, newSessionConfirmed }),
    autoResume: (runId: string, enabled: boolean) =>
      t.invoke('karont:runs:autoResume', { runId, enabled }),
    cancelRun: (runId: string) => t.invoke('karont:runs:cancel', { runId }),
    removeWorktree: (runId: string) => t.invoke('karont:worktree:remove', { runId }),
    diff: (runId: string) => t.invoke('karont:runs:diff', { runId }),
    rollbackPreview: (runId: string) => t.invoke('karont:rollback:preview', { runId }),
    rollbackApply: (runId: string) => t.invoke('karont:rollback:apply', { runId, confirmed: true }),
    onEvent: (listener: (event: TerminalEvent) => void) => t.on('karont:event', listener),
  } satisfies KarontBridge;
}

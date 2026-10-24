import type {
  Layout,
  Snapshot,
  TerminalEvent,
  PermissionMode,
  Approval,
  DiagnosticItem,
  capabilitySchema,
} from '../../../packages/contracts/src';
export type UiDot = {
  id: string;
  name: string;
  role: string;
  projectIds: string[];
  capabilities: import('zod').infer<typeof capabilitySchema>[];
};
export type UiProject = { id: string; name: string };
export type UiRun = {
  autoResumeEnabled: boolean;
  permissionMode: PermissionMode;
  id: string;
  dotId: string;
  projectId: string;
  state: import('zod').infer<typeof import('../../../packages/contracts/src').runStateSchema>;
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
export type ErosBridge = {
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
  dots(): Promise<UiDot[]>;
  projects(): Promise<UiProject[]>;
  runs(limit?: number): Promise<UiRun[]>;
  startRun(
    dotId: string,
    projectId: string,
    permissionMode?: PermissionMode,
    elevatedConfirmed?: boolean,
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
    eros: ErosBridge;
  }
}

export type Checkpoint = import('zod').infer<
  typeof import('../../../packages/contracts/src').checkpointSchema
>;
export type Recovery = import('zod').infer<
  typeof import('../../../packages/contracts/src').recoverySchema
>;

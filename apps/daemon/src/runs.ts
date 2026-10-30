import { AutoResumeScheduler } from './auto-resume';
import {
  Continuity,
  processIdentity,
  survivingSession,
  worktreeFingerprint,
  type RunState,
} from './continuity';
import { capabilities, permissionArgs } from './permissions';
import type { PermissionMode } from '../../../packages/contracts/src';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import * as pty from 'node-pty';
import type { DatabaseSync } from 'node:sqlite';
import type { DotConfig } from './database';

const MAX_SCROLLBACK = 256 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
type State = RunState;
type RunRow = {
  id: string;
  chat_id: string | null;
  dot_id: string;
  project_id: string;
  state: State;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  branch: string | null;
  permission_mode: PermissionMode;
  auto_resume: number;
};
type Active = {
  process: pty.IPty;
  sessionId: string;
  scrollback: string;
  cols: number;
  rows: number;
  subscribers: Set<(event: unknown) => void>;
  cancelled: boolean;
};

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_FILE_BYTES * 4,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}
function hash(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
function checkedRelative(file: string) {
  if (
    !file ||
    path.isAbsolute(file) ||
    file.split(/[\\/]/).some((part) => part === '..' || part === '.')
  )
    throw Error('Caminho Git inválido');
  return file;
}
function insideRoot(root: string, file: string) {
  const resolved = path.resolve(root, file);
  return resolved.startsWith(root + path.sep) && resolved !== root
    ? resolved
    : (() => {
        throw Error('Caminho fora da worktree');
      })();
}
function ancestorsAreSafe(root: string, file: string) {
  let current = root;
  for (const part of path.dirname(file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }
  return true;
}
function stateHash(root: string, relative: string): string | null {
  const full = insideRoot(root, relative);
  try {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return hash(Buffer.from(`symlink:${fs.readlinkSync(full)}`));
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return hash(fs.readFileSync(full));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class RunManager {
  private active = new Map<string, Active>();
  private sessions = new Map<string, Active>();
  private queue: string[] = [];
  readonly continuity: Continuity;
  private scheduler: AutoResumeScheduler;
  private pumping = false;
  private closing = false;
  private subscribers = new Set<(event: unknown) => void>();

  constructor(
    private db: DatabaseSync,
    private worktreeRoot: string,
    private configuredDots: DotConfig[],
  ) {
    fs.mkdirSync(worktreeRoot, { recursive: true, mode: 0o700 });
    this.continuity = new Continuity(db);
    this.continuity.recover();
    // No production adapter is certified. The scheduler cannot launch generic or Codex PTYs.
    this.scheduler = new AutoResumeScheduler(
      this.continuity,
      () => undefined,
      (id) => {
        const row = this.db.prepare('SELECT auto_resume,dot_id FROM runs WHERE id=?').get(id);
        return (
          row?.auto_resume === 1 &&
          this.configuredDots.find((d) => d.id === row.dot_id)?.autoResume !== false
        );
      },
      (id) => {
        try {
          const wt = this.db
            .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
            .get(id);
          return wt ? worktreeFingerprint(String(wt.path)) : null;
        } catch {
          return null;
        }
      },
      (id, kind) => {
        const event = this.continuity.event(id, kind);
        this.emit({
          type: 'continuity.notice',
          runId: id,
          eventId: String(event.lastInsertRowid),
          kind,
        });
      },
    );
    this.scheduler.start();
    this.queue = (
      db.prepare("SELECT id FROM runs WHERE state='queued' ORDER BY created_at").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
    void this.pump();
  }

  onEvent(listener: (event: unknown) => void) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }
  private emit(event: unknown) {
    for (const listener of this.subscribers) listener(event);
  }
  listDots() {
    return this.configuredDots.map((dot) => ({
      id: dot.id,
      name: dot.name,
      role: dot.role,
      projectIds: (
        this.db.prepare('SELECT id,origin FROM projects ORDER BY id').all() as {
          id: string;
          origin: string;
        }[]
      )
        .filter((project) =>
          project.origin === 'config'
            ? dot.projectIds.includes(project.id)
            : Boolean(
                this.db
                  .prepare('SELECT 1 FROM project_dot_grants WHERE project_id=? AND dot_id=?')
                  .get(project.id, dot.id),
              ),
        )
        .map((project) => project.id),
      capabilities: capabilities(dot),
    }));
  }
  listProjects() {
    return this.db.prepare('SELECT id,name FROM projects ORDER BY name').all();
  }
  listRuns(limit: number) {
    const rows = this.db
      .prepare(
        `SELECT r.*, s.id AS session_id,s.pid AS session_pid FROM runs r LEFT JOIN sessions s ON s.run_id=r.id ORDER BY r.created_at DESC LIMIT ?`,
      )
      .all(limit) as (RunRow & { session_id: string | null; session_pid: number | null })[];
    return rows.map((row) => this.serialize(row));
  }
  private serialize(row: RunRow & { session_id?: string | null; session_pid?: number | null }) {
    return {
      permissionMode: row.permission_mode,
      autoResumeEnabled: row.auto_resume === 1,
      id: row.id,
      chatId: row.chat_id ?? null,
      dotId: row.dot_id,
      projectId: row.project_id,
      state: row.state,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      exitCode: row.exit_code,
      error: row.error,
      branch: row.branch,
      sessionId: row.session_id ?? null,
      pid: row.session_pid ?? null,
    };
  }
  private getRun(id: string) {
    const row = this.db
      .prepare(
        'SELECT r.*,s.id AS session_id,s.pid AS session_pid FROM runs r LEFT JOIN sessions s ON s.run_id=r.id WHERE r.id=?',
      )
      .get(id) as (RunRow & { session_id: string | null; session_pid: number | null }) | undefined;
    if (!row) throw Error('Execução não encontrada');
    return { row, run: this.serialize(row) };
  }
  private authorizedForProject(dot: DotConfig, project: { id: string; origin: string }) {
    if (!this.configuredDots.some((configured) => configured.id === dot.id)) return false;
    if (project.origin === 'config') return dot.projectIds.includes(project.id);
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM project_dot_grants WHERE project_id=? AND dot_id=?')
        .get(project.id, dot.id),
    );
  }
  private validateProjectRoot(rootValue: string) {
    try {
      const root = fs.realpathSync(rootValue);
      if (!fs.statSync(root).isDirectory()) throw Error();
      fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK);
      const topLevel = fs.realpathSync(String(git(root, ['rev-parse', '--show-toplevel'])).trim());
      if (topLevel !== root || git(root, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true')
        throw Error();
      execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'ignore' });
      return root;
    } catch {
      throw Error('Projeto Git indisponível ou sem commit inicial');
    }
  }
  async start(
    dotId: string,
    projectId: string,
    mode: PermissionMode = 'ask',
    confirmed = false,
    operationId?: string,
    chatId?: string,
  ) {
    const dot = this.configuredDots.find((d) => d.id === dotId);
    const project = this.db
      .prepare('SELECT id,root,git_root,origin FROM projects WHERE id=?')
      .get(projectId) as { id: string; root: string; git_root: string; origin: string } | undefined;
    if (!dot || !project || !this.authorizedForProject(dot, project))
      throw Error('Dot não autorizado para este projeto');
    permissionArgs(dot, mode, confirmed);
    this.validateProjectRoot(project.root);
    if (chatId) {
      const chat = this.db.prepare('SELECT project_id,dot_id FROM chats WHERE id=?').get(chatId) as
        | { project_id: string | null; dot_id: string | null }
        | undefined;
      if (!chat || chat.project_id !== projectId || (chat.dot_id !== null && chat.dot_id !== dotId))
        throw Error('Conversa não corresponde ao Dot e projeto selecionados');
    }
    if (operationId) {
      const previous = this.db
        .prepare('SELECT run_id,kind FROM operations WHERE id=?')
        .get(operationId) as { run_id: string; kind: string } | undefined;
      if (previous) {
        const old = this.getRun(previous.run_id).run;
        if (
          previous.kind !== 'enqueue' ||
          old.dotId !== dotId ||
          old.projectId !== projectId ||
          old.permissionMode !== mode ||
          old.chatId !== (chatId ?? null)
        )
          throw Error('Chave de operação reutilizada');
        return old;
      }
    }
    if (chatId) {
      const activeChatRun = this.db
        .prepare(
          "SELECT id FROM runs WHERE chat_id=? AND state NOT IN ('completed','failed','cancelled') LIMIT 1",
        )
        .get(chatId);
      if (activeChatRun) throw Error('Conversa já tem uma execução não terminal vinculada');
    }
    const id = randomUUID(),
      now = Date.now();
    this.continuity.transaction(() => {
      if (chatId)
        this.db
          .prepare(
            'UPDATE chats SET dot_id=?,revision=revision+1,updated_at=? WHERE id=? AND dot_id IS NULL',
          )
          .run(dotId, now, chatId);
      this.db
        .prepare(
          "INSERT INTO runs(id,dot_id,project_id,chat_id,state,created_at,permission_mode,auto_resume) VALUES(?,?,?,?,'queued',?,?,?)",
        )
        .run(id, dotId, projectId, chatId ?? null, now, mode, dot.autoResume === false ? 0 : 1);
      const key = operationId ?? randomUUID();
      this.continuity.begin(key, id, 'enqueue');
      this.event(id, 'run.queued', { dotId, projectId, chatId: chatId ?? null });
      this.continuity.complete(key);
      this.continuity.checkpoint(id, 'before_start');
    });
    this.queue.push(id);
    this.publishRun(id);
    void this.pump();
    return this.getRun(id).run;
  }
  private publishRun(id: string) {
    const { run } = this.getRun(id);
    this.emit({ type: 'run.updated', run });
  }
  private async pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    try {
      while (this.active.size < 2 && this.queue.length && !this.closing) {
        const id = this.queue.shift()!;
        if (this.getRun(id).row.state !== 'queued') continue;
        try {
          await this.launch(id);
        } catch (error) {
          this.fail(id, 'Falha ao preparar a execução', error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  private async launch(id: string) {
    const { row } = this.getRun(id);
    const dot = this.configuredDots.find((d) => d.id === row.dot_id);
    const project = this.db
      .prepare('SELECT root,git_root,origin,id FROM projects WHERE id=?')
      .get(row.project_id) as
      | { root: string; git_root: string; origin: string; id: string }
      | undefined;
    if (!dot || !project || !this.authorizedForProject(dot, project))
      throw Error('Dot não autorizado para este projeto');
    const root = this.validateProjectRoot(project.root);
    const gitRoot = String(git(root, ['rev-parse', '--show-toplevel'])).trim();
    const isWorktree = String(git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
    if (!isWorktree || fs.realpathSync(gitRoot) !== root)
      throw Error('Projeto não é a raiz de um repositório Git válido');
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'ignore' });
    const executable = fs.realpathSync(dot.executable);
    const execStat = fs.statSync(executable);
    fs.accessSync(executable, fs.constants.X_OK);
    if (!execStat.isFile()) throw Error('CLI configurada não é um executável regular');
    const runDir = path.join(this.worktreeRoot, row.project_id);
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const worktreePath = path.join(runDir, id);
    const branch = `karont/run-${id}`;
    const existing = this.db
      .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(id) as { path: string } | undefined;
    if (!existing) {
      const op = `worktree:${id}`;
      const status = this.continuity.begin(op, id, 'worktree');
      if (status !== 'new') throw Error('Operação de worktree incerta; revisão necessária');
      this.continuity.checkpoint(id, 'before_operation');
      git(root, ['worktree', 'add', '--quiet', '-b', branch, worktreePath, 'HEAD']);
      this.continuity.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO worktrees(run_id,path,branch,base_ref,created_at) VALUES(?,?,?,?,?)',
          )
          .run(id, worktreePath, branch, 'HEAD', Date.now());
        this.continuity.complete(op);
        this.continuity.checkpoint(id, 'after_operation');
      });
    } else {
      if (fs.realpathSync(existing.path) !== path.resolve(worktreePath))
        throw Error('Worktree inválida');
      const commonDirectory = (cwd: string) =>
        fs.realpathSync(
          path.resolve(cwd, String(git(cwd, ['rev-parse', '--git-common-dir'])).trim()),
        );
      if (
        String(git(existing.path, ['symbolic-ref', '--short', 'HEAD'])).trim() !== branch ||
        commonDirectory(existing.path) !== commonDirectory(root)
      )
        throw Error('Worktree inválida');
    }
    // Mark launch intent before spawn: a crash anywhere beyond here is uncertain.
    const launchOp = randomUUID();
    this.continuity.begin(launchOp, id, 'launch');
    this.continuity.transition(id, 'running', 'launch intent');
    const sessionId = randomUUID();
    const cols = 100,
      rows = 30,
      startedAt = Date.now();
    const env: Record<string, string> = {};
    for (const key of [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'SHELL',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'TMPDIR',
      'DISPLAY',
      'WAYLAND_DISPLAY',
      'DBUS_SESSION_BUS_ADDRESS',
    ]) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    const child = pty.spawn(
      executable,
      permissionArgs(dot, row.permission_mode, row.permission_mode === 'full'),
      { name: env.TERM, cols, rows, cwd: worktreePath, env },
    );
    const active: Active = {
      process: child,
      sessionId,
      scrollback: '',
      cols,
      rows,
      subscribers: new Set(),
      cancelled: false,
    };
    this.active.set(id, active);
    this.sessions.set(id, active);
    this.db
      .prepare(
        'UPDATE runs SET started_at=?,branch=?,finished_at=NULL,exit_code=NULL,error=NULL WHERE id=?',
      )
      .run(startedAt, branch, id);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO sessions(id,run_id,pid,cols,rows,state,started_at,identity_json) VALUES(?,?,?,?,?,'running',?,?)",
      )
      .run(
        sessionId,
        id,
        child.pid,
        cols,
        rows,
        startedAt,
        JSON.stringify(processIdentity(child.pid)),
      );
    this.continuity.complete(launchOp);
    this.continuity.checkpoint(id, 'started');
    this.event(id, 'run.started', {
      sessionId,
      pid: child.pid,
      branch,
      configFingerprint: this.configFingerprint(row.dot_id, row.project_id),
    });
    this.publishRun(id);
    child.onData((data) => {
      active.scrollback += data;
      if (Buffer.byteLength(active.scrollback) > MAX_SCROLLBACK) {
        while (Buffer.byteLength(active.scrollback) > MAX_SCROLLBACK)
          active.scrollback = active.scrollback.slice(
            Math.max(1, Math.floor(active.scrollback.length / 8)),
          );
      }
      for (let offset = 0; offset < data.length; offset += 4000) {
        const part = data.slice(offset, offset + 4000);
        for (const listener of active.subscribers)
          listener({ type: 'terminal.output', runId: id, data: part });
      }
    });
    child.onExit(({ exitCode }) => {
      void this.finish(id, exitCode, active.cancelled);
    });
  }
  private event(runId: string, type: string, metadata: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO run_events(run_id,type,created_at,metadata_json) VALUES(?,?,?,?)')
      .run(runId, type, Date.now(), JSON.stringify(metadata));
  }
  private fail(id: string, message: string, _cause?: unknown) {
    const now = Date.now();
    const state = this.getRun(id).row.state;
    const uncertain =
      state === 'running' ||
      Boolean(
        this.db.prepare("SELECT 1 FROM operations WHERE run_id=? AND status!='completed'").get(id),
      );
    this.continuity.transition(id, uncertain ? 'recovery_needed' : 'failed', message);
    this.db.prepare('UPDATE runs SET error=? WHERE id=?').run(message, id);
    this.publishRun(id);
  }
  private async finish(id: string, exitCode: number, cancelled: boolean) {
    const active = this.active.get(id);
    if (!active || this.closing) return;
    this.active.delete(id);
    const now = Date.now();
    try {
      this.recordChanges(id);
    } catch {
      this.event(id, 'run.diff_failed', {
        reason: 'Não foi possível registrar o resumo das alterações',
      });
    }
    const state: State = cancelled ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed';
    const safeError = state === 'failed' ? `CLI encerrou com código ${exitCode}` : null;
    this.db
      .prepare('UPDATE runs SET finished_at=?,exit_code=?,error=? WHERE id=?')
      .run(now, exitCode, safeError, id);
    this.continuity.transition(id, state, 'process exit');
    this.db.prepare('UPDATE sessions SET state=?,finished_at=? WHERE run_id=?').run(state, now, id);
    this.event(id, `run.${state}`, { exitCode });
    this.publishRun(id);
    while (this.sessions.size > 20) {
      const oldest = [...this.sessions.keys()].find((key) => !this.active.has(key));
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
    void this.pump();
  }
  cancel(runId: string) {
    const { row } = this.getRun(runId);
    if (
      ['queued', 'paused', 'waiting_quota', 'waiting_approval', 'recovery_needed'].includes(
        row.state,
      )
    ) {
      this.continuity.transition(runId, 'cancelled', 'explicit cancellation');
      this.db.prepare("UPDATE resume_jobs SET status='cancelled' WHERE run_id=?").run(runId);
      this.publishRun(runId);
      void this.pump();
      return this.getRun(runId).run;
    }
    const active = this.active.get(runId);
    if (!active) {
      if (row.state === 'cancelled') return this.getRun(runId).run;
      throw Error('Execução não está ativa');
    }
    if (active.cancelled) return this.getRun(runId).run;
    active.cancelled = true;
    active.process.kill();
    return this.getRun(runId).run;
  }
  pause(runId: string) {
    const state = this.getRun(runId).row.state;
    if (state !== 'queued' && state !== 'paused')
      throw Error('Pausa disponível somente para agendamento ainda não iniciado');
    this.continuity.transition(runId, 'paused', 'schedule pause');
    this.publishRun(runId);
    return this.getRun(runId).run;
  }
  checkpoint(runId: string, operationId: string) {
    this.getRun(runId);
    return this.continuity.transaction(() => {
      const status = this.continuity.begin(operationId, runId, 'checkpoint');
      if (status === 'new') {
        this.continuity.checkpoint(runId, 'manual', operationId);
        this.continuity.complete(operationId);
      }
      return this.continuity.checkpoints(runId);
    });
  }
  private configFingerprint(dotId: string, projectId: string) {
    const dot = this.configuredDots.find((d) => d.id === dotId);
    const project = this.db.prepare('SELECT root FROM projects WHERE id=?').get(projectId);
    if (!dot || !project) return null;
    try {
      const executable = fs.realpathSync(dot.executable),
        stat = fs.statSync(executable);
      return hash(
        Buffer.from(
          JSON.stringify({
            executable,
            mtime: stat.mtimeMs,
            size: stat.size,
            args: dot.args,
            adapter: dot.adapter,
            root: fs.realpathSync(String(project.root)),
          }),
        ),
      );
    } catch {
      return null;
    }
  }
  inspect(runId: string) {
    const { run } = this.getRun(runId);
    const wt = this.db.prepare('SELECT path,removed_at FROM worktrees WHERE run_id=?').get(runId) as
      | { path: string; removed_at: number | null }
      | undefined;
    const session = this.db
      .prepare('SELECT identity_json FROM sessions WHERE run_id=?')
      .get(runId) as { identity_json: string | null } | undefined;
    const survivor = session
      ? survivingSession(session.identity_json ? JSON.parse(session.identity_json) : null)
      : false;
    const uncertain = this.db
      .prepare("SELECT kind FROM operations WHERE run_id=? AND status!='completed'")
      .all(runId)
      .map((r) => String(r.kind));
    let fingerprint: string | null = null;
    if (wt && !wt.removed_at)
      try {
        fingerprint = worktreeFingerprint(wt.path);
      } catch {}
    const latest = this.db
      .prepare(
        'SELECT snapshot_json FROM checkpoints WHERE run_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
      )
      .get(runId) as { snapshot_json: string } | undefined;
    const prior = latest ? JSON.parse(latest.snapshot_json).fingerprint : null;
    const launched = this.db
      .prepare(
        "SELECT metadata_json FROM run_events WHERE run_id=? AND type='run.started' ORDER BY id DESC LIMIT 1",
      )
      .get(runId) as { metadata_json: string } | undefined;
    const configMatches =
      !!launched &&
      JSON.parse(launched.metadata_json).configFingerprint ===
        this.configFingerprint(run.dotId, run.projectId);
    return {
      runId,
      state: run.state,
      reason: run.error,
      lastCheckpoint: this.continuity.checkpoints(runId)[0] ?? null,
      worktreeAvailable: !!fingerprint,
      worktreeChanged: prior && fingerprint ? prior !== fingerprint : null,
      survivingProcess: survivor,
      sessionRecoverable: this.active.has(runId),
      nativeResume: false,
      uncertainOperations: uncertain,
      canStartNewSession:
        ['recovery_needed', 'failed'].includes(run.state) &&
        !!fingerprint &&
        !survivor &&
        !uncertain.length &&
        configMatches &&
        run.permissionMode !== 'full',
      autoResume: 'unavailable',
      risk: 'Nova sessão pode repetir trabalho e efeitos externos. O checkpoint lógico não restaura memória nem PTY.',
    };
  }
  async resume(runId: string, operationId: string, confirmed = false) {
    const status = this.db
      .prepare('SELECT status FROM operations WHERE id=? AND run_id=? AND kind=?')
      .get(operationId, runId, 'resume') as { status: string } | undefined;
    if (status?.status === 'completed') return this.getRun(runId).run;
    const { row } = this.getRun(runId);
    if (row.state !== 'paused') {
      const info = this.inspect(runId);
      if (!confirmed || !info.canStartNewSession)
        throw Error(
          'Retomada exige revisão e confirmação de nova sessão; processo ou operação incerta pode impedir',
        );
      if (row.permission_mode === 'full')
        throw Error('Acesso total exige nova execução e confirmação nativa');
    }
    const dot = this.configuredDots.find((d) => d.id === row.dot_id);
    const project = this.db
      .prepare('SELECT id,root,origin FROM projects WHERE id=?')
      .get(row.project_id) as { id: string; root: string; origin: string } | undefined;
    if (!dot || !project || !this.authorizedForProject(dot, project))
      throw Error('Dot não autorizado para este projeto');
    this.validateProjectRoot(project.root);
    permissionArgs(
      dot,
      row.permission_mode,
      row.state === 'paused' && row.permission_mode === 'full',
    );
    this.continuity.transaction(() => {
      if (this.continuity.begin(operationId, runId, 'resume') !== 'new')
        throw Error('Operação de retomada incerta');
      this.continuity.transition(runId, 'queued', 'explicit manual resume');
      this.continuity.complete(operationId);
    });
    this.event(runId, 'run.resumed', { newSession: row.state !== 'paused' });
    this.queue.push(runId);
    this.publishRun(runId);
    void this.pump();
    return this.getRun(runId).run;
  }
  autoResume(runId: string, enabled: boolean) {
    this.getRun(runId);
    // Persist opt-out even though no production adapter is yet certified.
    this.continuity.transaction(() => {
      this.db.prepare('UPDATE runs SET auto_resume=? WHERE id=?').run(enabled ? 1 : 0, runId);
      this.event(runId, 'auto_resume.preference', { enabled });
      this.continuity.checkpoint(runId, 'preference');
    });
    return { enabled, supported: false };
  }
  shutdown() {
    this.closing = true;
    this.scheduler.stop();
    this.continuity.shutdown();
    for (const active of this.active.values())
      try {
        active.process.kill();
      } catch {}
  }
  attach(runId: string, listener: (event: unknown) => void) {
    const { run } = this.getRun(runId);
    const active = this.sessions.get(runId);
    if (active) active.subscribers.add(listener);
    return {
      run,
      cols: active?.cols ?? 100,
      rows: active?.rows ?? 30,
      scrollback: active?.scrollback ?? '',
    };
  }
  detach(listener: (event: unknown) => void) {
    for (const run of this.sessions.values()) run.subscribers.delete(listener);
  }
  write(runId: string, data: string) {
    const active = this.active.get(runId);
    if (!active) throw Error('Terminal não está ativo');
    active.process.write(data);
    return { ok: true };
  }
  isActive(runId: string) {
    return this.active.has(runId);
  }
  resize(runId: string, cols: number, rows: number) {
    const active = this.active.get(runId);
    if (!active) return { ok: true };
    active.cols = cols;
    active.rows = rows;
    active.process.resize(cols, rows);
    this.db.prepare('UPDATE sessions SET cols=?,rows=? WHERE run_id=?').run(cols, rows, runId);
    return { ok: true };
  }
  private recordChanges(runId: string) {
    const row = this.db
      .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(runId) as { path: string } | undefined;
    if (!row) return;
    const status = String(
      git(row.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
    );
    const entries = status.split('\0').filter(Boolean);
    const files = new Set<string>();
    for (const item of entries) {
      const file = checkedRelative(item.slice(3));
      files.add(file);
    }
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO file_changes(run_id,path,kind,before_hash,after_hash,additions,deletions) VALUES(?,?,?,?,?,?,?)',
    );
    for (const file of files) {
      const full = insideRoot(row.path, file);
      const afterHash = stateHash(row.path, file);
      let beforeHash: string | null = null;
      try {
        beforeHash = hash(
          execFileSync('git', ['show', `HEAD:${file}`], {
            cwd: row.path,
            encoding: 'buffer',
            maxBuffer: MAX_FILE_BYTES * 4,
            stdio: ['ignore', 'pipe', 'ignore'],
          }),
        );
      } catch {
        beforeHash = null;
      }
      const currentExists = (() => {
        try {
          fs.lstatSync(full);
          return true;
        } catch {
          return false;
        }
      })();
      const kind = beforeHash === null ? 'created' : !currentExists ? 'deleted' : 'modified';
      let additions = 0,
        deletions = 0;
      if (beforeHash !== null) {
        const nums = String(git(row.path, ['diff', '--numstat', 'HEAD', '--', file]))
          .trim()
          .split('\t');
        additions = Number(nums[0]) || 0;
        deletions = Number(nums[1]) || 0;
      } else if (afterHash !== null) {
        try {
          additions = fs.readFileSync(full, 'utf8').split('\n').length;
        } catch {}
      }
      insert.run(runId, file, kind, beforeHash, afterHash, additions, deletions);
    }
  }
  diff(runId: string) {
    const { row } = this.getRun(runId);
    const rolledBack = Boolean(
      this.db
        .prepare(
          "SELECT 1 AS found FROM run_events WHERE run_id=? AND type='rollback.applied' LIMIT 1",
        )
        .get(runId),
    );
    const wt = this.db
      .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(runId) as { path: string } | undefined;
    if (rolledBack)
      return {
        run: this.serialize(row),
        files: [],
        totalFiles: 0,
        filesTruncated: false,
        diff: '',
        diffTruncated: false,
      };
    if (!wt) {
      const fileCount = Number(
        (
          this.db
            .prepare('SELECT count(*) AS total FROM file_changes WHERE run_id=?')
            .get(runId) as { total: number }
        ).total,
      );
      if (fileCount === 0)
        return {
          run: this.serialize(row),
          files: [],
          totalFiles: 0,
          filesTruncated: false,
          diff: '',
          diffTruncated: false,
        };
      throw Error('Worktree desta execução não está disponível');
    }
    const files = this.db
      .prepare(
        'SELECT path,kind,before_hash AS beforeHash,after_hash AS afterHash,additions,deletions FROM file_changes WHERE run_id=? ORDER BY path',
      )
      .all(runId);
    let diff = String(
      git(wt.path, [
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--no-renames',
        '--binary',
        '--unified=3',
        'HEAD',
        '--',
      ]),
    );
    for (const file of files as { path: string; kind: string }[]) {
      if (file.kind !== 'created') continue;
      const result = spawnSync(
        'git',
        [
          'diff',
          '--no-index',
          '--no-ext-diff',
          '--no-color',
          '--no-renames',
          '--unified=3',
          '--',
          '/dev/null',
          file.path,
        ],
        {
          cwd: wt.path,
          encoding: 'utf8',
          maxBuffer: MAX_FILE_BYTES * 4,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      if (result.status !== 0 && result.status !== 1) throw Error('Não foi possível gerar diff');
      diff += result.stdout;
    }
    const maxDiff = 48 * 1024;
    return {
      run: this.serialize(row),
      files,
      totalFiles: files.length,
      filesTruncated: false,
      diff: diff.slice(0, maxDiff),
      diffTruncated: diff.length > maxDiff,
    };
  }
  previewRollback(runId: string, createRequest = true) {
    const { run } = this.getRun(runId);
    const wt = this.db
      .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(runId) as { path: string } | undefined;
    if (!wt) throw Error('Worktree desta execução não está disponível');
    const files = this.db
      .prepare(
        'SELECT path,kind,before_hash AS beforeHash,after_hash AS afterHash,additions,deletions FROM file_changes WHERE run_id=? ORDER BY path',
      )
      .all(runId) as {
      path: string;
      kind: string;
      beforeHash: string | null;
      afterHash: string | null;
      additions: number;
      deletions: number;
    }[];
    const session = this.db
      .prepare('SELECT identity_json FROM sessions WHERE run_id=?')
      .get(runId) as { identity_json: string | null } | undefined;
    const survivor = session
      ? survivingSession(session.identity_json ? JSON.parse(session.identity_json) : null)
      : false;
    const uncertain = Boolean(
      this.db.prepare("SELECT 1 FROM operations WHERE run_id=? AND status!='completed'").get(runId),
    );
    const applied = Boolean(
      this.db
        .prepare(
          "SELECT 1 AS found FROM run_events WHERE run_id=? AND type='rollback.applied' LIMIT 1",
        )
        .get(runId),
    );
    const conflicts = applied
      ? []
      : files
          .filter(
            (file) =>
              !ancestorsAreSafe(wt.path, file.path) ||
              stateHash(wt.path, file.path) !== file.afterHash,
          )
          .map((file) => file.path);
    let approvalId: string | undefined;
    if (
      createRequest &&
      !applied &&
      files.length &&
      !conflicts.length &&
      !survivor &&
      !uncertain &&
      ['completed', 'failed', 'cancelled'].includes(run.state)
    ) {
      const pending = this.db
        .prepare(
          "SELECT id FROM approvals WHERE run_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
        )
        .get(runId) as { id: string } | undefined;
      approvalId = pending?.id ?? randomUUID();
      if (!pending) {
        this.db
          .prepare("INSERT INTO approvals(id,run_id,status,created_at) VALUES(?,?,'pending',?)")
          .run(approvalId, runId, Date.now());
        this.event(runId, 'approval.requested', { approvalId, operation: 'rollback' });
        this.emit({
          type: 'approval.updated',
          approval: this.listApprovals().find((a) => a.id === approvalId),
        });
      }
    }
    return {
      approvalId,
      run,
      files,
      totalFiles: files.length,
      filesTruncated: false,
      conflicts,
      conflictsTruncated: false,
      applied,
      canRollback:
        !applied &&
        files.length > 0 &&
        conflicts.length === 0 &&
        !survivor &&
        !uncertain &&
        ['completed', 'failed', 'cancelled'].includes(run.state),
    };
  }
  listApprovals() {
    return this.db
      .prepare(
        `SELECT a.id,a.run_id AS runId,r.dot_id AS dotId,r.project_id AS projectId,'rollback' AS operation,a.status,a.created_at AS createdAt,a.decided_at AS decidedAt FROM approvals a JOIN runs r ON r.id=a.run_id ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all() as import('../../../packages/contracts/src').Approval[];
  }
  decideApproval(id: string, allow: boolean) {
    const approval = this.listApprovals().find((item) => item.id === id);
    if (!approval || approval.status !== 'pending')
      throw Error('Pedido de aprovação inválido ou já decidido');
    let status = allow ? 'applied' : 'denied';
    try {
      if (allow) this.performRollback(approval.runId);
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      this.db
        .prepare('UPDATE approvals SET status=?,decided_at=? WHERE id=?')
        .run(status, Date.now(), id);
      this.event(approval.runId, 'approval.decided', {
        approvalId: id,
        decision: allow ? 'allow' : 'deny',
        status,
      });
      this.emit({
        type: 'approval.updated',
        approval: this.listApprovals().find((item) => item.id === id),
      });
    }
    return this.listApprovals().find((item) => item.id === id)!;
  }
  applyRollback(runId: string) {
    const current = this.previewRollback(runId, false);
    if (current.conflicts.length) throw Error('Conflitos detectados; alterações preservadas');
    // Legacy named operation still needs a real daemon-issued pending request.
    const approval = this.listApprovals().find(
      (item) => item.runId === runId && item.status === 'pending',
    );
    if (!approval) throw Error('Pedido de aprovação pendente obrigatório');
    this.decideApproval(approval.id, true);
    return this.previewRollback(runId, false);
  }
  private performRollback(runId: string) {
    const preview = this.previewRollback(runId, false);
    if (!preview.canRollback)
      throw Error(
        preview.conflicts.length
          ? 'Conflitos detectados; alterações preservadas'
          : 'Não há alterações elegíveis para desfazer',
      );
    const wt = this.db
      .prepare('SELECT path,branch FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(runId) as { path: string; branch: string };
    const op = `rollback:${runId}`;
    const status = this.continuity.begin(op, runId, 'rollback');
    if (status !== 'new') throw Error('Operação de rollback incerta; revisão necessária');
    this.continuity.checkpoint(runId, 'before_operation');
    const reverted = preview.files.map((file) => file.path);
    for (const file of preview.files) {
      const relative = checkedRelative(file.path);
      if (!ancestorsAreSafe(wt.path, relative))
        throw Error('Conflito de caminho detectado; alterações preservadas');
      if (file.beforeHash === null) {
        const full = insideRoot(wt.path, relative);
        try {
          fs.unlinkSync(full);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      } else git(wt.path, ['restore', '--source=HEAD', '--staged', '--worktree', '--', relative]);
    }
    this.db
      .prepare('INSERT INTO run_events(run_id,type,created_at,metadata_json) VALUES(?,?,?,?)')
      .run(runId, 'rollback.applied', Date.now(), JSON.stringify({ files: reverted }));
    this.continuity.complete(op);
    this.continuity.checkpoint(runId, 'after_operation');
    return {
      run: preview.run,
      files: preview.files,
      totalFiles: preview.totalFiles,
      filesTruncated: false,
      conflicts: [],
      conflictsTruncated: false,
      applied: true,
      canRollback: false,
    };
  }
  cleanup(runId: string) {
    const { run } = this.getRun(runId);
    if (!['completed', 'failed', 'cancelled'].includes(run.state))
      throw Error('Worktree de execução ativa não pode ser removida');
    const info = this.inspect(runId);
    if (info.survivingProcess || info.uncertainOperations.length)
      throw Error('Worktree de execução ativa ou incerta não pode ser removida');
    const wt = this.db
      .prepare('SELECT path FROM worktrees WHERE run_id=? AND removed_at IS NULL')
      .get(runId) as { path: string } | undefined;
    if (!wt) return { ok: true };
    const project = this.db
      .prepare('SELECT root FROM projects WHERE id=(SELECT project_id FROM runs WHERE id=?)')
      .get(runId) as { root: string };
    if (String(git(wt.path, ['status', '--porcelain'])).trim())
      throw Error('Conflitos detectados; worktree modificada foi preservada');
    const op = `remove:${runId}`;
    if (this.continuity.begin(op, runId, 'worktree_remove') !== 'new')
      throw Error('Operação de remoção incerta; revisão necessária');
    this.continuity.checkpoint(runId, 'before_operation');
    git(project.root, ['worktree', 'remove', wt.path]);
    this.continuity.transaction(() => {
      this.db.prepare('UPDATE worktrees SET removed_at=? WHERE run_id=?').run(Date.now(), runId);
      this.event(runId, 'worktree.removed', {});
      this.continuity.complete(op);
      this.continuity.checkpoint(runId, 'after_operation');
    });
    return { ok: true };
  }
}

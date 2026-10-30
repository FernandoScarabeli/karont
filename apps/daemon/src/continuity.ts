import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import { runStateSchema } from '../../../packages/contracts/src';
export type RunState = z.infer<typeof runStateSchema>;
const edges: Record<RunState, RunState[]> = {
  queued: ['running', 'paused', 'cancelled', 'failed', 'recovery_needed'],
  running: [
    'completed',
    'failed',
    'cancelled',
    'recovery_needed',
    'waiting_quota',
    'waiting_approval',
  ],
  paused: ['queued', 'cancelled', 'recovery_needed'],
  waiting_quota: ['running', 'cancelled', 'recovery_needed'],
  waiting_approval: ['running', 'cancelled', 'recovery_needed'],
  recovery_needed: ['queued', 'cancelled'],
  completed: [],
  failed: ['queued'],
  cancelled: [],
};
export type ProcessIdentity = {
  pid: number;
  boot: string;
  start: string;
  uid: number;
  exe: string;
  session: number;
};
export function processIdentity(pid: number): ProcessIdentity | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(' ');
    if (fields[0] === 'Z' || fields[0] === 'X') return null;
    return {
      pid,
      boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      start: fields[19],
      uid: fs.statSync(`/proc/${pid}`).uid,
      exe: fs.readlinkSync(`/proc/${pid}/exe`),
      session: Number(fields[3]),
    };
  } catch {
    return null;
  }
}
export function sameProcess(expected: ProcessIdentity | null) {
  if (!expected) return false;
  const current = processIdentity(expected.pid);
  return (
    current !== null &&
    (['pid', 'boot', 'start', 'uid', 'exe', 'session'] as const).every(
      (key) => current[key] === expected[key],
    )
  );
}
export function survivingSession(identity: ProcessIdentity | null): boolean {
  if (!identity) return true; // Unknown ownership must never authorize a relaunch.
  if (identity.boot !== fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim())
    return false;
  const leader = processIdentity(identity.pid);
  if (leader && leader.start === identity.start && leader.uid === identity.uid) return true;
  // forkpty creates a session led by the returned child PID. Immediately after
  // fork the child may still report its parent's session until login_tty/setsid.
  // Never mistake that transient parent session for the owned PTY session.
  return fs
    .readdirSync('/proc')
    .filter((n) => /^\d+$/.test(n))
    .some((n) => {
      const current = processIdentity(Number(n));
      return current?.session === identity.pid && current.uid === identity.uid;
    });
}
export function worktreeFingerprint(root: string): string {
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const digest = createHash('sha256');
  digest.update(git(['rev-parse', 'HEAD']));
  digest.update(git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']));
  const files = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const file of files) {
    const full = `${root}/${file}`,
      stat = fs.lstatSync(full);
    digest.update(file + '\0');
    if (stat.isSymbolicLink()) digest.update(fs.readlinkSync(full));
    else {
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
        throw Error('Worktree excede limite de inspeção segura');
      digest.update(fs.readFileSync(full));
    }
  }
  return digest.digest('hex');
}
export class Continuity {
  readonly previousShutdown: string;
  private depth = 0;
  constructor(readonly db: DatabaseSync) {
    this.previousShutdown = String(
      (
        db.prepare("SELECT value FROM settings WHERE key='daemon.clean'").get() as
          | { value: string }
          | undefined
      )?.value ?? 'first',
    );
    db.prepare("INSERT OR REPLACE INTO settings VALUES('daemon.clean','false')").run();
  }
  transaction<T>(fn: () => T): T {
    const level = this.depth++,
      name = `continuity_${level}`;
    this.db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    try {
      const result = fn();
      this.db.exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      if (level) this.db.exec(`RELEASE ${name}`);
      throw error;
    } finally {
      this.depth--;
    }
  }

  event(runId: string, type: string, metadata: Record<string, unknown> = {}) {
    return this.db
      .prepare('INSERT INTO run_events(run_id,type,created_at,metadata_json) VALUES(?,?,?,?)')
      .run(runId, type, Date.now(), JSON.stringify(metadata));
  }
  checkpoint(runId: string, origin: string, id: string = randomUUID()) {
    const run = this.db
      .prepare('SELECT id,dot_id,project_id,state,permission_mode,auto_resume FROM runs WHERE id=?')
      .get(runId);
    if (!run) throw Error('Execução não encontrada');
    const worktree = this.db
      .prepare('SELECT path,branch,removed_at FROM worktrees WHERE run_id=?')
      .get(runId) as { path: string; removed_at: number | null } | undefined;
    let fingerprint: string | null = null;
    if (worktree && !worktree.removed_at)
      try {
        fingerprint = worktreeFingerprint(worktree.path);
      } catch {
        // Worktree ilegível: o checkpoint é gravado sem fingerprint (null), como se não existisse.
      }
    const lastEvent = this.db
      .prepare('SELECT max(id) AS id FROM run_events WHERE run_id=?')
      .get(runId)?.id;
    const pending = this.db
      .prepare("SELECT id,kind,status FROM operations WHERE run_id=? AND status!='completed'")
      .all(runId);
    const lastConfirmed =
      this.db
        .prepare(
          "SELECT id,kind FROM operations WHERE run_id=? AND status='completed' ORDER BY updated_at DESC LIMIT 1",
        )
        .get(runId) ?? null;
    this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)').run(
      id,
      runId,
      Date.now(),
      origin,
      String(run.state),
      JSON.stringify({
        run,
        worktree,
        fingerprint,
        lastEvent,
        lastConfirmed,
        pending,
        output: 'PTY não persistido; referências de eventos apenas',
        cliSessionId: null,
      }),
    );
    // Bounded per-run retention; keep all manual checkpoints and 100 automatic records.
    this.db
      .prepare(
        "DELETE FROM checkpoints WHERE run_id=? AND origin!='manual' AND id NOT IN (SELECT id FROM checkpoints WHERE run_id=? AND origin!='manual' ORDER BY created_at DESC,rowid DESC LIMIT 100)",
      )
      .run(runId, runId);
    return this.db
      .prepare('SELECT id,created_at AS createdAt,origin,state FROM checkpoints WHERE id=?')
      .get(id);
  }
  checkpoints(runId: string) {
    return this.db
      .prepare(
        'SELECT id,created_at AS createdAt,origin,state FROM checkpoints WHERE run_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
      )
      .all(runId);
  }
  transition(runId: string, to: RunState, reason: string) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT state FROM runs WHERE id=?').get(runId) as
        | { state: RunState }
        | undefined;
      if (!row) throw Error('Execução não encontrada');
      if (row.state === to) return false;
      if (!edges[row.state].includes(to)) throw Error('Transição de execução não permitida');
      const changed = this.db
        .prepare('UPDATE runs SET state=? WHERE id=? AND state=?')
        .run(to, runId, row.state);
      if (Number(changed.changes) !== 1) throw Error('Transição concorrente');
      this.event(runId, `run.${to}`, { from: row.state, reason });
      this.checkpoint(runId, 'state');
      return true;
    });
  }
  begin(id: string, runId: string, kind: string) {
    const existing = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as
      | { run_id: string; kind: string; status: string }
      | undefined;
    if (existing) {
      if (existing.run_id !== runId || existing.kind !== kind)
        throw Error('Chave de operação reutilizada');
      return existing.status;
    }
    this.db
      .prepare("INSERT INTO operations VALUES(?,?,?,'pending',?,?)")
      .run(id, runId, kind, Date.now(), Date.now());
    return 'new';
  }
  complete(id: string) {
    this.db
      .prepare("UPDATE operations SET status='completed',updated_at=? WHERE id=?")
      .run(Date.now(), id);
  }
  recover() {
    this.transaction(() => {
      this.db.prepare("UPDATE operations SET status='uncertain' WHERE status='pending'").run();
      const runs = this.db
        .prepare(
          "SELECT id,state FROM runs WHERE state IN ('running','waiting_approval') OR id IN (SELECT run_id FROM operations WHERE status='uncertain')",
        )
        .all() as { id: string; state: RunState }[];
      for (const run of runs) {
        if (run.state === 'cancelled') continue;
        this.db
          .prepare(
            "UPDATE runs SET state='recovery_needed',error='Daemon interrompido; PTY indisponível e efeitos anteriores podem ser incertos' WHERE id=?",
          )
          .run(run.id);
        const session = this.db
          .prepare('SELECT identity_json FROM sessions WHERE run_id=?')
          .get(run.id) as { identity_json: string | null } | undefined;
        const identity = session?.identity_json ? JSON.parse(session.identity_json) : null;
        this.event(run.id, 'run.recovery_needed', {
          previousShutdown: this.previousShutdown,
          sameProcess: sameProcess(identity),
          survivingSession: survivingSession(identity),
        });
        this.checkpoint(run.id, 'recovery');
      }
      this.db.prepare("UPDATE sessions SET state='recovery_needed' WHERE state='running'").run();
    });
  }
  shutdown() {
    this.transaction(() => {
      for (const run of this.db
        .prepare("SELECT id FROM runs WHERE state NOT IN ('completed','failed','cancelled')")
        .all())
        this.checkpoint(String(run.id), 'shutdown');
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES('daemon.clean','true')").run();
    });
  }
}

import type { Continuity } from './continuity';
export type ContinuationCapabilities = {
  level: 1 | 2;
  structuredQuota: boolean;
  reliableReset: boolean;
  nativeResume: boolean;
  verified: boolean;
};
export const unavailableCapabilities: ContinuationCapabilities = {
  level: 1,
  structuredQuota: false,
  reliableReset: false,
  nativeResume: false,
  verified: false,
};
// Only trusted daemon adapters implement this interface. Never fed from PTY stdout or IPC.
export interface ContinuationAdapter {
  capabilities: ContinuationCapabilities;
  validate(runId: string, sessionId: string): Promise<boolean>;
  resume(
    runId: string,
    sessionId: string,
  ): Promise<'resumed' | 'temporary_error' | 'authentication_error'>;
}
export type QuotaSignal = { confirmed: true; sessionId: string; resetAt: number | null };
export class AutoResumeScheduler {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private closed = false;
  constructor(
    private c: Continuity,
    private adapterFor: (runId: string) => ContinuationAdapter | undefined,
    private enabled: (runId: string) => boolean,
    private fingerprint: (runId: string) => string | null,
    private notify: (runId: string, type: string) => void = () => {},
  ) {}
  start() {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 30_000);
    void this.tick();
  }
  stop() {
    this.closed = true;
    clearInterval(this.timer);
  }
  confirm(runId: string, signal: QuotaSignal) {
    const adapter = this.adapterFor(runId),
      cap = adapter?.capabilities;
    if (!cap?.verified || cap.level !== 2 || !cap.structuredQuota || !cap.nativeResume)
      throw Error('Auto Resume indisponível');
    if (
      !signal.sessionId ||
      signal.sessionId.length > 200 ||
      (signal.resetAt !== null &&
        (!cap.reliableReset || !Number.isSafeInteger(signal.resetAt) || signal.resetAt < 0))
    )
      throw Error('Sinal de limite inválido');
    const fingerprint = this.fingerprint(runId);
    if (!fingerprint) throw Error('Worktree indisponível');
    this.c.transaction(() => {
      this.c.transition(runId, 'waiting_quota', 'trusted adapter quota');
      this.c.db
        .prepare(
          `INSERT INTO resume_jobs(run_id,session_id,reset_at,due_at,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET session_id=excluded.session_id,reset_at=excluded.reset_at,due_at=excluded.due_at,status=excluded.status,fingerprint=excluded.fingerprint`,
        )
        .run(
          runId,
          signal.sessionId,
          signal.resetAt,
          signal.resetAt,
          signal.resetAt === null ? 'manual' : 'scheduled',
          fingerprint,
        );
      this.c.checkpoint(runId, 'quota');
    });
    this.notify(runId, 'quota.confirmed');
    if (signal.resetAt !== null && this.enabled(runId)) this.notify(runId, 'auto_resume.scheduled');
  }
  async tick(now = Date.now()) {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const jobs = this.c.db
        .prepare("SELECT * FROM resume_jobs WHERE status IN ('scheduled','attempting')")
        .all() as {
        run_id: string;
        session_id: string;
        status: string;
        due_at: number;
        attempts: number;
        fingerprint: string;
      }[];
      for (const job of jobs) {
        if (this.closed) return;
        const state = String(
          this.c.db.prepare('SELECT state FROM runs WHERE id=?').get(job.run_id)?.state,
        );
        if (state !== 'waiting_quota') {
          this.setStatus(job.run_id, 'cancelled');
          continue;
        }
        if (job.status === 'attempting') {
          this.setStatus(job.run_id, 'uncertain');
          this.c.transition(job.run_id, 'recovery_needed', 'crash during native resume');
          continue;
        }
        if (!this.enabled(job.run_id) || job.due_at > now) continue;
        if (job.attempts >= 3) {
          this.setStatus(job.run_id, 'exhausted');
          this.c.transition(job.run_id, 'recovery_needed', 'resume attempts exhausted');
          continue;
        }
        const adapter = this.adapterFor(job.run_id),
          cap = adapter?.capabilities;
        if (
          !cap?.verified ||
          cap.level !== 2 ||
          !cap.nativeResume ||
          !cap.structuredQuota ||
          !cap.reliableReset ||
          this.fingerprint(job.run_id) !== job.fingerprint
        ) {
          this.setStatus(job.run_id, 'blocked');
          this.c.transition(
            job.run_id,
            'recovery_needed',
            'session, worktree or capabilities changed',
          );
          continue;
        }
        let valid = false;
        try {
          valid = await adapter!.validate(job.run_id, job.session_id);
        } catch {}
        if (this.closed) return;
        // A cancellation or preference change during async validation always wins.
        if (
          String(this.c.db.prepare('SELECT state FROM runs WHERE id=?').get(job.run_id)?.state) !==
            'waiting_quota' ||
          !this.enabled(job.run_id)
        )
          continue;
        if (!valid) {
          this.setStatus(job.run_id, 'authentication_error');
          this.c.transition(job.run_id, 'recovery_needed', 'native session validation failed');
          this.notify(job.run_id, 'resume.failed');
          continue;
        }
        this.c.db
          .prepare(
            "UPDATE resume_jobs SET status='attempting',attempts=attempts+1 WHERE run_id=? AND status='scheduled'",
          )
          .run(job.run_id);
        this.c.checkpoint(job.run_id, 'before_native_resume');
        let result: 'resumed' | 'temporary_error' | 'authentication_error' | 'uncertain';
        try {
          result = await adapter!.resume(job.run_id, job.session_id);
        } catch {
          result = 'uncertain';
        }
        if (this.closed) return;
        if (
          String(this.c.db.prepare('SELECT state FROM runs WHERE id=?').get(job.run_id)?.state) !==
          'waiting_quota'
        ) {
          this.setStatus(job.run_id, 'cancelled');
          continue;
        }
        if (result === 'resumed') {
          this.setStatus(job.run_id, 'completed');
          this.c.transition(job.run_id, 'running', 'verified native resume');
          this.notify(job.run_id, 'run.resumed');
        } else if (result === 'temporary_error' && job.attempts < 2) {
          // Adapter guarantees no action began for this typed outcome. Exceptions are uncertain.
          this.c.db
            .prepare("UPDATE resume_jobs SET status='scheduled',due_at=? WHERE run_id=?")
            .run(now + Math.min(30 * 60_000, 60_000 * 2 ** job.attempts), job.run_id);
          this.c.event(job.run_id, 'resume.backoff', { attempt: job.attempts + 1 });
        } else {
          this.setStatus(job.run_id, result);
          this.c.transition(job.run_id, 'recovery_needed', 'native resume failed or uncertain');
          this.notify(job.run_id, 'resume.failed');
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private setStatus(runId: string, status: string) {
    this.c.db.prepare('UPDATE resume_jobs SET status=? WHERE run_id=?').run(status, runId);
  }
}

import { useMemo, useState } from 'react';
import type { Approval } from '../../../../../../packages/contracts/src';
import { AttentionDot } from '../../components/AttentionDot';
import { DotBadge } from '../../components/DotBadge';
import type { UiDot, UiRun, UiWorkspace, UiWorkspaceProject } from '../../lib/api';
import { decidePendingApproval } from '../attention/approvalActions';
import { RecoveryDialog } from '../continuity/RecoveryDialog';

type Item =
  | {
      kind: 'approval';
      key: string;
      sortAt: number;
      approval: Approval;
      dotName: string;
      title: string;
      meta: string[];
    }
  | {
      kind: 'recovery';
      key: string;
      sortAt: number;
      run: UiRun;
      dotName: string;
      title: string;
      meta: string[];
    };

function whenLabel(timestamp: number) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(elapsed / 3600000);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(timestamp),
  );
}

function projectContext(project: UiWorkspaceProject | undefined, workspaces: UiWorkspace[]) {
  const workspace = workspaces.find((item) => item.id === project?.workspaceId);
  return [workspace?.name, project?.name].filter((value): value is string => Boolean(value));
}

export function AttentionList({
  approvals,
  runs,
  dots,
  projects,
  workspaces,
  chatTitles,
  onOpenChat,
  onOpenSettings,
  reloadStatus,
}: {
  approvals: Approval[];
  runs: UiRun[];
  dots: UiDot[];
  projects: UiWorkspaceProject[];
  workspaces: UiWorkspace[];
  chatTitles: Record<string, string>;
  onOpenChat: (chatId: string) => void;
  onOpenSettings: () => void;
  reloadStatus: () => void;
}) {
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [recoveryRun, setRecoveryRun] = useState<UiRun>();
  const items = useMemo(() => {
    const next: Item[] = [];
    for (const approval of approvals) {
      if (approval.status !== 'pending') continue;
      const project = projects.find((item) => item.id === approval.projectId);
      const run = runs.find((item) => item.id === approval.runId);
      const dotName = dots.find((dot) => dot.id === approval.dotId)?.name ?? 'Dot';
      next.push({
        kind: 'approval',
        key: `approval:${approval.id}`,
        sortAt: approval.createdAt,
        approval,
        dotName,
        title: `${dotName} pede permissão para desfazer a run`,
        meta: [
          ...projectContext(project, workspaces),
          run?.branch,
          whenLabel(approval.createdAt),
        ].filter((value): value is string => Boolean(value)),
      });
    }
    for (const run of runs) {
      if (run.state !== 'recovery_needed') continue;
      const project = projects.find((item) => item.id === run.projectId);
      const title = run.chatId ? chatTitles[run.chatId] : undefined;
      const dotName = dots.find((dot) => dot.id === run.dotId)?.name ?? 'Dot';
      const timestamp = run.finishedAt ?? run.startedAt ?? run.createdAt;
      next.push({
        kind: 'recovery',
        key: `run:${run.id}`,
        sortAt: timestamp,
        run,
        dotName,
        title: title
          ? `${title} parou quando o app fechou`
          : `Run em ${project?.name ?? 'projeto'} parou quando o app fechou`,
        meta: [...projectContext(project, workspaces), run.branch, whenLabel(timestamp)].filter(
          (value): value is string => Boolean(value),
        ),
      });
    }
    return next.sort((left, right) => right.sortAt - left.sortAt);
  }, [approvals, chatTitles, dots, projects, runs, workspaces]);

  async function decide(approval: Approval, allow: boolean) {
    setBusyId(approval.id);
    setActionError('');
    try {
      if (await decidePendingApproval(approval.id, allow)) reloadStatus();
    } catch {
      setActionError(
        'Não foi possível aplicar a decisão. O pedido pode ter mudado; tente novamente.',
      );
    } finally {
      setBusyId('');
    }
  }

  if (!items.length) return null;
  return (
    <section className="kw-section" aria-labelledby="kw-attention-title">
      <header className="kw-section-heading kw-attention-heading">
        <h2 id="kw-attention-title">
          <span aria-hidden="true" title="Precisa de você">
            <AttentionDot />
          </span>
          <span>Precisa de você</span>
          <span className="kw-attention-count">{items.length}</span>
        </h2>
      </header>
      {actionError && (
        <p className="kw-attention-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="kw-attention-list">
        {items.map((item) => (
          <article className="kw-attention-item" key={item.key}>
            <DotBadge name={item.dotName} />
            <div className="kw-attention-copy">
              <p className="kw-attention-title">{item.title}</p>
              <p className="kw-attention-meta">{item.meta.join(' · ')}</p>
            </div>
            <div className="kw-attention-actions">
              {item.kind === 'approval' ? (
                <>
                  <button
                    type="button"
                    className="kw-attention-button is-secondary"
                    disabled={busyId === item.approval.id}
                    onClick={() => void decide(item.approval, false)}
                  >
                    Negar
                  </button>
                  <button
                    type="button"
                    className="kw-attention-button is-primary"
                    disabled={busyId === item.approval.id}
                    onClick={() => void decide(item.approval, true)}
                  >
                    Permitir
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="kw-attention-button is-secondary"
                    onClick={() =>
                      item.run.chatId ? onOpenChat(item.run.chatId) : onOpenSettings()
                    }
                  >
                    Ver o que mudou
                  </button>
                  <button
                    type="button"
                    className="kw-attention-button is-primary"
                    onClick={() => setRecoveryRun(item.run)}
                  >
                    Retomar
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <RecoveryDialog
        run={recoveryRun}
        onClose={() => setRecoveryRun(undefined)}
        onResumed={reloadStatus}
      />
    </section>
  );
}

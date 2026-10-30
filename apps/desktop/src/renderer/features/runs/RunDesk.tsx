import type { UiChatDetails } from '../../lib/api';
import { DiffView } from './DiffView';
import { DotLauncher } from './DotLauncher';
import { RollbackDialog } from './RollbackDialog';
import { RunHistory } from './RunHistory';
import { RunTerminals } from './RunTerminals';
import { useRunDesk } from './useRunDesk';

export { modeLabels } from './runShared';

export function RunDesk({
  chat,
  previousOnly = false,
}: {
  chat?: UiChatDetails['chat'];
  previousOnly?: boolean;
}) {
  const desk = useRunDesk(chat, previousOnly);
  return (
    <section className="run-desk" aria-labelledby="runs-title">
      <div className="desk-heading">
        <div>
          <div className="eyebrow">KARONT / EXECUÇÕES LOCAIS</div>
          <h2 id="runs-title">
            {chat
              ? 'Execuções desta conversa'
              : previousOnly
                ? 'Execuções anteriores'
                : 'Bancada de agentes'}
          </h2>
          <p>
            {chat
              ? 'A execução fica vinculada a esta conversa; o terminal continua ativo ao trocar de contexto.'
              : 'Dois dots em paralelo, cada um no próprio Git worktree.'}
          </p>
        </div>
        {!chat && (
          <label className="project-picker">
            Projeto Git{' '}
            <select
              aria-label="Projeto Git"
              value={desk.projectId}
              disabled={!desk.projects.length}
              onChange={(event) => desk.setProjectId(event.target.value)}
            >
              <option value="">Selecione</option>
              {desk.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {desk.connectionError && (
        <p className="desk-alert" role="alert">
          {desk.connectionError}
        </p>
      )}
      {desk.notice && (
        <p className="desk-notice" role="status">
          {desk.notice}
        </p>
      )}
      {desk.error && (
        <p className="desk-alert" role="alert">
          {desk.error}
        </p>
      )}
      {desk.loading ? (
        <p className="desk-empty">Carregando configuração local…</p>
      ) : (
        <>
          {!desk.projects.length || !desk.dots.length ? (
            <div className="desk-empty">
              <strong>Configure os primeiros dots</strong>
              <p>
                Crie <code>~/.config/karont/dots.json</code> a partir de{' '}
                <code>config/dots.example.json</code>, ajuste os diretórios e a CLI. O arquivo fica
                fora do repositório e não contém credenciais.
              </p>
            </div>
          ) : (
            <DotLauncher
              chat={chat}
              dots={desk.dots}
              modes={desk.modes}
              projects={desk.projects}
              projectId={desk.projectId}
              runs={desk.runs}
              selectedProject={desk.selectedProject}
              busy={desk.busy}
              activeCount={desk.activeCount}
              setModes={desk.setModes}
              start={desk.start}
            />
          )}
          <RunTerminals
            activeCount={desk.activeCount}
            dots={desk.dots}
            projects={desk.projects}
            queuedRuns={desk.queuedRuns}
            refreshRun={desk.refreshRun}
            terminalRuns={desk.terminalRuns}
          />
          <RunHistory
            dots={desk.dots}
            focusRun={desk.focusHistoryRun}
            onOpenDiff={desk.openDiff}
            projects={desk.projects}
            recent={desk.recent}
            refreshRun={desk.refreshRun}
            setShowHistory={desk.setShowHistory}
            showHistory={desk.showHistory}
          />
          {desk.diff && (
            <DiffView
              diff={desk.diff}
              onOpenDiff={desk.openDiff}
              onPreviewRollback={desk.previewRollback}
              onRemoveWorktree={desk.removeWorktree}
            />
          )}
        </>
      )}
      {desk.rollback && (
        <RollbackDialog
          busy={desk.busy}
          onApplyRollback={desk.applyRollback}
          rollback={desk.rollback}
          rollbackDialog={desk.rollbackDialog}
          setRollback={desk.setRollback}
        />
      )}
    </section>
  );
}

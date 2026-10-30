import type { PermissionMode } from '../../../../../../packages/contracts/src';
import type { UiChatDetails, UiDot, UiProject, UiRun, UiWorkspaceProject } from '../../lib/api';
import { modeLabels } from './runShared';

export function DotLauncher({
  chat,
  dots,
  modes,
  projects,
  projectId,
  runs,
  selectedProject,
  busy,
  activeCount,
  setModes,
  start,
}: {
  chat?: UiChatDetails['chat'];
  dots: UiDot[];
  modes: Record<string, PermissionMode>;
  projects: UiProject[];
  projectId: string;
  runs: UiRun[];
  selectedProject?: UiProject;
  busy: boolean;
  activeCount: number;
  setModes: React.Dispatch<React.SetStateAction<Record<string, PermissionMode>>>;
  start: (dot: UiDot) => void;
}) {
  return (
    <div className="dot-launchers" aria-label={chat ? 'Dot desta conversa' : 'Dots configurados'}>
      {(chat
        ? dots.filter((dot) =>
            chat.dotId
              ? dot.id === chat.dotId
              : (
                  (selectedProject as UiWorkspaceProject | undefined)?.dotIds ?? dot.projectIds
                ).includes(dot.id) || dot.projectIds.includes(chat.projectId ?? ''),
          )
        : dots
      ).map((dot) => (
        <article className="dot-launcher" key={dot.id}>
          <div className="dot-avatar" aria-hidden="true">
            {dot.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="dot-info">
            <strong>{dot.name}</strong>
            <p title={dot.role}>{dot.role}</p>
            <label>
              Permissão{' '}
              <select
                aria-label={`Permissão de ${dot.name}`}
                value={modes[dot.id] ?? 'ask'}
                onChange={(e) => setModes({ ...modes, [dot.id]: e.target.value as PermissionMode })}
              >
                {dot.capabilities.map((cap) => (
                  <option key={cap.mode} value={cap.mode} disabled={cap.status === 'unavailable'}>
                    {modeLabels[cap.mode]}
                    {cap.status === 'unavailable'
                      ? ' · indisponível'
                      : cap.status === 'partial'
                        ? ' · parcial'
                        : ''}
                  </option>
                ))}
              </select>
            </label>
            <small className="permission-detail">
              {dot.capabilities.find((cap) => cap.mode === (modes[dot.id] ?? 'ask'))?.detail}
            </small>
          </div>
          <button
            className="primary"
            disabled={
              busy ||
              !projectId ||
              !dot.projectIds.includes(projectId) ||
              (chat
                ? runs.some(
                    (run) =>
                      run.state !== 'completed' &&
                      run.state !== 'failed' &&
                      run.state !== 'cancelled',
                  )
                : false) ||
              dot.capabilities.find((cap) => cap.mode === (modes[dot.id] ?? 'ask'))?.status ===
                'unavailable'
            }
            onClick={() => void start(dot)}
          >
            {chat &&
            runs.some(
              (run) =>
                run.state !== 'completed' && run.state !== 'failed' && run.state !== 'cancelled',
            )
              ? 'Execução vinculada em andamento'
              : !dot.projectIds.includes(projectId)
                ? 'Sem acesso'
                : activeCount >= 2
                  ? 'Enfileirar dot'
                  : chat
                    ? 'Iniciar execução'
                    : 'Iniciar dot'}
          </button>
        </article>
      ))}
    </div>
  );
}

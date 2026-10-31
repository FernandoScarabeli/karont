import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowUp, ChevronDown, Folder, Plus } from 'lucide-react';
import type { UiWorkspace, UiWorkspaceProject } from '../../lib/api';

type Props = {
  variant: 'workspace' | 'all';
  projects: UiWorkspaceProject[];
  workspaces?: UiWorkspace[];
  currentWorkspaceId?: string | null;
  draft: string;
  setDraft: (draft: string) => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  newChat: (projectId: string | null, seed: string, workspaceId?: string | null) => Promise<void>;
  busy: boolean;
};

export function HomeComposer({
  variant,
  projects,
  workspaces = [],
  currentWorkspaceId,
  draft,
  setDraft,
  draftRef,
  newChat,
  busy,
}: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    currentWorkspaceId ?? workspaces[0]?.id ?? '',
  );
  const scopedProjects =
    variant === 'all'
      ? projects.filter((project) => project.workspaceId === selectedWorkspaceId)
      : projects;
  const projectId =
    scopedProjects.find((project) => project.id === selectedProjectId && project.available)?.id ??
    null;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedProject = scopedProjects.find((project) => project.id === projectId);
  const byteLength = new TextEncoder().encode(draft).byteLength;
  const tooLong = byteLength > 8000;

  useEffect(() => {
    if (
      selectedProjectId &&
      !scopedProjects.some((project) => project.id === selectedProjectId && project.available)
    )
      setSelectedProjectId('');
  }, [scopedProjects, selectedProjectId]);

  useEffect(() => {
    if (variant === 'all' && !workspaces.some((workspace) => workspace.id === selectedWorkspaceId))
      setSelectedWorkspaceId(currentWorkspaceId ?? workspaces[0]?.id ?? '');
  }, [currentWorkspaceId, selectedWorkspaceId, variant, workspaces]);

  function openDraft() {
    if (draft.trim())
      void newChat(projectId, draft, variant === 'all' ? selectedWorkspaceId || null : undefined);
  }

  const selectionValue = `${selectedWorkspaceId}::${projectId ?? ''}`;
  return (
    <form
      className={`kw-composer ${draft ? 'has-draft' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        openDraft();
      }}
    >
      <textarea
        ref={draftRef}
        aria-label="Nova ideia"
        placeholder="Vamos começar uma nova ideia?"
        value={draft}
        maxLength={8000}
        aria-invalid={tooLong}
        aria-describedby="kw-home-draft-limit"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            openDraft();
          }
        }}
      />
      <div className="kw-composer-actions">
        <div className="kw-composer-left">
          <button
            type="button"
            className="kw-add-context"
            title="Anexos ainda não disponíveis neste adaptador"
            aria-label="Adicionar contexto — em breve"
            disabled
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <div className={`kw-project-select ${variant === 'all' ? 'is-workspace-select' : ''}`}>
            <Folder size={14} aria-hidden="true" />
            {variant === 'all' ? (
              <>
                <span className="kw-project-select-value">
                  {selectedWorkspace?.name ?? 'Workspace indisponível'} /{' '}
                  {selectedProject?.name ?? 'Sem projeto'}
                </span>
                <select
                  aria-label="Workspace e projeto da nova conversa"
                  value={selectionValue}
                  disabled={!workspaces.length}
                  onChange={(event) => {
                    const [workspaceId, projectId] = event.target.value.split('::');
                    setSelectedWorkspaceId(workspaceId);
                    setSelectedProjectId(projectId ?? '');
                  }}
                >
                  {workspaces.map((workspace) => (
                    <optgroup label={workspace.name} key={workspace.id}>
                      <option value={`${workspace.id}::`}>Sem projeto</option>
                      {projects
                        .filter((project) => project.workspaceId === workspace.id)
                        .map((project) => (
                          <option
                            key={project.id}
                            value={`${workspace.id}::${project.id}`}
                            disabled={!project.available}
                          >
                            {project.name}
                            {project.available ? '' : ' (pasta indisponível)'}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </>
            ) : (
              <select
                aria-label="Projeto da nova conversa"
                value={projectId ?? ''}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                <option value="">Sem projeto</option>
                {scopedProjects.map((project) => (
                  <option key={project.id} value={project.id} disabled={!project.available}>
                    {project.name}
                    {project.available ? '' : ' (pasta indisponível)'}
                  </option>
                ))}
              </select>
            )}
            <ChevronDown size={14} aria-hidden="true" />
          </div>
        </div>
        <div className="kw-composer-right">
          <span className="kw-send-hint">
            <kbd>Enter</kbd>
            <span>para enviar</span>
          </span>
          <button
            type="submit"
            className="kw-send"
            title="Abrir conversa com este rascunho"
            aria-label="Abrir conversa com este rascunho"
            disabled={
              !draft.trim() || busy || tooLong || (variant === 'all' && !selectedWorkspaceId)
            }
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <span
        id="kw-home-draft-limit"
        className={tooLong ? 'kw-form-error' : 'kw-sr-only'}
        role="status"
      >
        {tooLong
          ? 'Limite de 8.000 bytes excedido. Reduza o texto para continuar.'
          : 'Limite de 8.000 bytes.'}
      </span>
    </form>
  );
}

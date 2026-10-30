import { Bot, ChevronUp, PanelsTopLeft, Pencil, Plus, Settings, UserRound } from 'lucide-react';
import type { useWorkspaceData } from './useWorkspaceData';
import type { useWorkspaceForm } from './useWorkspaceForm';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  workspaceForm: ReturnType<typeof useWorkspaceForm>;
};

export function SidebarFooter({ data, workspaceForm }: Props) {
  const { workspaces, workspace, home, navigation, setFormError, setPage } = data;
  const { workspaceMenu, setWorkspaceMenu, workspaceName, setWorkspaceName, setWorkspaceDialog } =
    workspaceForm;
  return (
    <footer className="k-sidebar-footer">
      <div className="k-workspace-select">
        <button
          className="k-nav"
          aria-expanded={workspaceMenu}
          onClick={() => setWorkspaceMenu(!workspaceMenu)}
        >
          <PanelsTopLeft />
          <span title={workspace?.name}>{workspace?.name ?? 'Workspace'}</span>
          <ChevronUp size={14} />
        </button>
        {workspaceMenu && (
          <div className="k-popover k-workspace-menu">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWorkspaceMenu(false);
                  void home(w.id);
                }}
              >
                {w.name}
                {w.id === navigation.workspaceId && <span>Atual</span>}
              </button>
            ))}
            <button
              onClick={() => {
                setWorkspaceMenu(false);
                setWorkspaceName('');
                setFormError('');
                setWorkspaceDialog('create');
              }}
            >
              <Plus size={16} />
              Criar workspace
            </button>
            {workspace && (
              <button
                onClick={() => {
                  setWorkspaceMenu(false);
                  setWorkspaceName(workspace.name);
                  setFormError('');
                  setWorkspaceDialog('rename');
                }}
              >
                <Pencil size={16} />
                Renomear workspace
              </button>
            )}
          </div>
        )}
      </div>
      <div className="k-profile">
        <span className="k-avatar">
          <UserRound size={15} />
        </span>
        <span>Perfil local</span>
        <button
          className="k-icon"
          title="Configurações e ferramentas"
          aria-label="Configurações e ferramentas"
          onClick={() => setPage('settings')}
        >
          <Settings />
        </button>
      </div>
      <div className="k-provider" title="A API local ainda não fornece limites de uso do provedor">
        <Bot size={14} />
        <span>Limites de uso indisponíveis</span>
      </div>
    </footer>
  );
}

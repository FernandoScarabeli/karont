import {
  Folder,
  FolderOpen,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  SquarePen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { UiChatSummary } from '../../lib/api';
import { LiveMoon } from '../../components/LiveMoon';
import type { useProjectForm } from './useProjectForm';
import type { useSidebarState } from './useSidebarState';
import type { useWorkspaceData } from './useWorkspaceData';
import { projectIcons } from './workspaceShared';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  sidebar: ReturnType<typeof useSidebarState>;
  projectForm: ReturnType<typeof useProjectForm>;
  runningChatIds: Set<string>;
};

export function Sidebar({ data, sidebar, projectForm, runningChatIds }: Props) {
  const {
    projects,
    chats,
    navigation,
    page,
    setPage,
    expanded,
    setExpanded,
    setFormError,
    workspace,
    openChat,
    newChat,
    busy,
    loading,
  } = data;
  const { query } = sidebar;
  const { setProjectDialog, setEditingProject, setProjectName, setProjectRoot, setProjectIcon } =
    projectForm;
  const matches = (title: string) => title.toLocaleLowerCase().includes(query.toLocaleLowerCase());

  function chatRows(items: UiChatSummary[]) {
    return items.map((chat) => (
      <button
        type="button"
        key={chat.id}
        className={`k-chat-row ${navigation.chatId === chat.id && page === 'chat' ? 'is-selected' : ''}`}
        aria-current={navigation.chatId === chat.id && page === 'chat' ? 'page' : undefined}
        title={chat.title}
        aria-description={runningChatIds.has(chat.id) ? 'Rodando' : undefined}
        onClick={() => void openChat(chat.id)}
      >
        <span className="k-chat-marker" aria-hidden="true" />
        <span className="ks-chat-name">{chat.title}</span>
        {runningChatIds.has(chat.id) && (
          <span className="ks-chat-status" title="Rodando" aria-hidden="true">
            <LiveMoon />
          </span>
        )}
      </button>
    ));
  }

  const favorites = chats.filter((chat) => chat.favorite);

  return (
    <aside className="k-sidebar ks-sidebar" aria-label="Navegação principal">
      <nav className="k-main-nav ks-sidebar-nav" aria-label="Áreas do workspace">
        <button
          type="button"
          className="k-nav k-new-chat"
          disabled={busy || loading}
          onClick={() => void newChat()}
        >
          <SquarePen aria-hidden="true" />
          Nova conversa
        </button>
        <button
          type="button"
          className={`k-nav ${page === 'tasks' ? 'is-selected' : ''}`}
          aria-current={page === 'tasks' ? 'page' : undefined}
          onClick={() => setPage('tasks')}
        >
          <ListTodo aria-hidden="true" />
          Tarefas
        </button>
      </nav>

      <div className="k-sidebar-scroll ks-sidebar-scroll">
        {favorites.length > 0 && (
          <section className="k-group">
            <div className="k-group-heading">
              <h2>Favoritos</h2>
            </div>
            {chatRows(favorites.filter((chat) => matches(chat.title)))}
          </section>
        )}

        <section className="k-group">
          <div className="k-group-heading">
            <h2>Projetos</h2>
            <button
              type="button"
              className="k-icon ks-group-action"
              disabled={!workspace}
              title="Criar projeto"
              aria-label="Criar projeto"
              onClick={() => {
                setFormError('');
                setEditingProject(undefined);
                setProjectName('');
                setProjectRoot('');
                setProjectIcon('folder');
                setProjectDialog(true);
              }}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          {projects
            .filter(
              (project) =>
                matches(project.name) ||
                chats.some((chat) => chat.projectId === project.id && matches(chat.title)),
            )
            .map((project) => {
              const isOpen = expanded[project.id] ?? false;
              const ProjectIcon =
                project.icon === 'folder'
                  ? isOpen
                    ? FolderOpen
                    : Folder
                  : (projectIcons[project.icon] ?? Folder);
              return (
                <div key={project.id} className="k-project">
                  <div className="k-project-line">
                    <button
                      type="button"
                      className="k-project-toggle"
                      id={`sidebar-project-${project.id}`}
                      aria-expanded={isOpen}
                      title={
                        project.available ? project.name : `${project.name} — pasta indisponível`
                      }
                      onClick={() => setExpanded((old) => ({ ...old, [project.id]: !isOpen }))}
                    >
                      <ProjectIcon aria-hidden="true" />
                      <span>{project.name}</span>
                      {isOpen ? (
                        <ChevronDown aria-hidden="true" />
                      ) : (
                        <ChevronRight aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="k-icon k-context-action ks-project-action"
                      title={`Nova conversa em ${project.name}`}
                      aria-label={`Nova conversa em ${project.name}`}
                      disabled={busy}
                      onClick={() => void newChat(project.id)}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                    <details className="k-project-menu">
                      <summary
                        className="k-icon k-context-action ks-project-action"
                        aria-label={`Menu de ${project.name}`}
                        title={`Menu de ${project.name}`}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </summary>
                      <div className="k-popover">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            void newChat(project.id);
                          }}
                        >
                          <SquarePen aria-hidden="true" />
                          Nova conversa
                        </button>
                        <button
                          type="button"
                          disabled={project.origin === 'config'}
                          title={
                            project.origin === 'config'
                              ? 'Gerenciado pelo arquivo de configuração local'
                              : 'Editar nome, ícone e pasta raiz'
                          }
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setEditingProject(project);
                            setProjectName(project.name);
                            setProjectRoot(project.root);
                            setProjectIcon(project.icon);
                            setFormError('');
                            setProjectDialog(true);
                          }}
                        >
                          <Settings aria-hidden="true" />
                          Configurações
                        </button>
                        <button
                          type="button"
                          disabled={project.origin === 'config'}
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setEditingProject(project);
                            setProjectName(project.name);
                            setProjectRoot(project.root);
                            setProjectIcon(project.icon);
                            setFormError('');
                            setProjectDialog(true);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Renomear projeto
                        </button>
                        {project.origin === 'config' && (
                          <span>Nome e pasta gerenciados pela configuração local.</span>
                        )}
                      </div>
                    </details>
                  </div>
                  {isOpen && (
                    <div className="k-project-chats">
                      {chatRows(
                        chats.filter(
                          (chat) => chat.projectId === project.id && matches(chat.title),
                        ),
                      )}
                      {!chats.some((chat) => chat.projectId === project.id) && (
                        <p className="k-empty">Nenhuma conversa ainda</p>
                      )}
                      {!project.available && (
                        <p className="k-empty k-warning">
                          Pasta indisponível · histórico preservado
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          {!projects.length && <p className="k-empty">Nenhum projeto ainda</p>}
        </section>

        <section className="k-group">
          <div className="k-group-heading">
            <h2>Conversas</h2>
            <button
              type="button"
              className="k-icon ks-group-action"
              title="Nova conversa livre"
              aria-label="Nova conversa livre"
              disabled={busy || loading}
              onClick={() => void newChat(null)}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          {chatRows(chats.filter((chat) => !chat.projectId && matches(chat.title)))}
          {!chats.some((chat) => !chat.projectId) && (
            <p className="k-empty">Nenhuma conversa ainda</p>
          )}
        </section>
        {query &&
          !projects.some((project) => matches(project.name)) &&
          !chats.some((chat) => matches(chat.title)) && (
            <p className="k-empty" role="status">
              Nenhum resultado para “{query}”.
            </p>
          )}
      </div>

      <SidebarFooter data={data} />
    </aside>
  );
}

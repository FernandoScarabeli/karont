import React from 'react';
import {
  Search,
  PanelLeftClose,
  SquarePen,
  ListTodo,
  Bot,
  Workflow,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  MoreHorizontal,
  Settings,
  UserRound,
  PanelsTopLeft,
  Folder,
  Pencil,
} from 'lucide-react';
import type { UiChatSummary } from '../../lib/api';
import type { useProjectForm } from './useProjectForm';
import type { useSidebarState } from './useSidebarState';
import type { useWorkspaceData } from './useWorkspaceData';
import type { useWorkspaceForm } from './useWorkspaceForm';
import { projectIcons } from './workspaceShared';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  sidebar: ReturnType<typeof useSidebarState>;
  projectForm: ReturnType<typeof useProjectForm>;
  workspaceForm: ReturnType<typeof useWorkspaceForm>;
};

export function Sidebar({ data, sidebar, projectForm, workspaceForm }: Props) {
  const {
    workspaces,
    dots,
    projects,
    chats,
    recentChats,
    navigation,
    page,
    setPage,
    expanded,
    setExpanded,
    setFormError,
    workspace,
    home,
    openChat,
    newChat,
    busy,
    loading,
  } = data;
  const { searchFocused, setSearchFocused, collapsed, setCollapsed, query, setQuery } = sidebar;
  const { workspaceMenu, setWorkspaceMenu, workspaceName, setWorkspaceName, setWorkspaceDialog } =
    workspaceForm;
  const { setProjectDialog, setEditingProject, setProjectName, setProjectRoot, setProjectIcon } =
    projectForm;
  const matches = (title: string) => title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  function chatRows(items: UiChatSummary[]) {
    return items.map((chat) => (
      <button
        key={chat.id}
        className={`k-chat-row ${navigation.chatId === chat.id && page === 'chat' ? 'is-selected' : ''}`}
        title={chat.title}
        onClick={() => void openChat(chat.id)}
      >
        <span className="k-chat-marker" />
        <span>{chat.title}</span>
      </button>
    ));
  }
  return (
    <>
      {!collapsed && (
        <aside className="k-sidebar" aria-label="Navegação principal">
          <div className="k-sidebar-top">
            <button
              className="k-logo"
              title="Início"
              aria-label="Início"
              onClick={() => void home()}
            >
              <img src="./assets/LuERS.png" alt="Karont" />
            </button>
            <label className="k-search">
              <Search size={16} />
              <input
                aria-label="Buscar projetos e conversas"
                placeholder="Buscar…"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              className="k-icon"
              title="Recolher sidebar"
              aria-label="Recolher sidebar"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose />
            </button>
          </div>
          <button
            className="k-nav k-new-chat"
            disabled={busy || loading}
            onClick={() => void newChat()}
          >
            <SquarePen />
            Nova conversa
          </button>
          <nav className="k-main-nav" aria-label="Áreas do workspace">
            {(
              [
                { id: 'tasks', label: 'ToDo', Icon: ListTodo },
                { id: 'agents', label: 'Agentes', Icon: Bot },
                { id: 'automations', label: 'Automações', Icon: Workflow },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`k-nav ${page === id ? 'is-selected' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setPage(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
          <div className="k-sidebar-scroll">
            {(searchFocused || query) && (
              <section className="k-group">
                <div className="k-group-heading">
                  <Search size={12} />
                  <h2>{query ? 'Resultados' : 'Recentes'} · todos os workspaces</h2>
                </div>
                {recentChats
                  .filter((c) => matches(c.title))
                  .slice(0, query ? undefined : 8)
                  .map((chat) => (
                    <button
                      className="k-search-result"
                      key={chat.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setQuery('');
                        setSearchFocused(false);
                        void openChat(chat.id);
                      }}
                    >
                      <span>{chat.title}</span>
                      <small>
                        {chat.origin.workspaceName ?? 'Global'} /{' '}
                        {chat.origin.projectName ?? 'Conversa livre'}
                      </small>
                    </button>
                  ))}
                {!recentChats.some((c) => matches(c.title)) && (
                  <p className="k-empty">Nenhuma conversa encontrada.</p>
                )}
              </section>
            )}
            <section className="k-group">
              <div className="k-group-heading">
                <ChevronDown />
                <h2>Favoritos</h2>
              </div>
              {chatRows(chats.filter((c) => c.favorite && matches(c.title)))}
              {!chats.some((c) => c.favorite && matches(c.title)) && (
                <p className="k-empty">Nenhuma conversa fixada</p>
              )}
            </section>
            <section className="k-group">
              <div className="k-group-heading">
                <ChevronDown />
                <h2>Projetos</h2>
                <button
                  className="k-icon"
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
                  <Plus />
                </button>
              </div>
              {projects
                .filter(
                  (p) =>
                    matches(p.name) || chats.some((c) => c.projectId === p.id && matches(c.title)),
                )
                .map((p) => {
                  const Icon = projectIcons[p.icon] ?? Folder;
                  const isOpen = expanded[p.id] ?? false;
                  return (
                    <div key={p.id} className="k-project">
                      <div className="k-project-line">
                        <button
                          className="k-project-toggle"
                          aria-expanded={isOpen}
                          title={p.available ? p.name : `${p.name} — pasta indisponível`}
                          onClick={() => setExpanded((old) => ({ ...old, [p.id]: !isOpen }))}
                        >
                          <Icon />
                          <span>{p.name}</span>
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                        <button
                          className="k-icon k-context-action"
                          title={`Nova conversa em ${p.name}`}
                          aria-label={`Nova conversa em ${p.name}`}
                          disabled={busy}
                          onClick={() => void newChat(p.id)}
                        >
                          <Plus />
                        </button>
                        <details className="k-project-menu">
                          <summary
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const popover = e.currentTarget
                                .nextElementSibling as HTMLElement | null;
                              if (popover)
                                popover.style.top = `${Math.max(16, Math.min(rect.bottom + 4, window.innerHeight - 200))}px`;
                            }}
                            className="k-icon k-context-action"
                            aria-label={`Menu de ${p.name}`}
                            title={`Menu de ${p.name}`}
                          >
                            <MoreHorizontal />
                          </summary>
                          <div className="k-popover">
                            <button
                              onClick={(e) => {
                                e.currentTarget.closest('details')?.removeAttribute('open');
                                void newChat(p.id);
                              }}
                            >
                              <SquarePen size={16} />
                              Nova conversa
                            </button>
                            <button
                              disabled={p.origin === 'config'}
                              title={
                                p.origin === 'config'
                                  ? 'Gerenciado pelo arquivo de configuração local'
                                  : 'Editar nome, ícone e pasta raiz'
                              }
                              onClick={(e) => {
                                e.currentTarget.closest('details')?.removeAttribute('open');
                                setEditingProject(p);
                                setProjectName(p.name);
                                setProjectRoot(p.root);
                                setProjectIcon(p.icon);
                                setFormError('');
                                setProjectDialog(true);
                              }}
                            >
                              <Settings size={16} />
                              Configurações
                            </button>
                            <button
                              disabled={p.origin === 'config'}
                              onClick={(e) => {
                                e.currentTarget.closest('details')?.removeAttribute('open');
                                setEditingProject(p);
                                setProjectName(p.name);
                                setProjectRoot(p.root);
                                setProjectIcon(p.icon);
                                setFormError('');
                                setProjectDialog(true);
                              }}
                            >
                              <Pencil size={16} />
                              Renomear projeto
                            </button>
                            {p.origin === 'config' && (
                              <span>Nome e pasta gerenciados pela configuração local.</span>
                            )}
                          </div>
                        </details>
                      </div>
                      {isOpen && (
                        <div className="k-project-chats">
                          {chatRows(chats.filter((c) => c.projectId === p.id && matches(c.title)))}
                          {!chats.some((c) => c.projectId === p.id) && (
                            <p className="k-empty">Nenhuma conversa ainda</p>
                          )}
                          {!p.available && (
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
                <ChevronDown />
                <h2>Conversas livres</h2>
                <button
                  className="k-icon"
                  title="Nova conversa livre"
                  aria-label="Nova conversa livre"
                  disabled={busy || loading}
                  onClick={() => void newChat(null)}
                >
                  <Plus />
                </button>
              </div>
              {chatRows(chats.filter((c) => !c.projectId && matches(c.title)))}
              {!chats.some((c) => !c.projectId) && (
                <p className="k-empty">Nenhuma conversa ainda</p>
              )}
            </section>
            {query &&
              !projects.some((p) => matches(p.name)) &&
              !chats.some((c) => matches(c.title)) && (
                <p className="k-empty" role="status">
                  Nenhum resultado para “{query}”.
                </p>
              )}
          </div>
          <SidebarFooter data={data} workspaceForm={workspaceForm} />
        </aside>
      )}
    </>
  );
}

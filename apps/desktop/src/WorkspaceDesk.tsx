import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  PanelLeftClose,
  PanelLeftOpen,
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
  CodeXml,
  Globe,
  Terminal,
  Layers,
  Briefcase,
  BookOpen,
  Rocket,
  ArrowUp,
  CornerDownLeft,
  Star,
  X,
  Copy,
  Pencil,
  Command,
} from 'lucide-react';
import { RunDesk } from './RunDesk';
import { Attention } from './Attention';
import { TaskDesk, TaskCreationDialog, type TaskSeed } from './TaskDesk';
import type {
  UiChatDetails,
  UiChatSummary,
  UiDelivery,
  UiDot,
  UiMessage,
  UiMovePreview,
  UiNavigation,
  UiRun,
  UiWorkspace,
  UiWorkspaceProject,
} from './api';
import type { TerminalEvent } from '../../../packages/contracts/src';
export type WorkspaceView = 'workspaces' | 'favorites' | 'recent' | 'free';
const projectIcons = {
  folder: Folder,
  'code-xml': CodeXml,
  globe: Globe,
  terminal: Terminal,
  layers: Layers,
  briefcase: Briefcase,
  'book-open': BookOpen,
  rocket: Rocket,
};
const iconLabels = [
  'Pasta',
  'Código',
  'Web',
  'Terminal',
  'Camadas',
  'Trabalho',
  'Livro',
  'Foguete',
];
const activeState = (state: string) => !['completed', 'failed', 'cancelled'].includes(state);
const emptyNavigation: UiNavigation = { workspaceId: null, projectId: null, chatId: null };
async function allPages<T>(
  fetch: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
export function WorkspaceDesk({ tools }: { view: WorkspaceView; tools?: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [dots, setDots] = useState<UiDot[]>([]);
  const [projects, setProjects] = useState<UiWorkspaceProject[]>([]);
  const [projectIndex, setProjectIndex] = useState<UiWorkspaceProject[]>([]);
  const [chats, setChats] = useState<UiChatSummary[]>([]);
  const [recentChats, setRecentChats] = useState<UiChatSummary[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [navigation, setNavigation] = useState<UiNavigation>(emptyNavigation);
  const [selectedChat, setSelectedChat] = useState<UiChatDetails>();
  const [page, setPage] = useState<
    'home' | 'chat' | 'tasks' | 'agents' | 'automations' | 'settings'
  >('home');
  const [loading, setLoading] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<'create' | 'rename'>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [projectDialog, setProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<UiWorkspaceProject>();
  const [projectName, setProjectName] = useState('');
  const [projectRoot, setProjectRoot] = useState('');
  const [projectIcon, setProjectIcon] = useState<UiWorkspaceProject['icon']>('folder');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => localStorage.getItem('karont.home-draft') ?? '');
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const opening = useRef(false);
  const selection = useRef(0);
  useEffect(() => {
    localStorage.setItem('karont.home-draft', draft);
  }, [draft]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      allPages((cursor) => window.karont.workspaces(cursor)),
      window.karont.dots(),
      window.karont.navigation(),
      allPages((cursor) => window.karont.projectIndex(cursor)),
    ])
      .then(async ([spaces, ds, nav, index]) => {
        if (!active) return;
        setWorkspaces(spaces);
        setDots(ds);
        setProjectIndex(index);
        const next =
          (nav.chatId && nav.workspaceId === null) || spaces.some((w) => w.id === nav.workspaceId)
            ? nav
            : { ...emptyNavigation, workspaceId: spaces[0]?.id ?? null };
        setNavigation(next);
        if (next.chatId) {
          const chat = await window.karont.chat(next.chatId);
          if (active) {
            setSelectedChat(chat);
            setPage('chat');
            setExpanded((old) => ({ ...old, [chat.chat.projectId ?? '']: true }));
          }
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível restaurar o workspace. Tente novamente.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [restoreAttempt]);
  useEffect(() => {
    let active = true;
    if (!navigation.workspaceId) {
      setProjects([]);
      setChats([]);
      return;
    }
    void Promise.all([
      allPages((cursor) => window.karont.projects(navigation.workspaceId!, cursor)),
      allPages((cursor) =>
        window.karont.chats({ scope: 'all', workspaceId: navigation.workspaceId!, cursor }),
      ),
      allPages((cursor) => window.karont.projectIndex(cursor)),
    ])
      .then(([ps, cs, index]) => {
        if (active) {
          setProjects(ps);
          setChats(cs);
          setProjectIndex(index);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Não foi possível atualizar projetos e conversas. Os dados carregados foram preservados.',
          );
      });
    return () => {
      active = false;
    };
  }, [navigation.workspaceId, refresh]);
  useEffect(() => {
    let active = true;
    void allPages((cursor) => window.karont.chats({ scope: 'recent', cursor }))
      .then((items) => {
        if (active) setRecentChats(items);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as conversas recentes. Tente novamente.');
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(
    () =>
      window.karont.onEvent((event: TerminalEvent) => {
        if (['project.updated', 'workspace.updated', 'chat.updated'].includes(event.type))
          setRefresh((n) => n + 1);
      }),
    [],
  );
  const workspace = workspaces.find((w) => w.id === navigation.workspaceId);
  async function context(next: UiNavigation) {
    await window.karont.setNavigation(next);
    setNavigation(next);
  }
  async function home(workspaceId = navigation.workspaceId) {
    selection.current++;
    setPage('home');
    setSelectedChat(undefined);
    setError('');
    try {
      await context({ workspaceId, projectId: null, chatId: null });
    } catch {
      setError('Não foi possível salvar a navegação. Tente novamente.');
    }
  }
  async function openChat(id: string) {
    const ticket = ++selection.current;
    try {
      const chat = await window.karont.openChat(id);
      if (ticket !== selection.current) return;
      setSelectedChat(chat);
      setNavigation({
        workspaceId: chat.chat.workspaceId,
        projectId: chat.chat.projectId,
        chatId: id,
      });
      setPage('chat');
      setError('');
      if (chat.chat.projectId) setExpanded((old) => ({ ...old, [chat.chat.projectId!]: true }));
      setRefresh((n) => n + 1);
    } catch {
      if (ticket === selection.current)
        setError('Não foi possível abrir a conversa. Tente novamente.');
    }
  }
  async function newChat(projectId: string | null = navigation.projectId, seed = '') {
    if (opening.current || busy || loading) return;
    if (new TextEncoder().encode(seed).byteLength > 8000) {
      setError('Limite de 8.000 bytes excedido. Reduza o texto para abrir a conversa.');
      return;
    }
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      let chat = await window.karont.createChat({
        workspaceId: navigation.workspaceId,
        projectId,
        dotId: null,
        title: 'Nova conversa',
      });
      if (seed) chat = await window.karont.saveDraft(chat.chat.id, seed, chat.chat.revision);
      setSelectedChat(chat);
      setNavigation({ workspaceId: chat.chat.workspaceId, projectId, chatId: chat.chat.id });
      await window.karont.openChat(chat.chat.id);
      setPage('chat');
      setRefresh((n) => n + 1);
      if (projectId) setExpanded((old) => ({ ...old, [projectId]: true }));
      if (seed) setDraft('');
    } catch {
      setError('Não foi possível criar a conversa. Seu texto foi preservado. Tente novamente.');
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }
  async function saveProject(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !navigation.workspaceId) return;
    setBusy(true);
    setFormError('');
    try {
      if (editingProject) {
        await window.karont.updateProject({
          projectId: editingProject.id,
          name: projectName,
          root: projectRoot,
          icon: projectIcon,
        });
        setProjectDialog(false);
        setEditingProject(undefined);
        setProjectName('');
        setProjectRoot('');
        setProjectIcon('folder');
        setRefresh((n) => n + 1);
        setNotice('Projeto atualizado.');
        return;
      }
      const result = await window.karont.addProject({
        workspaceId: navigation.workspaceId,
        name: projectName,
        icon: projectIcon,
        root: projectRoot,
        dotIds: [],
      });
      if ('cancelled' in result) return;
      setProjectDialog(false);
      setProjectName('');
      setProjectRoot('');
      setProjectIcon('folder');
      setRefresh((n) => n + 1);
      setExpanded((old) => ({ ...old, [result.project.id]: true }));
      if (result.project.workspaceId !== navigation.workspaceId)
        await home(result.project.workspaceId);
      setNotice(
        result.duplicate
          ? `Pasta já vinculada ao projeto “${result.project.name}”.`
          : `Projeto “${result.project.name}” criado.`,
      );
    } catch {
      setFormError(
        'Não foi possível criar o projeto. Confira se a pasta é a raiz de um repositório Git acessível com um commit e tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const result =
        workspaceDialog === 'rename' && navigation.workspaceId
          ? await window.karont.renameWorkspace(navigation.workspaceId, workspaceName)
          : await window.karont.createWorkspace(workspaceName);
      setWorkspaces((old) => [...old.filter((w) => w.id !== result.id), result]);
      setWorkspaceDialog(undefined);
      await home(result.id);
    } catch {
      setFormError('Não foi possível salvar o workspace. Confira o nome e tente novamente.');
    } finally {
      setBusy(false);
    }
  }
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
  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
  return (
    <div className={`karont-app ${collapsed ? 'sidebar-collapsed' : ''}`}>
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
            <div
              className="k-provider"
              title="A API local ainda não fornece limites de uso do provedor"
            >
              <Bot size={14} />
              <span>Limites de uso indisponíveis</span>
            </div>
          </footer>
        </aside>
      )}
      <main className="k-main">
        {collapsed && (
          <button
            className="k-icon k-show-sidebar"
            title="Mostrar sidebar"
            aria-label="Mostrar sidebar"
            onClick={() => setCollapsed(false)}
          >
            <PanelLeftOpen />
          </button>
        )}
        {error && (
          <div className="k-banner" role="alert">
            {error}
            <button
              onClick={() => {
                setError('');
                setRefresh((n) => n + 1);
                if (!workspace) setRestoreAttempt((n) => n + 1);
              }}
            >
              Tentar novamente
            </button>
            <button className="k-icon" aria-label="Fechar aviso" onClick={() => setError('')}>
              <X />
            </button>
          </div>
        )}
        {notice && (
          <div className="k-banner k-success" role="status">
            {notice}
            <button className="k-icon" aria-label="Fechar aviso" onClick={() => setNotice('')}>
              <X />
            </button>
          </div>
        )}
        {page === 'home' && (
          <section className="k-home">
            <div className="k-home-content">
              <h1>{loading ? 'Abrindo seu workspace…' : `${greeting}.`}</h1>
              <form
                className={`k-composer ${draft ? 'has-draft' : ''}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) void newChat(null, draft);
                }}
              >
                <textarea
                  ref={draftRef}
                  aria-label="Nova ideia"
                  placeholder="Vamos começar uma nova ideia?"
                  value={draft}
                  maxLength={8000}
                  aria-invalid={new TextEncoder().encode(draft).byteLength > 8000}
                  aria-describedby="home-draft-limit"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (draft.trim()) void newChat(null, draft);
                    }
                  }}
                />
                <div className="k-composer-actions">
                  <button
                    type="button"
                    className="k-icon"
                    title="Anexos ainda não disponíveis neste adaptador"
                    aria-label="Adicionar contexto — em breve"
                    disabled
                  >
                    <Plus />
                  </button>
                  <button
                    className="k-icon k-send"
                    title="Abrir conversa com este rascunho"
                    aria-label="Abrir conversa com este rascunho"
                    disabled={
                      !draft.trim() ||
                      busy ||
                      loading ||
                      new TextEncoder().encode(draft).byteLength > 8000
                    }
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
                <span
                  id="home-draft-limit"
                  className={
                    new TextEncoder().encode(draft).byteLength > 8000 ? 'k-form-error' : 'sr-only'
                  }
                  role="status"
                >
                  {new TextEncoder().encode(draft).byteLength > 8000
                    ? 'Limite de 8.000 bytes excedido. Reduza o texto para continuar.'
                    : 'Limite de 8.000 bytes.'}
                </span>
                {!draft && (
                  <div className="k-suggestions">
                    {['Explorar uma ideia', 'Planejar os próximos passos', 'Revisar um texto'].map(
                      (text) => (
                        <button
                          type="button"
                          key={text}
                          onClick={() => {
                            setDraft(text);
                            draftRef.current?.focus();
                          }}
                        >
                          <span>{text}</span>
                          <CornerDownLeft size={12} />
                        </button>
                      ),
                    )}
                  </div>
                )}
              </form>
            </div>
          </section>
        )}
        {page === 'chat' && selectedChat && (
          <ChatView
            key={selectedChat.chat.id}
            initial={selectedChat}
            dots={dots}
            projects={projectIndex}
            onClose={() => void home()}
            onChatChange={setSelectedChat}
            onMoveComplete={async (chat) => {
              setSelectedChat(chat);
              setNavigation({
                workspaceId: chat.chat.workspaceId,
                projectId: chat.chat.projectId,
                chatId: chat.chat.id,
              });
              setRefresh((n) => n + 1);
            }}
          />
        )}
        {page === 'tasks' && (
          <div className="k-page">
            <TaskDesk onOpenConversation={(id) => void openChat(id)} />
          </div>
        )}
        {page === 'agents' && (
          <div className="k-page">
            <header className="k-page-title">
              <h1>Agentes</h1>
              <p>Dots configurados no ambiente local.</p>
            </header>
            {dots.length ? (
              dots.map((dot) => (
                <article className="k-agent" key={dot.id}>
                  <span className="k-dot-identity">{dot.name.slice(0, 1)}</span>
                  <div>
                    <h2>{dot.name}</h2>
                    <p>{dot.role}</p>
                    <small>
                      {dot.projectIds.length} projetos configurados · {dot.capabilities.length}{' '}
                      modos de permissão
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <div className="k-page-empty">
                <Bot size={28} />
                <h2>Nenhum Dot configurado</h2>
                <p>Configure seus Dots nas ferramentas locais para iniciar execuções.</p>
              </div>
            )}
            <button className="quiet" onClick={() => setPage('settings')}>
              Abrir ferramentas locais
            </button>
          </div>
        )}
        {page === 'automations' && (
          <div className="k-page">
            <header className="k-page-title">
              <h1>Automações</h1>
            </header>
            <div className="k-page-empty">
              <Workflow size={28} />
              <h2>Um espaço para os próximos fluxos</h2>
              <p>Automações agendadas ainda estão em planejamento.</p>
            </div>
          </div>
        )}
        {page === 'settings' && (
          <div className="k-page k-settings">
            <header className="k-page-title">
              <h1>Configurações e ferramentas</h1>
              <p>Diagnóstico, execuções anteriores e laboratório local.</p>
            </header>
            {tools ?? <RunDesk />}
          </div>
        )}
      </main>
      <FormDialog
        open={projectDialog}
        title={editingProject ? 'Configurações do projeto' : 'Criar projeto'}
        onClose={() => {
          if (!busy) setProjectDialog(false);
        }}
      >
        <form onSubmit={(e) => void saveProject(e)}>
          <label>
            Nome
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="Nome do projeto"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </label>
          <fieldset className="k-icon-options">
            <legend>Ícone</legend>
            {Object.entries(projectIcons).map(([name, Icon], i) => (
              <button
                type="button"
                key={name}
                aria-pressed={projectIcon === name}
                title={iconLabels[i]}
                aria-label={iconLabels[i]}
                onClick={() => setProjectIcon(name as UiWorkspaceProject['icon'])}
              >
                <Icon size={18} />
              </button>
            ))}
          </fieldset>
          <label>
            Pasta raiz
            <div className="k-folder-field">
              <span title={projectRoot}>{projectRoot || 'Selecione uma pasta'}</span>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  void window.karont
                    .chooseProjectFolder()
                    .then((root) => {
                      if (root) setProjectRoot(root);
                    })
                    .catch(() =>
                      setFormError('Não foi possível abrir o seletor de pasta. Tente novamente.'),
                    );
                }}
              >
                Escolher…
              </button>
            </div>
          </label>
          {formError && (
            <p className="k-form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setProjectDialog(false)}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy || !projectName.trim() || !projectRoot}>
              {busy
                ? editingProject
                  ? 'Salvando…'
                  : 'Criando…'
                : editingProject
                  ? 'Salvar alterações'
                  : 'Criar projeto'}
            </button>
          </div>
        </form>
      </FormDialog>
      <FormDialog
        open={Boolean(workspaceDialog)}
        title={workspaceDialog === 'rename' ? 'Renomear workspace' : 'Criar workspace'}
        onClose={() => {
          if (!busy) setWorkspaceDialog(undefined);
        }}
      >
        <form onSubmit={(e) => void saveWorkspace(e)}>
          <label>
            Nome do workspace
            <input
              autoFocus
              required
              maxLength={120}
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </label>
          {formError && (
            <p role="alert" className="k-form-error">
              {formError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => setWorkspaceDialog(undefined)}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy || !workspaceName.trim()}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
function ChatView(props: {
  initial: UiChatDetails;
  dots: UiDot[];
  projects: UiWorkspaceProject[];
  onClose(): void;
  onChatChange(chat: UiChatDetails): void;
  onMoveComplete(chat: UiChatDetails): Promise<void>;
}) {
  const [chat, setChat] = useState(props.initial);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, UiDelivery[]>>({});
  const [runs, setRuns] = useState<UiRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState(props.initial.chat.draft);
  const [messageError, setMessageError] = useState('');
  const [saving, setSaving] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.initial.chat.title);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveProjects, setMoveProjects] = useState<UiWorkspaceProject[]>(props.projects);
  const [moveProjectId, setMoveProjectId] = useState('');
  const [moveDotId, setMoveDotId] = useState('');
  const [movePreview, setMovePreview] = useState<UiMovePreview>();
  const [moveError, setMoveError] = useState('');
  const [taskSeed, setTaskSeed] = useState<TaskSeed>();
  const [taskNotice, setTaskNotice] = useState('');
  const submittedKanbanCommand = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const composing = useRef(false);
  const revisionRef = useRef(chat.chat.revision);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftQueue = useRef(Promise.resolve());

  const acceptChat = useCallback(
    (value: UiChatDetails) => {
      setChat(value);
      revisionRef.current = value.chat.revision;
      draftRef.current = value.chat.draft;
      setDraft(value.chat.draft);
      setRenameTitle(value.chat.title);
      props.onChatChange(value);
    },
    [props.onChatChange],
  );

  const loadMessages = useCallback(async () => {
    const page = await window.karont.messages(chat.chat.id);
    setMessages(page.items);
    setNextCursor(page.nextCursor);
    setDeliveries(deliveriesByMessage(page.items, page.deliveries));
  }, [chat.chat.id]);

  const loadRuns = useCallback(async () => {
    const page = await window.karont.chatRuns(chat.chat.id);
    setRuns(page.items);
  }, [chat.chat.id]);

  useEffect(() => {
    let mounted = true;
    setMessages([]);
    setDeliveries({});
    setRuns([]);
    composerRef.current?.focus();
    setDraft(props.initial.chat.draft);
    draftRef.current = props.initial.chat.draft;
    revisionRef.current = props.initial.chat.revision;
    void Promise.all([
      window.karont.messages(props.initial.chat.id),
      window.karont.chatRuns(props.initial.chat.id),
    ])
      .then(async ([messagePage, runPage]) => {
        if (!mounted) return;
        setMessages(messagePage.items);
        setNextCursor(messagePage.nextCursor);
        setRuns(runPage.items);
        setDeliveries(deliveriesByMessage(messagePage.items, messagePage.deliveries));
      })
      .catch(() => {
        if (mounted) setMessageError('Não foi possível carregar o histórico local da conversa.');
      });
    const dispose = window.karont.onEvent((event: TerminalEvent) => {
      if (event.type === 'message.created' && event.chatId === props.initial.chat.id)
        void loadMessages().catch(() => {});
      if (event.type === 'message.delivery.updated' && event.chatId === props.initial.chat.id)
        void window.karont
          .messageDeliveries(event.chatId, event.messageId)
          .then((items) => setDeliveries((current) => ({ ...current, [event.messageId]: items })))
          .catch(() => {});
      if (event.type === 'run.updated' && event.run.chatId === props.initial.chat.id) {
        void loadRuns().catch(() => {});
        void draftQueue.current
          .catch(() => {})
          .then(() => window.karont.chat(props.initial.chat.id))
          .then((value) => {
            if (mounted && value.chat.revision > revisionRef.current) {
              revisionRef.current = value.chat.revision;
              setChat(value);
              props.onChatChange(value);
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      mounted = false;
      dispose();
      clearTimeout(draftTimer.current);
    };
  }, [props.initial.chat.id]);

  const persistDraft = useCallback(
    (value: string) => {
      clearTimeout(draftTimer.current);
      const task = draftQueue.current
        .catch(() => {})
        .then(async () => {
          if (value === chat.chat.draft && revisionRef.current === chat.chat.revision) return;
          const updated = await window.karont.saveDraft(chat.chat.id, value, revisionRef.current);
          setChat(updated);
          revisionRef.current = updated.chat.revision;
          props.onChatChange(updated);
          if (draftRef.current === value) setDraft(updated.chat.draft);
        });
      draftQueue.current = task;
      return task;
    },
    [acceptChat, chat.chat.draft, chat.chat.id, chat.chat.revision],
  );

  function editDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void persistDraft(value).catch(() =>
        setMessageError(
          'O rascunho não foi salvo. Mantenha esta conversa aberta e tente novamente.',
        ),
      );
    }, 350);
  }

  async function saveMessage(event: React.FormEvent) {
    event.preventDefault();
    if (
      !draft.trim() ||
      saving ||
      composing.current ||
      new TextEncoder().encode(draft).byteLength > 8000
    )
      return;
    const kanbanCommand = /^\/kanban(?:[ \t]+([\s\S]*))?$/.exec(draft);
    if (kanbanCommand) {
      if (!chat.chat.projectId) {
        setMessageError(
          'Vincule esta conversa a um projeto antes de criar uma tarefa. A prévia será aberta novamente depois da vinculação.',
        );
        void openMove();
        return;
      }
      submittedKanbanCommand.current = draft;
      setTaskNotice('');
      setTaskSeed({
        nonce: crypto.randomUUID(),
        projectId: chat.chat.projectId,
        title: kanbanCommand[1]?.trim() ?? '',
        description: '',
        originChatId: chat.chat.id,
        originMessageId: null,
        sourceLabel: `${chat.origin.workspaceName ?? 'Workspace'} / ${chat.origin.projectName ?? 'Projeto'} · ${chat.chat.title}`,
      });
      return;
    }
    const submittedDraft = draftRef.current;
    setSaving(true);
    setMessageError('');
    try {
      await persistDraft(submittedDraft);
      const result = await window.karont.saveMessage(
        chat.chat.id,
        submittedDraft,
        revisionRef.current,
      );
      acceptChat(result.chat);
      setMessages((current) =>
        current.some((item) => item.id === result.message.id)
          ? current
          : [...current, result.message],
      );
      setDeliveries((current) => ({ ...current, [result.message.id]: [] }));
    } catch {
      setMessageError(
        'Não foi possível salvar a mensagem. Verifique o limite de 8.000 bytes e tente novamente.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadNextMessages() {
    if (!nextCursor) return;
    try {
      const page = await window.karont.messages(chat.chat.id, nextCursor);
      setMessages((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((old) => old.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
      setDeliveries((current) => ({
        ...current,
        ...deliveriesByMessage(page.items, page.deliveries),
      }));
    } catch {
      setMessageError('Não foi possível carregar a próxima página do histórico.');
    }
  }

  function startTaskFromMessage(message: UiMessage) {
    if (!chat.chat.projectId) {
      setMessageError(
        'Vincule esta conversa a um projeto antes de criar uma tarefa a partir da mensagem.',
      );
      void openMove();
      return;
    }
    setMessageError('');
    setTaskNotice('');
    setTaskSeed({
      nonce: crypto.randomUUID(),
      projectId: chat.chat.projectId,
      title: message.body.trim().split(/\r?\n/, 1)[0]?.slice(0, 120) || 'Tarefa da mensagem',
      description: message.body,
      originChatId: chat.chat.id,
      originMessageId: message.id,
      sourceLabel: `${chat.origin.workspaceName ?? 'Workspace'} / ${chat.origin.projectName ?? 'Projeto'} · ${chat.chat.title}`,
    });
  }

  async function sendSavedMessage(message: UiMessage, reviewedUncertain = false) {
    const run = runs.find((item) => item.state === 'running' && item.sessionId);
    if (!run || saving) return;
    if (
      reviewedUncertain &&
      !window.confirm(
        'A tentativa anterior pode ter chegado ao terminal. Revise a saída antes de continuar; reenviar pode repetir a instrução.',
      )
    )
      return;
    setSaving(true);
    setMessageError('');
    try {
      const delivery = await window.karont.sendMessage({
        chatId: chat.chat.id,
        messageId: message.id,
        runId: run.id,
        reviewedUncertain,
      });
      setDeliveries((current) => ({
        ...current,
        [message.id]: [
          ...(current[message.id] ?? []).filter(
            (item) => item.operationId !== delivery.operationId,
          ),
          delivery,
        ],
      }));
    } catch {
      setMessageError(
        'A mensagem não foi enviada. Confira se esta conversa tem um terminal ativo e revise qualquer entrega incerta.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite() {
    try {
      acceptChat(
        await window.karont.favoriteChat(chat.chat.id, !chat.chat.favorite, revisionRef.current),
      );
    } catch {
      setMessageError('A conversa mudou em outro cliente. Reabra-a antes de continuar.');
    }
  }

  async function renameChat(event: React.FormEvent) {
    event.preventDefault();
    try {
      await persistDraft(draftRef.current);
      acceptChat(await window.karont.renameChat(chat.chat.id, renameTitle, revisionRef.current));
      setRenaming(false);
    } catch {
      setMessageError('Não foi possível renomear. Atualize a conversa e tente novamente.');
    }
  }

  async function openMove() {
    setMoveError('');
    try {
      const page = await window.karont.projectIndex();
      const destinations = page.items.filter((project) => project.id !== chat.chat.projectId);
      setMoveProjects(destinations);
      setMoveProjectId(destinations[0]?.id ?? '');
      setMoveDotId(chat.chat.dotId ?? '');
      setMovePreview(undefined);
      setMoveOpen(true);
    } catch {
      setMoveError('Não foi possível carregar os projetos de destino.');
    }
  }

  useEffect(() => {
    if (!moveOpen || !moveProjectId) return;
    const dotId = chat.chat.dotId ?? moveDotId;
    if (!dotId) {
      setMovePreview(undefined);
      return;
    }
    let mounted = true;
    void window.karont
      .previewMoveChat(chat.chat.id, moveProjectId, dotId)
      .then((preview) => {
        if (mounted) setMovePreview(preview);
      })
      .catch(() => {
        if (mounted) setMovePreview(undefined);
      });
    return () => {
      mounted = false;
    };
  }, [moveOpen, moveProjectId, moveDotId, chat.chat.id, chat.chat.dotId]);

  async function confirmMove() {
    if (!movePreview?.canMove || !movePreview.dotId) return;
    setMoveError('');
    try {
      await persistDraft(draftRef.current);
      const moved = await window.karont.moveChat(
        chat.chat.id,
        movePreview.destinationProjectId,
        movePreview.dotId,
        revisionRef.current,
      );
      acceptChat(moved);
      setMoveOpen(false);
      await props.onMoveComplete(moved);
    } catch {
      setMoveError(
        'A movimentação foi recusada. Atualize a prévia e confira a revisão da conversa.',
      );
    }
  }

  const activeRun = runs.find((run) => run.state === 'running' && run.sessionId);
  return (
    <section className="chat-workspace" aria-label={`Conversa ${chat.chat.title}`}>
      <header className="chat-heading">
        <div className="chat-heading-title">
          {renaming ? (
            <form className="rename-chat-form" onSubmit={(event) => void renameChat(event)}>
              <label className="sr-only" htmlFor={`rename-${chat.chat.id}`}>
                Título da conversa
              </label>
              <input
                id={`rename-${chat.chat.id}`}
                autoFocus
                maxLength={120}
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
              <button className="primary">Salvar</button>
              <button type="button" className="quiet" onClick={() => setRenaming(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <h2>{chat.chat.title}</h2>
          )}
          <p>
            {chat.origin.workspaceName ?? 'Global'}
            {chat.origin.projectName ? ` / ${chat.origin.projectName}` : ' / Conversa livre'}
            {chat.chat.dotId
              ? ` · ${props.dots.find((dot) => dot.id === chat.chat.dotId)?.name ?? chat.chat.dotId}`
              : ''}
          </p>
        </div>
        <div className="chat-heading-actions">
          <button
            className="k-icon"
            title={chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
            aria-label={chat.chat.favorite ? 'Remover favorito' : 'Favoritar conversa'}
            aria-pressed={chat.chat.favorite}
            onClick={() => void toggleFavorite()}
          >
            <Star size={16} fill={chat.chat.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className="k-icon"
            title="Renomear conversa"
            aria-label="Renomear conversa"
            onClick={() => setRenaming(true)}
          >
            <Pencil size={16} />
          </button>
          {!chat.chat.projectId && (
            <button
              className="k-icon"
              title="Vincular a projeto"
              aria-label="Vincular a projeto"
              onClick={() => void openMove()}
            >
              <Folder size={16} />
            </button>
          )}
          <button
            className="k-icon"
            title="Fechar conversa"
            aria-label="Fechar conversa"
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <section className="message-history" aria-label="Mensagens salvas">
        {messages.map((message) => {
          const attempts = deliveries[message.id] ?? [];
          const latest = attempts.at(-1);
          return (
            <article className="saved-message" key={message.id}>
              <div className="saved-message-meta">
                <strong>Você</strong>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <pre>{message.body}</pre>
              <div className="k-message-actions">
                <button
                  className="k-icon"
                  title="Copiar mensagem"
                  aria-label="Copiar mensagem"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(message.body)
                      .catch(() =>
                        setMessageError(
                          'Não foi possível copiar. Selecione o texto para copiar manualmente.',
                        ),
                      );
                  }}
                >
                  <Copy size={14} />
                </button>
                <button
                  className="k-icon"
                  title="Editar como nova mensagem"
                  aria-label="Editar como nova mensagem"
                  onClick={() => {
                    editDraft(message.body);
                    composerRef.current?.focus();
                  }}
                >
                  <Pencil size={14} />
                </button>
              </div>
              {latest?.status === 'sent' && (
                <p className="delivery-status">
                  Enviado ao terminal. Isso confirma a escrita, não o processamento pelo agente.
                </p>
              )}
              {latest?.status === 'pending' && (
                <p className="delivery-status">Tentativa de envio pendente.</p>
              )}
              {latest?.status === 'uncertain' && (
                <p className="delivery-uncertain">
                  Entrega incerta. Revise a saída do terminal antes de tentar novamente.
                </p>
              )}
              {chat.chat.projectId && (
                <button
                  className="quiet create-task-from-message"
                  onClick={() => startTaskFromMessage(message)}
                >
                  Criar tarefa a partir desta mensagem
                </button>
              )}
              {chat.chat.projectId && activeRun && latest?.status !== 'sent' && (
                <button
                  className="send-message-button"
                  disabled={saving}
                  onClick={() => void sendSavedMessage(message, latest?.status === 'uncertain')}
                >
                  {latest?.status === 'uncertain'
                    ? 'Revisar e tentar novamente'
                    : 'Enviar ao agente'}
                </button>
              )}
            </article>
          );
        })}
        {!messages.length && (
          <div className="message-empty">
            <h1>O que vamos construir?</h1>
            <p>
              {chat.chat.projectId
                ? `Esta conversa está no projeto ${chat.origin.projectName}.`
                : 'Uma nova ideia começa por aqui.'}
            </p>
          </div>
        )}
        {nextCursor && (
          <button className="quiet load-more" onClick={() => void loadNextMessages()}>
            Carregar próxima página do histórico
          </button>
        )}
      </section>
      <form className="message-composer" onSubmit={(event) => void saveMessage(event)}>
        <label className="sr-only" htmlFor={`draft-${chat.chat.id}`}>
          Nova mensagem
        </label>
        <textarea
          ref={composerRef}
          disabled={saving}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void saveMessage(event);
            }
          }}
          id={`draft-${chat.chat.id}`}
          maxLength={8000}
          value={draft}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(event) => editDraft(event.target.value)}
          onBlur={() => {
            void persistDraft(draftRef.current).catch(() => {});
          }}
          placeholder="Escreva sua mensagem…"
        />
        <div className="composer-footer">
          <button
            type="button"
            className="k-icon"
            title="Criar tarefa com /kanban"
            aria-label="Inserir comando criar tarefa"
            onClick={() => {
              editDraft('/kanban ');
              composerRef.current?.focus();
            }}
          >
            <Command size={16} />
          </button>
          <small>
            {new TextEncoder().encode(draft).byteLength > 8000
              ? 'Limite de 8.000 bytes excedido'
              : saving
                ? 'Salvando…'
                : 'Registro local · enviar ao terminal é uma ação separada'}
          </small>
          <button
            className="k-icon k-send"
            title="Salvar mensagem"
            aria-label="Salvar mensagem"
            disabled={!draft.trim() || new TextEncoder().encode(draft).byteLength > 8000 || saving}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
      {taskNotice && (
        <p className="desk-notice" role="status">
          {taskNotice}
        </p>
      )}
      <TaskCreationDialog
        key={taskSeed?.nonce ?? 'closed'}
        open={Boolean(taskSeed)}
        projects={props.projects}
        dots={props.dots}
        fixedProjectId={taskSeed?.projectId ?? undefined}
        seed={taskSeed}
        onClose={() => setTaskSeed(undefined)}
        onCreated={(task) => {
          setTaskSeed(undefined);
          setTaskNotice(`Tarefa “${task.title}” criada no projeto ${task.origin.projectName}.`);
          const submitted = submittedKanbanCommand.current;
          submittedKanbanCommand.current = null;
          if (submitted !== null && draftRef.current === submitted) editDraft('');
        }}
      />
      {chat.chat.projectId && (
        <details className="k-run-context" open={activeRun ? true : undefined}>
          <summary>
            <Terminal size={16} />
            Terminal e execuções<small>{activeRun ? 'Em execução' : 'Abrir ferramentas'}</small>
          </summary>
          <p className="history-note">
            As respostas e interações do Dot aparecem no terminal real. Salvar uma mensagem não
            inicia uma execução.
          </p>
          <Attention />
          <RunDesk chat={chat.chat} />
        </details>
      )}
      {messageError && (
        <p className="workspace-error" role="alert">
          {messageError}
        </p>
      )}

      <FormDialog
        open={moveOpen}
        title="Vincular conversa a projeto"
        onClose={() => setMoveOpen(false)}
      >
        <div className="move-preview-form">
          <dl className="move-facts">
            <div>
              <dt>Conversa</dt>
              <dd>{chat.chat.title}</dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>
                {chat.origin.workspaceName ?? 'Global'}
                {chat.origin.projectName ? ` / ${chat.origin.projectName}` : ' / Conversa livre'}
              </dd>
            </div>
          </dl>
          <label>
            Projeto de destino
            <select
              value={moveProjectId}
              onChange={(event) => setMoveProjectId(event.target.value)}
            >
              <option value="">Selecione um projeto</option>
              {moveProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {!chat.chat.dotId && (
            <label>
              Dot para esta conversa
              <select value={moveDotId} onChange={(event) => setMoveDotId(event.target.value)}>
                <option value="">Selecione um Dot autorizado</option>
                {moveProjects
                  .find((project) => project.id === moveProjectId)
                  ?.dotIds.map((dotId) => (
                    <option key={dotId} value={dotId}>
                      {props.dots.find((dot) => dot.id === dotId)?.name ?? dotId}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {chat.chat.dotId && (
            <p>
              Dot: {props.dots.find((dot) => dot.id === chat.chat.dotId)?.name ?? chat.chat.dotId}.
              A concessão será conferida no destino.
            </p>
          )}
          {movePreview && (
            <div className="move-preview-card">
              <p>
                <strong>Destino:</strong> {movePreview.destinationWorkspaceName} /{' '}
                {movePreview.destinationProjectName}
              </p>
              <p>
                <strong>Dot:</strong> {movePreview.dotName ?? 'nenhum'}
              </p>
              <p>
                {movePreview.canMove
                  ? 'O histórico, o ID e o favorito serão preservados. As mensagens antigas não serão enviadas.'
                  : movePreview.hasNonterminalRun
                    ? 'A conversa tem uma execução não terminal vinculada e não pode ser movida.'
                    : movePreview.authorized
                      ? 'Somente conversas livres podem ser movidas para projeto.'
                      : 'Este Dot não tem concessão para o projeto de destino.'}
              </p>
            </div>
          )}
          {moveError && (
            <p role="alert" className="workspace-error">
              {moveError}
            </p>
          )}
          <div className="dialog-actions">
            <button className="quiet" onClick={() => setMoveOpen(false)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={!movePreview?.canMove}
              onClick={() => void confirmMove()}
            >
              Confirmar movimentação
            </button>
          </div>
        </div>
      </FormDialog>
    </section>
  );
}

function deliveriesByMessage(messages: UiMessage[], deliveries: UiDelivery[]) {
  const result: Record<string, UiDelivery[]> = Object.fromEntries(
    messages.map((message) => [message.id, []]),
  );
  for (const delivery of deliveries) result[delivery.messageId]?.push(delivery);
  return result;
}

function FormDialog(props: {
  open: boolean;
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog"
      aria-label={props.title}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) props.onClose();
      }}
    >
      <div className="workspace-dialog-heading">
        <h2>{props.title}</h2>
        <button className="icon-button" aria-label="Fechar" onClick={props.onClose}>
          ×
        </button>
      </div>
      {props.children}
    </dialog>
  );
}

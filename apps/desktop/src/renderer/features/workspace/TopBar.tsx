import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { House, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import type { UiChatSummary, UiWorkspace } from '../../lib/api';
import { AttentionDot } from '../../components/AttentionDot';
import { LiveMoon } from '../../components/LiveMoon';
import type { useSidebarState } from './useSidebarState';
import type { useWorkspaceData } from './useWorkspaceData';
import type { useWorkspaceForm } from './useWorkspaceForm';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  sidebar: ReturnType<typeof useSidebarState>;
  workspaceForm: ReturnType<typeof useWorkspaceForm>;
  workspaceStatus: Record<string, { running: number; attention: number }>;
};

export function TopBar({ data, sidebar, workspaceForm, workspaceStatus }: Props) {
  const { workspaces, navigation, page, home, recentChats, openChat } = data;
  const { collapsed, setCollapsed, query, setQuery, searchFocused, setSearchFocused } = sidebar;
  const { setWorkspaceName, setWorkspaceTargetId, setWorkspaceDialog } = workspaceForm;
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const matches = (title: string) => title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const results = recentChats.filter((chat) => matches(chat.title)).slice(0, query ? undefined : 8);
  const orderedWorkspaces = [...workspaces].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!searchAreaRef.current?.contains(event.target as Node)) setSearchFocused(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape' && searchFocused) {
        event.preventDefault();
        setQuery('');
        setSearchFocused(false);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [searchFocused, setQuery, setSearchFocused]);

  function renameWorkspace(workspace: UiWorkspace) {
    setWorkspaceTargetId(workspace.id);
    setWorkspaceName(workspace.name);
    data.setFormError('');
    setWorkspaceDialog('rename');
  }

  function chooseResult(chat: UiChatSummary) {
    setQuery('');
    setSearchFocused(false);
    void openChat(chat.id);
  }

  return (
    <header className="ks-topbar">
      <div className="ks-brand">
        <img src="./assets/karont-lua.png" alt="" />
        <span>karont</span>
        <button
          className="ks-icon-button ks-sidebar-toggle"
          type="button"
          title={collapsed ? 'Mostrar sidebar' : 'Recolher sidebar'}
          aria-label={collapsed ? 'Mostrar sidebar' : 'Recolher sidebar'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>

      <div className="ks-tabs-area">
        <nav className="ks-workspace-tabs" aria-label="Workspaces">
          <button
            className={`ks-tab ks-home-tab ${page === 'home' && !navigation.workspaceId ? 'is-current' : ''}`}
            type="button"
            aria-label="Início"
            title="Início"
            aria-current={page === 'home' && !navigation.workspaceId ? 'page' : undefined}
            onClick={() => void home()}
          >
            <House aria-hidden="true" />
          </button>
          {orderedWorkspaces.map((workspace) => (
            <WorkspaceTab
              key={workspace.id}
              workspace={workspace}
              active={navigation.workspaceId === workspace.id}
              status={workspaceStatus[workspace.id] ?? { running: 0, attention: 0 }}
              onSelect={() => void home(workspace.id)}
              onRename={() => renameWorkspace(workspace)}
            />
          ))}
          <button
            className="ks-tab ks-create-workspace"
            type="button"
            aria-label="Criar workspace"
            title="Criar workspace"
            onClick={() => {
              setWorkspaceName('');
              data.setFormError('');
              setWorkspaceTargetId(undefined);
              setWorkspaceDialog('create');
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        </nav>
      </div>

      <div className="ks-search-area" ref={searchAreaRef}>
        <label className="ks-search">
          <Search aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label="Buscar projetos e conversas"
            aria-keyshortcuts="Control+K Meta+K"
            placeholder="Buscar"
            value={query}
            onFocus={() => setSearchFocused(true)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                resultRefs.current[0]?.focus();
              }
            }}
          />
          <span className="ks-search-shortcut" aria-hidden="true">
            Ctrl K
          </span>
        </label>
        {searchFocused && (
          <section className="ks-search-panel k-group" aria-label="Resultados da busca">
            <div className="ks-search-panel-heading k-group-heading">
              <Search aria-hidden="true" />
              <h2>{query ? 'Resultados' : 'Recentes'} · todos os workspaces</h2>
            </div>
            <div className="ks-search-results">
              {results.map((chat, index) => (
                <button
                  type="button"
                  className="k-search-result"
                  key={chat.id}
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  onClick={() => chooseResult(chat)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    const direction = event.key === 'ArrowDown' ? 1 : -1;
                    const next = (index + direction + results.length) % results.length;
                    resultRefs.current[next]?.focus();
                  }}
                >
                  <span>{chat.title}</span>
                  <small>
                    {chat.origin.workspaceName ?? 'Global'} /{' '}
                    {chat.origin.projectName ?? 'Conversa livre'}
                  </small>
                </button>
              ))}
              {!results.length && <p className="ks-search-empty">Nenhuma conversa encontrada.</p>}
            </div>
          </section>
        )}
      </div>
    </header>
  );
}

function WorkspaceTab({
  workspace,
  active,
  status,
  onSelect,
  onRename,
}: {
  workspace: UiWorkspace;
  active: boolean;
  status: { running: number; attention: number };
  onSelect: () => void;
  onRename: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const marker = status.running ? 'running' : status.attention ? 'attention' : undefined;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        wrapperRef.current?.querySelector<HTMLButtonElement>('.ks-tab')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    renameRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="ks-workspace-tab-wrap" ref={wrapperRef}>
      <button
        className={`ks-tab ks-workspace-tab ${active ? 'is-current' : ''}`}
        type="button"
        aria-label={workspace.name}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-current={active ? 'page' : undefined}
        title={workspace.name}
        aria-description={marker === 'running' ? 'Rodando' : marker ? 'Precisa de você' : undefined}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPosition({ left: rect.left, top: rect.bottom });
          setMenuOpen(true);
        }}
      >
        {marker && (
          <span
            className="ks-workspace-marker"
            aria-hidden="true"
            title={marker === 'running' ? 'Rodando' : 'Precisa de você'}
          >
            {marker === 'running' ? <LiveMoon /> : <AttentionDot />}
          </span>
        )}
        <span className="ks-workspace-name">{workspace.name}</span>
      </button>
      {menuOpen && (
        <div
          className="ks-workspace-context-menu"
          role="menu"
          aria-label={workspace.name}
          style={
            {
              '--ks-menu-left': `${menuPosition.left}px`,
              '--ks-menu-top': `${menuPosition.top}px`,
            } as CSSProperties
          }
        >
          <button
            ref={renameRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onRename();
            }}
          >
            Renomear workspace
          </button>
        </div>
      )}
    </div>
  );
}

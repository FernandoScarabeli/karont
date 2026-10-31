import { useEffect, useRef, useState } from 'react';
import type {
  UiChatDetails,
  UiChatSummary,
  UiDot,
  UiNavigation,
  UiWorkspace,
  UiWorkspaceProject,
} from '../../lib/api';
import type { TerminalEvent } from '../../../../../../packages/contracts/src';
import { allPages, emptyNavigation, overviewRequest } from './workspaceShared';

type WorkspacePage = 'start' | 'home' | 'chat' | 'tasks' | 'agents' | 'automations' | 'settings';

export function useWorkspaceData() {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [dots, setDots] = useState<UiDot[]>([]);
  const [projects, setProjects] = useState<UiWorkspaceProject[]>([]);
  const [projectIndex, setProjectIndex] = useState<UiWorkspaceProject[]>([]);
  const [chats, setChats] = useState<UiChatSummary[]>([]);
  const [recentChats, setRecentChats] = useState<UiChatSummary[]>([]);
  const [recentError, setRecentError] = useState('');
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentRequested, setRecentRequested] = useState(false);
  const [navigation, setNavigation] = useState<UiNavigation>(emptyNavigation);
  const [selectedChat, setSelectedChat] = useState<UiChatDetails>();
  const [page, setPage] = useState<WorkspacePage>('home');
  const [loading, setLoading] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [workspaceCatalogRefresh, setWorkspaceCatalogRefresh] = useState(0);
  const [projectCatalogRefresh, setProjectCatalogRefresh] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    if (page === 'start') {
      return () => {
        active = false;
      };
    }
    const workspaceId = navigation.workspaceId;
    if (!workspaceId) {
      setProjects([]);
      setChats([]);
      return;
    }
    void Promise.all([
      allPages(
        (cursor) => window.karont.projects(workspaceId, cursor),
        () => active,
      ),
      allPages(
        (cursor) => window.karont.chats({ scope: 'all', workspaceId, cursor }),
        () => active,
      ),
    ])
      .then(([ps, cs]) => {
        if (active) {
          setProjects(ps);
          setChats(cs);
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
  }, [navigation.workspaceId, page, refresh]);
  useEffect(() => {
    if (!workspaceCatalogRefresh) return;
    let active = true;
    void allPages(
      (cursor) =>
        overviewRequest(
          () => window.karont.workspaces(cursor),
          () => active,
        ),
      () => active,
    )
      .then((items) => {
        if (active) setWorkspaces(items);
      })
      .catch(() => {
        if (active) setError('Não foi possível atualizar a lista de workspaces.');
      });
    return () => {
      active = false;
    };
  }, [workspaceCatalogRefresh]);
  useEffect(() => {
    if (!projectCatalogRefresh) return;
    let active = true;
    void allPages(
      (cursor) =>
        overviewRequest(
          () => window.karont.projectIndex(cursor),
          () => active,
        ),
      () => active,
    )
      .then((items) => {
        if (active) setProjectIndex(items);
      })
      .catch(() => {
        if (active) setError('Não foi possível atualizar a lista de projetos.');
      });
    return () => {
      active = false;
    };
  }, [projectCatalogRefresh]);
  useEffect(() => {
    if (page !== 'start' && !recentRequested) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setRecentLoading(true);
      try {
        const items =
          page === 'start'
            ? (
                await overviewRequest(
                  () => window.karont.chats({ scope: 'recent', limit: 20 }),
                  () => active,
                )
              ).items
            : await allPages(
                (cursor) =>
                  overviewRequest(
                    () => window.karont.chats({ scope: 'recent', cursor }),
                    () => active,
                  ),
                () => active,
              );
        if (active) {
          setRecentChats(items);
          setRecentError('');
        }
      } catch {
        if (active) setRecentError('Não foi possível carregar as conversas recentes.');
      } finally {
        if (active) setRecentLoading(false);
      }
    };
    const unsubscribe = window.karont.onEvent((event: TerminalEvent) => {
      if (event.type !== 'chat.updated') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    });
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      setRecentLoading(false);
    };
  }, [page, recentRequested]);
  useEffect(
    () =>
      window.karont.onEvent((event: TerminalEvent) => {
        if (event.type === 'project.updated') setProjectCatalogRefresh((n) => n + 1);
        if (event.type === 'workspace.updated') setWorkspaceCatalogRefresh((n) => n + 1);
        if (
          ['project.updated', 'workspace.updated', 'chat.updated', 'task.updated'].includes(
            event.type,
          )
        )
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
  function start() {
    selection.current++;
    setRecentRequested(false);
    setPage('start');
    setSelectedChat(undefined);
    setError('');
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
      const projectId = chat.chat.projectId;
      if (projectId) setExpanded((old) => ({ ...old, [projectId]: true }));
      setRefresh((n) => n + 1);
    } catch {
      if (ticket === selection.current)
        setError('Não foi possível abrir a conversa. Tente novamente.');
    }
  }
  async function newChat(
    projectId: string | null = navigation.projectId,
    seed = '',
    workspaceId: string | null = navigation.workspaceId,
  ) {
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
        workspaceId,
        projectId,
        dotId: null,
        title: 'Nova conversa',
      });
      if (seed) chat = await window.karont.saveDraft(chat.chat.id, seed, chat.chat.revision);
      setSelectedChat(chat);
      setNavigation({
        workspaceId: chat.chat.workspaceId,
        projectId: chat.chat.projectId,
        chatId: chat.chat.id,
      });
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

  return {
    workspaces,
    setWorkspaces,
    dots,
    projects,
    projectIndex,
    chats,
    recentChats,
    recentError,
    recentLoading,
    setRecentRequested,
    navigation,
    setNavigation,
    selectedChat,
    setSelectedChat,
    page,
    setPage,
    loading,
    setRestoreAttempt,
    error,
    setError,
    notice,
    setNotice,
    refresh,
    setRefresh,
    expanded,
    setExpanded,
    formError,
    setFormError,
    busy,
    setBusy,
    draft,
    setDraft,
    draftRef,
    workspace,
    home,
    start,
    openChat,
    newChat,
  };
}

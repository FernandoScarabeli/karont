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
import { allPages, emptyNavigation } from './workspaceShared';

type WorkspacePage = 'home' | 'chat' | 'tasks' | 'agents' | 'automations' | 'settings';

export function useWorkspaceData() {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [dots, setDots] = useState<UiDot[]>([]);
  const [projects, setProjects] = useState<UiWorkspaceProject[]>([]);
  const [projectIndex, setProjectIndex] = useState<UiWorkspaceProject[]>([]);
  const [chats, setChats] = useState<UiChatSummary[]>([]);
  const [recentChats, setRecentChats] = useState<UiChatSummary[]>([]);
  const [navigation, setNavigation] = useState<UiNavigation>(emptyNavigation);
  const [selectedChat, setSelectedChat] = useState<UiChatDetails>();
  const [page, setPage] = useState<WorkspacePage>('home');
  const [loading, setLoading] = useState(true);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
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

  return {
    workspaces,
    setWorkspaces,
    dots,
    projects,
    projectIndex,
    chats,
    recentChats,
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
    openChat,
    newChat,
  };
}

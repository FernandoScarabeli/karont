import type { ReactNode } from 'react';
import { TaskDesk } from '../tasks/TaskDesk';
import { X } from 'lucide-react';
import { ChatView } from '../chat/ChatView';
import { HomeView } from './HomeView';
import { ProjectDialog } from './ProjectDialog';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { WorkspaceDialog } from './WorkspaceDialog';
import { WorkspacePages } from './WorkspacePages';
import { useProjectForm } from './useProjectForm';
import { useSidebarState } from './useSidebarState';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspaceForm } from './useWorkspaceForm';
import { useWorkspaceStatus } from './useWorkspaceStatus';

export type WorkspaceView = 'workspaces' | 'favorites' | 'recent' | 'free';

export function WorkspaceDesk({ tools }: { view: WorkspaceView; tools?: ReactNode }) {
  const data = useWorkspaceData();
  const sidebar = useSidebarState();
  const projectForm = useProjectForm(data);
  const workspaceForm = useWorkspaceForm(data);
  const status = useWorkspaceStatus(data.projectIndex);
  const {
    dots,
    projectIndex,
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
    setRefresh,
    busy,
    draft,
    setDraft,
    draftRef,
    workspace,
    home,
    openChat,
    newChat,
  } = data;
  const { collapsed } = sidebar;
  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
  return (
    <div className={`karont-app ks-shell ${collapsed ? 'is-sidebar-collapsed' : ''}`}>
      <TopBar
        data={data}
        sidebar={sidebar}
        workspaceForm={workspaceForm}
        workspaceStatus={status.workspaceStatus}
      />
      <div className={`ks-body ${collapsed ? 'is-sidebar-collapsed' : ''}`}>
        {!collapsed && (
          <Sidebar
            data={data}
            sidebar={sidebar}
            projectForm={projectForm}
            runningChatIds={status.runningChatIds}
          />
        )}
        <main className="k-main ks-page-frame">
          {error && (
            <div className="k-banner" role="alert">
              {error}
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setRefresh((n) => n + 1);
                  if (!workspace) setRestoreAttempt((n) => n + 1);
                }}
              >
                Tentar novamente
              </button>
              <button
                type="button"
                className="k-icon"
                aria-label="Fechar aviso"
                onClick={() => setError('')}
              >
                <X />
              </button>
            </div>
          )}
          {notice && (
            <div className="k-banner k-success" role="status">
              {notice}
              <button
                type="button"
                className="k-icon"
                aria-label="Fechar aviso"
                onClick={() => setNotice('')}
              >
                <X />
              </button>
            </div>
          )}
          <HomeView
            page={page}
            draft={draft}
            setDraft={setDraft}
            draftRef={draftRef}
            newChat={newChat}
            busy={busy}
            loading={loading}
            greeting={greeting}
          />
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
          <WorkspacePages page={page} dots={dots} setPage={setPage} tools={tools} />
        </main>
      </div>
      <ProjectDialog data={data} form={projectForm} />
      <WorkspaceDialog data={data} form={workspaceForm} />
    </div>
  );
}

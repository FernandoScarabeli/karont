import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { TaskCreationDialog, type TaskSeed } from '../tasks/TaskDesk';
import type { UiChatDetails, UiDot, UiMessage, UiWorkspaceProject } from '../../lib/api';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatMoveDialog } from './ChatMoveDialog';
import { ChatRunTools } from './ChatRunTools';
import { useChatDraft } from './useChatDraft';
import { useChatHistory } from './useChatHistory';
import { useChatMove } from './useChatMove';

type Props = {
  initial: UiChatDetails;
  dots: UiDot[];
  projects: UiWorkspaceProject[];
  onChatChange(chat: UiChatDetails): void;
  onMoveComplete(chat: UiChatDetails): Promise<void>;
};

export function ChatView(props: Props) {
  const [messageError, setMessageError] = useState('');
  const [saving, setSaving] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const runPanelRef = useRef<HTMLElement>(null);
  const runPanelButtonRef = useRef<HTMLButtonElement>(null);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.initial.chat.title);
  const [taskSeed, setTaskSeed] = useState<TaskSeed>();
  const [taskNotice, setTaskNotice] = useState('');
  const submittedKanbanCommand = useRef<string | null>(null);
  const draftState = useChatDraft({
    initial: props.initial,
    onChatChange: props.onChatChange,
    setRenameTitle,
    setMessageError,
  });
  const {
    chat,
    setChat,
    draft,
    draftRef,
    composing,
    revisionRef,
    acceptChat,
    persistDraft,
    editDraft,
  } = draftState;
  const history = useChatHistory({
    initial: props.initial,
    chat,
    setChat,
    onChatChange: props.onChatChange,
    draft: draftState,
    composerRef,
    setMessageError,
  });
  const { messages, setMessages, deliveries, setDeliveries, runs, nextCursor, loadNextMessages } =
    history;
  const move = useChatMove({
    chat,
    projects: props.projects,
    draft: draftState,
    onMoveComplete: props.onMoveComplete,
  });
  const {
    moveOpen,
    setMoveOpen,
    moveProjects,
    moveProjectId,
    setMoveProjectId,
    moveDotId,
    setMoveDotId,
    movePreview,
    moveError,
    openMove,
    confirmMove,
  } = move;

  async function saveMessage(event: FormEvent) {
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

  async function renameChat(event: FormEvent) {
    event.preventDefault();
    try {
      await persistDraft(draftRef.current);
      acceptChat(await window.karont.renameChat(chat.chat.id, renameTitle, revisionRef.current));
      setRenaming(false);
    } catch {
      setMessageError('Não foi possível renomear. Atualize a conversa e tente novamente.');
    }
  }

  const activeRun = runs.find((run) => run.state === 'running' && run.sessionId);
  const dotName = props.dots.find((dot) => dot.id === chat.chat.dotId)?.name;
  return (
    <section
      className={`chat-workspace kc-chat-layout${chat.chat.projectId ? '' : ' kc-chat-layout-free'}`}
      aria-label={`Conversa ${chat.chat.title}`}
    >
      <ChatHeader
        chat={chat}
        dotName={dotName}
        renaming={renaming}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renameChat={renameChat}
        setRenaming={setRenaming}
        toggleFavorite={toggleFavorite}
        openMove={openMove}
        runPanelOpen={runPanelOpen}
        onToggleRunPanel={() => setRunPanelOpen((open) => !open)}
        runPanelButtonRef={runPanelButtonRef}
      />

      <div className="kc-chat-conversation">
        <ChatMessages
          chat={chat}
          messages={messages}
          deliveries={deliveries}
          runs={runs}
          activeRun={activeRun}
          saving={saving}
          nextCursor={nextCursor}
          loadNextMessages={loadNextMessages}
          setMessageError={setMessageError}
          composerRef={composerRef}
          editDraft={editDraft}
          startTaskFromMessage={startTaskFromMessage}
          sendSavedMessage={sendSavedMessage}
        />
        <ChatComposer
          chatId={chat.chat.id}
          dotName={dotName}
          draft={draft}
          saving={saving}
          composerRef={composerRef}
          composing={composing}
          draftRef={draftRef}
          saveMessage={saveMessage}
          editDraft={editDraft}
          persistDraft={persistDraft}
        />
      </div>
      {taskNotice && (
        <p className="desk-notice kc-chat-status" role="status">
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
        <ChatRunTools
          chat={chat.chat}
          open={runPanelOpen}
          onClose={() => setRunPanelOpen(false)}
          panelRef={runPanelRef}
          triggerRef={runPanelButtonRef}
        />
      )}
      {messageError && (
        <p className="workspace-error" role="alert">
          {messageError}
        </p>
      )}

      <ChatMoveDialog
        open={moveOpen}
        chat={chat}
        dots={props.dots}
        moveProjects={moveProjects}
        moveProjectId={moveProjectId}
        setMoveProjectId={setMoveProjectId}
        moveDotId={moveDotId}
        setMoveDotId={setMoveDotId}
        movePreview={movePreview}
        moveError={moveError}
        setMoveOpen={setMoveOpen}
        confirmMove={confirmMove}
      />
    </section>
  );
}

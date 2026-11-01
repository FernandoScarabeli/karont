import type { Conversation, ConversationMessage, MessagePart } from "@karont/contract";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { Composer } from "../components/Composer/Composer.tsx";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import { summarizeAction } from "../conversation/actionSummary.ts";
import {
  AttachmentChips,
  AttachmentPicker,
  type PendingComposerAttachment,
} from "../conversation/ComposerAttachments.tsx";
import {
  type AgentEffort,
  type AgentModels,
  agentDisplayName,
  type ComposerPopoverName,
  ComposerPreferences,
} from "../conversation/ComposerPreferences.tsx";
import {
  ActionItem,
  MessageRow,
  type ResponseInput,
  TodosPart,
} from "../conversation/ConversationParts.tsx";
import conversationStyles from "../conversation/ConversationView.module.css";
import { formatFolderPath } from "../conversation/displayText.ts";
import { GitBranchLabel } from "../conversation/GitBranch.tsx";
import { WorkingIndicator } from "../conversation/WorkingIndicator.tsx";
import { t } from "../i18n/pt-BR.ts";
import sidebarStyles from "../shell/Sidebar.module.css";
import styles from "./ChatPreview.module.css";
import {
  actionStateExamples,
  composerAttachmentExamples,
  conversationStates,
  errorExamples,
  groupedReadMessage,
  longCommandAction,
  permissionExamples,
  planExamples,
  previewConversation,
  questionExamples,
  richResponse,
  shortResponse,
  streamingResponse,
  streamingResponseText,
  thinkingMessage,
  timelineMessage,
  todosPart,
  userExamples,
} from "./chatPreviewData.ts";

const noOp = () => undefined;
const noResponse = async (_response: ResponseInput) => undefined;
const initialStreamingText =
  streamingResponse.parts.find((part) => part.type === "text")?.markdown ?? "";

const sections = [
  ["chat-user", "Mensagem do usuário"],
  ["chat-responses", "Respostas"],
  ["chat-thinking", "Pensamento"],
  ["chat-actions", "Ações"],
  ["chat-permissions", "Permissões"],
  ["chat-questions", "Perguntas"],
  ["chat-plans", "Plano"],
  ["chat-todos", "Tarefas"],
  ["chat-errors", "Erros"],
  ["chat-error-models", "Erro — modelos"],
  ["chat-states", "Estado da conversa e linha do tempo"],
  ["chat-message-actions", "Ações da mensagem"],
] as const;

const actionTypeLabels: Record<(typeof actionStateExamples)[number]["actionType"], string> = {
  read: "Leitura",
  edit: "Edição",
  write: "Criação de arquivo",
  command: "Comando",
  search: "Busca local",
  web: "Busca na web",
  other: "Outra ação",
};

type ErrorModelDefinition = {
  id: string;
  title: string;
  description: string;
  variant: "inline" | "note" | "footer" | "toast";
  shortReason?: string;
};

const errorModelExamples: ErrorModelDefinition[] = [
  {
    id: "inline",
    title: "Modelo 1",
    description: "Sem cartão no fluxo.",
    variant: "inline",
  },
  {
    id: "note",
    title: "Modelo 2",
    description: "Nota em superfície neutra.",
    variant: "note",
  },
  {
    id: "footer",
    title: "Modelo 3",
    description: "Rodapé com nova tentativa.",
    variant: "footer",
  },
  {
    id: "toast",
    title: "Modelo 4",
    description: "Aviso compacto no fim.",
    variant: "toast",
    shortReason: "filtro de conteúdo",
  },
];

const interruptedResponse =
  "O Codex interrompeu a resposta: o filtro de conteúdo do provedor bloqueou o texto. Tente reformular o pedido.";
const rawProviderError =
  "provider_error: content_filter\ncompletion_status: blocked\nmessage: The provider's content filter blocked the generated response.";

type ErrorModelVariant = ErrorModelDefinition["variant"];

function ErrorModelState({
  initiallyOpen,
  shortReason,
  variant,
}: {
  initiallyOpen: boolean;
  shortReason?: string;
  variant: ErrorModelVariant;
}) {
  const [detailsOpen, setDetailsOpen] = useState(initiallyOpen);
  const [retryNotice, setRetryNotice] = useState(false);
  const detailsId = useId();
  const stateLabel = initiallyOpen ? "Detalhes abertos" : "Fechado";
  const alertRole = initiallyOpen ? "group" : "alert";

  const detailsToggle = (
    <button
      aria-controls={detailsId}
      aria-expanded={detailsOpen}
      className={styles.errorModelDetailsAction}
      onClick={() => setDetailsOpen((open) => !open)}
      type="button"
    >
      {detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}
    </button>
  );

  const rawDetails = (
    <pre className={styles.errorModelDetails} hidden={!detailsOpen} id={detailsId}>
      {rawProviderError}
    </pre>
  );

  const toastDetailsToggle = (
    <button
      aria-controls={detailsId}
      aria-expanded={detailsOpen}
      aria-label={detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}
      className={styles.errorToastIconButton}
      onClick={() => setDetailsOpen((open) => !open)}
      title={detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}
      type="button"
    >
      <ChevronDown
        aria-hidden="true"
        className={detailsOpen ? styles.errorToastChevronOpen : undefined}
        size={16}
        strokeWidth={1.8}
      />
    </button>
  );

  const toastRetryButton = (
    <button
      aria-label="Tentar de novo"
      className={styles.errorToastIconButton}
      onClick={() => setRetryNotice(true)}
      title="Tentar de novo"
      type="button"
    >
      <RotateCcw aria-hidden="true" size={16} strokeWidth={1.8} />
    </button>
  );

  const retryButton = (
    <button
      className={
        variant === "inline"
          ? styles.errorModelDetailsAction
          : variant === "footer"
            ? `${styles.errorModelRetryAction} ${styles.errorModelPrimaryRetry}`
            : styles.errorModelRetryAction
      }
      onClick={() => setRetryNotice(true)}
      type="button"
    >
      Tentar de novo
    </button>
  );

  const controls = (
    <div className={styles.errorModelActions}>
      {detailsToggle}
      {retryButton}
    </div>
  );
  const inlineControls = (
    <span className={styles.errorInlineActions}>
      {detailsToggle}
      {retryButton}
    </span>
  );

  const errorAttributes = {
    "aria-label": `Erro do Codex: resposta interrompida, estado ${stateLabel.toLocaleLowerCase("pt-BR")}`,
    role: alertRole,
  } as const;

  return (
    <div className={styles.errorModelState}>
      <p className={styles.errorModelStateLabel}>{stateLabel}</p>

      {variant === "inline" ? (
        <div {...errorAttributes} className={styles.errorInline}>
          <p className={styles.errorInlineMessage}>
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{interruptedResponse}</span>
            {inlineControls}
          </p>
          {rawDetails}
        </div>
      ) : null}

      {variant === "note" ? (
        <div {...errorAttributes} className={styles.errorNote}>
          <div className={styles.errorModelHeading}>
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>Resposta interrompida</span>
          </div>
          <p className={styles.errorModelMessage}>{interruptedResponse}</p>
          {controls}
          {rawDetails}
        </div>
      ) : null}

      {variant === "footer" ? (
        <div {...errorAttributes} className={styles.errorFooter}>
          <div className={styles.errorFooterHeading}>
            <div className={styles.errorModelHeading}>
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>Resposta interrompida</span>
            </div>
            {controls}
          </div>
          <p className={styles.errorModelMessage}>{interruptedResponse}</p>
          {rawDetails}
        </div>
      ) : null}

      {variant === "toast" ? (
        <>
          <div {...errorAttributes} className={styles.errorToast}>
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
            <span className={styles.errorToastTitle}>Resposta interrompida</span>
            <span aria-hidden="true" className={styles.errorToastSeparator}>
              ·
            </span>
            <span className={styles.errorToastReason} title={shortReason}>
              {shortReason}
            </span>
            {toastDetailsToggle}
            {toastRetryButton}
          </div>
          <div className={styles.errorToastDetails} hidden={!detailsOpen} id={detailsId}>
            <p className={styles.errorModelMessage}>{interruptedResponse}</p>
            <pre className={styles.errorModelDetails}>{rawProviderError}</pre>
          </div>
        </>
      ) : null}

      {retryNotice ? (
        <p className={styles.errorModelFeedback} role="status">
          Prévia: nenhuma nova solicitação foi enviada.
        </p>
      ) : null}
    </div>
  );
}

function ErrorModelExample({
  description,
  shortReason,
  title,
  variant,
}: {
  description: string;
  shortReason?: string;
  title: string;
  variant: ErrorModelVariant;
}) {
  return (
    <article className={styles.errorModel}>
      <header className={styles.errorModelHeader}>
        <h3>
          {title} — {description}
        </h3>
      </header>

      <p className={styles.interruptedExcerpt}>
        A validação separa imagens de arquivos de texto e recusa formatos que não fazem parte do
        contrato.
      </p>

      <div className={styles.errorModelStates}>
        <ErrorModelState initiallyOpen={false} shortReason={shortReason} variant={variant} />
        <ErrorModelState initiallyOpen={true} shortReason={shortReason} variant={variant} />
      </div>
    </article>
  );
}

const actionStateLabels: Record<Extract<MessagePart, { type: "action" }>["state"], string> = {
  running: "Em andamento",
  waiting: "Precisa de você",
  ok: "Concluída",
  error: "Falhou",
};

const errorTypeLabels: Record<Extract<MessagePart, { type: "error" }>["errorType"], string> = {
  "cli-not-found": "CLI não encontrada",
  "not-logged-in": "CLI sem login",
  failed: "Falha durante a resposta",
  interrupted: "Mensagem interrompida",
};

const models: AgentModels = {
  agent: "codex",
  models: [
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6-Luna",
      efforts: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
    },
    { id: "gpt-5.6", name: "GPT-5.6", efforts: ["low", "medium", "high", "xhigh"] },
  ],
  efforts: ["low", "medium", "high", "xhigh"],
};

function PreviewSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} id={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionContent}>{children}</div>
    </section>
  );
}

function ExampleLabel({ children }: { children: ReactNode }) {
  return <p className={styles.exampleLabel}>{children}</p>;
}

function DemoMessage({
  message,
  openPartId,
}: {
  message: ConversationMessage;
  openPartId?: string;
}) {
  const messageRef = useRef<HTMLDivElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!openPartId) return;
    const part = Array.from(
      messageRef.current?.querySelectorAll<HTMLElement>("[data-part-id]") ?? [],
    ).find((element) => element.dataset.partId === openPartId);
    part?.querySelector<HTMLElement>("details > summary")?.click();
  }, [openPartId]);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && messageRef.current?.contains(event.target)) return;
      setActionsOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActionsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsOpen]);

  return (
    <div ref={messageRef}>
      <MessageRow
        cwd={previewConversation.cwd}
        isActionsOpen={actionsOpen}
        message={message}
        onAnnounce={noOp}
        onCopy={noOp}
        onCopyCode={noOp}
        onEdit={noOp}
        onResend={noOp}
        onRespond={noResponse}
        onRetry={noOp}
        onToggleActions={() => setActionsOpen((open) => !open)}
      />
    </div>
  );
}

function ConversationStateSample({ conversation }: { conversation: Conversation }) {
  const stateClass =
    conversation.state === "working"
      ? sidebarStyles.conversationStatusWorking
      : conversation.state === "waiting"
        ? sidebarStyles.conversationStatusNeedsYou
        : conversation.state === "error"
          ? sidebarStyles.conversationStatusError
          : "";
  const label =
    conversation.state === "working"
      ? t.chat.working
      : conversation.state === "waiting"
        ? t.chat.waiting
        : conversation.state === "error"
          ? t.shell.conversationError
          : t.chat.idle;

  return (
    <div className={styles.conversationState}>
      <span aria-hidden="true" className={`${sidebarStyles.conversationStatusDot} ${stateClass}`} />
      <span>{label}</span>
    </div>
  );
}

export function ChatPreview() {
  const [streamingText, setStreamingText] = useState(initialStreamingText);
  const [draft, setDraft] = useState("");
  const [activePopover, setActivePopover] = useState<ComposerPopoverName>(null);
  const [model, setModel] = useState("gpt-5.6-luna");
  const [effort, setEffort] = useState<AgentEffort | "">("medium");
  const [mode, setMode] = useState<Conversation["mode"]>("edit");
  const [planMode, setPlanMode] = useState(false);
  const [attachments, setAttachments] = useState<PendingComposerAttachment[]>(
    composerAttachmentExamples,
  );
  const [note, setNote] = useState("");

  useEffect(() => {
    let visibleLength = initialStreamingText.length;
    const timer = window.setInterval(() => {
      visibleLength = Math.min(visibleLength + 8, streamingResponseText.length);
      setStreamingText(streamingResponseText.slice(0, visibleLength));
      if (visibleLength === streamingResponseText.length) window.clearInterval(timer);
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  const streamingMessage: ConversationMessage = {
    ...streamingResponse,
    parts: streamingResponse.parts.map((part) =>
      part.type === "text" ? { ...part, markdown: streamingText } : part,
    ),
  };

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function onFilePick(files: File[]) {
    setNote(files.length ? "Seleção local demonstrada; nenhum arquivo foi enviado." : "");
  }

  function submitDraft() {
    setNote("Envio demonstrativo: nenhuma solicitação foi enviada.");
  }

  return (
    <section aria-label="Vitrine de conversa" className={conversationStyles.page}>
      <header className={`${conversationStyles.header} ${styles.header}`}>
        <h1 className={styles.pageTitle}>Vitrine de conversa</h1>
        <p className={styles.devNotice}>Tela de desenvolvimento · dados de exemplo</p>
      </header>

      <main
        aria-label="Exemplos dos estados da conversa"
        className={`${conversationStyles.messageList} ${scrollAreaStyles.scrollArea} ${styles.messageList}`}
      >
        <div className={styles.content}>
          <nav aria-label="Índice das seções" className={styles.index}>
            {sections.map(([id, label]) => (
              <a href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
          </nav>

          <PreviewSection id="chat-user" title="Mensagem do usuário">
            <ExampleLabel>Curta</ExampleLabel>
            <DemoMessage message={userExamples.short} />
            <ExampleLabel>Longa, com várias linhas</ExampleLabel>
            <DemoMessage message={userExamples.long} />
            <ExampleLabel>Com anexo de imagem e arquivo de texto</ExampleLabel>
            <DemoMessage message={userExamples.attachments} />
          </PreviewSection>

          <PreviewSection id="chat-responses" title="Respostas">
            <ExampleLabel>
              Markdown rico: títulos, lista, negrito, link, citação, tabela e código
            </ExampleLabel>
            <DemoMessage message={richResponse} />
            <ExampleLabel>Curta</ExampleLabel>
            <DemoMessage message={shortResponse} />
            <ExampleLabel>Streaming: o texto avança localmente</ExampleLabel>
            <DemoMessage message={streamingMessage} />
          </PreviewSection>

          <PreviewSection id="chat-thinking" title="Pensamento">
            <DemoMessage message={thinkingMessage} />
          </PreviewSection>

          <PreviewSection id="chat-actions" title="Ações">
            <ExampleLabel>Tipos de ação e estados do contrato</ExampleLabel>
            <div className={styles.actionExamples}>
              {actionStateExamples.map(({ actionType, actions }) => (
                <div className={styles.actionType} key={actionType}>
                  <h3 className={styles.subheading}>{actionTypeLabels[actionType]}</h3>
                  {actions.map((action) => (
                    <div className={styles.actionState} key={action.id}>
                      <span>{actionStateLabels[action.state]}</span>
                      <ActionItem
                        action={action}
                        cwd={previewConversation.cwd}
                        messageId={`message-${action.id}`}
                        permitted={false}
                        summary={summarizeAction(action, previewConversation.cwd)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <ExampleLabel>Grupo resumido</ExampleLabel>
            <DemoMessage message={groupedReadMessage} />
            <ExampleLabel>Comando aberto e saída truncada</ExampleLabel>
            <ActionItem
              action={longCommandAction}
              cwd={previewConversation.cwd}
              initialExpanded
              messageId="message-command-details"
              permitted={false}
              summary={summarizeAction(longCommandAction, previewConversation.cwd)}
            />
          </PreviewSection>

          <PreviewSection id="chat-permissions" title="Permissões">
            <ExampleLabel>Pendente, com comando longo</ExampleLabel>
            <DemoMessage message={permissionExamples.pending} />
            <ExampleLabel>Permitida</ExampleLabel>
            <DemoMessage message={permissionExamples.allowed} />
            <ExampleLabel>Negada</ExampleLabel>
            <DemoMessage message={permissionExamples.denied} />
          </PreviewSection>

          <PreviewSection id="chat-questions" title="Perguntas">
            <ExampleLabel>Pendente: escolha única, múltipla e texto livre</ExampleLabel>
            <DemoMessage message={questionExamples.pending} />
            <ExampleLabel>Respondida</ExampleLabel>
            <DemoMessage message={questionExamples.answered} />
          </PreviewSection>

          <PreviewSection id="chat-plans" title="Plano">
            {planExamples.map((part) => (
              <div key={part.id}>
                <ExampleLabel>
                  {part.state === "pending"
                    ? "Pendente"
                    : part.state === "approved"
                      ? "Aprovado"
                      : "Rejeitado com comentário"}
                </ExampleLabel>
                <DemoMessage
                  message={{
                    id: `message-${part.id}`,
                    conversationId: previewConversation.id,
                    author: "agent",
                    status: "done",
                    parts: [part],
                    createdAt: "2026-11-01T14:30:00.000Z",
                    updatedAt: "2026-11-01T14:30:00.000Z",
                  }}
                  openPartId={part.state === "pending" ? undefined : part.id}
                />
              </div>
            ))}
          </PreviewSection>

          <PreviewSection id="chat-todos" title="Tarefas">
            <TodosPart part={todosPart} />
          </PreviewSection>

          <PreviewSection id="chat-errors" title="Erros">
            {errorExamples.map((message) => {
              const errorPart = message.parts.find((part) => part.type === "error");
              return errorPart?.type === "error" ? (
                <div className={styles.errorExample} key={message.id}>
                  <ExampleLabel>
                    {errorTypeLabels[errorPart.errorType]} ·{" "}
                    {errorPart.retryable ? "com Tentar de novo" : "sem Tentar de novo"}
                  </ExampleLabel>
                  <DemoMessage message={message} />
                </div>
              ) : null;
            })}
          </PreviewSection>

          <PreviewSection id="chat-error-models" title="Erro — modelos">
            <div className={styles.errorModelGrid}>
              {errorModelExamples.map((model) => (
                <ErrorModelExample
                  description={model.description}
                  key={model.id}
                  shortReason={model.shortReason}
                  title={model.title}
                  variant={model.variant}
                />
              ))}
            </div>
          </PreviewSection>

          <PreviewSection id="chat-states" title="Estado da conversa e linha do tempo">
            <ExampleLabel>Estados</ExampleLabel>
            <div className={styles.conversationStates}>
              {conversationStates.map((conversation) => (
                <ConversationStateSample conversation={conversation} key={conversation.id} />
              ))}
            </div>
            <WorkingIndicator />
            <ExampleLabel>Clique na resposta para abrir as opções e a linha do tempo</ExampleLabel>
            <DemoMessage message={timelineMessage} />
          </PreviewSection>

          <PreviewSection id="chat-message-actions" title="Ações da mensagem">
            <p className={styles.hint}>
              Clique na mensagem ou foque e pressione Enter ou Espaço para abrir as opções.
            </p>
            <DemoMessage message={userExamples.short} />
          </PreviewSection>
        </div>
      </main>

      <section aria-label={t.chat.messageComposer} className={conversationStyles.composerSection}>
        {note ? (
          <p aria-live="polite" className={styles.localNote} role="status">
            {note}
          </p>
        ) : null}
        <Composer
          ariaDescription={t.conversation.composerKeyboardDescription}
          attachments={<AttachmentChips attachments={attachments} onRemove={removeAttachment} />}
          below={
            <div className={conversationStyles.folderStrip}>
              <button
                aria-label={t.chat.folderCopy(previewConversation.cwd)}
                className={conversationStyles.folderButton}
                onClick={() => setNote("Cópia demonstrativa; nenhum acesso ao sistema foi feito.")}
                title={t.chat.folderCopy(previewConversation.cwd)}
                type="button"
              >
                <span>{formatFolderPath(previewConversation.cwd).text}</span>
              </button>
              <GitBranchLabel info={{ branch: "m2-chat", detached: false }} />
            </div>
          }
          leading={
            <div className={conversationStyles.composerControls}>
              <AttachmentPicker disabled={false} onFiles={onFilePick} />
              <span className={conversationStyles.agentTag}>
                <AgentIcon agentId="codex" />
                {agentDisplayName("codex")}
              </span>
              <ComposerPreferences
                activePopover={activePopover}
                effort={effort}
                mode={mode}
                model={model}
                models={models}
                onActivePopoverChange={setActivePopover}
                onEffortChange={setEffort}
                onModeChange={setMode}
                onModelChange={setModel}
                onPlanModeChange={setPlanMode}
                planMode={planMode}
              />
            </div>
          }
          onChange={setDraft}
          onStop={() => setNote("Não há agente ativo para parar nesta demonstração.")}
          onSubmit={submitDraft}
          placeholder={t.chat.messageInput}
          submitLabel={t.chat.send}
          value={draft}
        />
      </section>
    </section>
  );
}

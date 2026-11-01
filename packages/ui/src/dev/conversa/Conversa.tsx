// Visual inspirado em Agent Elements (MIT), https://agent-elements.21st.dev

import type { ConversationMessage, MessagePart } from "@karont/contract";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FilePlus,
  FileText,
  Globe,
  KeyRound,
  ListChecks,
  ListTodo,
  Pencil,
  RotateCcw,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { memo, type ReactNode, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Conversa.module.css";
import { formatWorkDuration, splitFinalAnswer } from "./conversationDisplay";

type ActionPart = Extract<MessagePart, { type: "action" }>;
type ThinkingPart = Extract<MessagePart, { type: "thinking" }>;
type TodosPart = Extract<MessagePart, { type: "todos" }>;
type PlanPart = Extract<MessagePart, { type: "plan" }>;
type ErrorPart = Extract<MessagePart, { type: "error" }>;
type PermissionPart = Extract<MessagePart, { type: "permission" }>;
type QuestionPart = Extract<MessagePart, { type: "question" }>;
type TextPart = Extract<MessagePart, { type: "text" }>;

const date = "2026-11-01T15:42:00-03:00";

const readParts: ActionPart[] = [
  {
    id: "read-app",
    type: "action",
    actionType: "read",
    title: "src/app.ts",
    input: "src/app.ts",
    output: "",
    truncated: false,
    state: "ok",
    durationMs: 24,
  },
  {
    id: "read-limiter",
    type: "action",
    actionType: "read",
    title: "src/rate-limit.ts",
    input: "src/rate-limit.ts",
    output: "",
    truncated: false,
    state: "ok",
    durationMs: 18,
  },
  {
    id: "read-tests",
    type: "action",
    actionType: "read",
    title: "src/rate-limit.test.ts",
    input: "src/rate-limit.test.ts",
    output: "",
    truncated: false,
    state: "ok",
    durationMs: 21,
  },
];

const diff = [
  "@@ -1,3 +1,12 @@",
  "-export function rateLimit(key: string) {",
  "-  return redis.incr(key);",
  "-}",
  "+const DEFAULT_LIMIT = 120;",
  "+const WINDOW_MS = 60_000;",
  "+export async function rateLimit(key: string) {",
  "+  const current = await redis.incr(key);",
  "+  if (current === 1) {",
  "+    await redis.expire(key, WINDOW_MS / 1_000);",
  "+  }",
  "+  return {",
  "+    allowed: current <= DEFAULT_LIMIT,",
  "+    remaining: Math.max(DEFAULT_LIMIT - current, 0),",
  "+  };",
  "+}",
].join("\n");

const sampleMessages: ConversationMessage[] = [
  {
    id: "user-message-1",
    conversationId: "sample-conversation",
    author: "user",
    status: "done",
    parts: [
      {
        id: "user-text-1",
        type: "text",
        markdown: "A busca por rate limit no Redis está lenta. Consegue revisar?",
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "agent-message-1",
    conversationId: "sample-conversation",
    author: "agent",
    status: "done",
    startedAt: 0,
    endedAt: 233_000,
    parts: [
      {
        id: "thinking-1",
        type: "thinking",
        text: "Vou conferir a implementação, buscar o padrão recomendado e comparar com os testes antes de ajustar o limite.",
        startedAt: 0,
        endedAt: 4_000,
      },
      ...readParts,
      {
        id: "text-progress-1",
        type: "text",
        markdown:
          "A chave já é compartilhada pelo serviço; agora vou conferir os limites recomendados.",
      },
      {
        id: "search-1",
        type: "action",
        actionType: "search",
        title: "rate limit redis",
        input: "rate limit redis",
        output: [
          "Rate limiting patterns · redis.io",
          "Use um contador com expiração para limitar chamadas por janela.",
          "",
          "Fixed window rate limiter · github.com/redis",
          "Exemplo de limite por chave com contador e tempo de expiração.",
          "",
          "Rate limiting in Node.js · nodejs.org",
          "Cuidados com concorrência e armazenamento compartilhado.",
        ].join("\n"),
        truncated: false,
        state: "ok",
        durationMs: 310,
      },
      {
        id: "text-progress-2",
        type: "text",
        markdown: "A expiração mantém a janela consistente entre as instâncias.",
      },
      {
        id: "command-1",
        type: "action",
        actionType: "command",
        title: "npm test",
        input: "npm test",
        output:
          "PASS  src/app.test.ts\nFAIL  should reject excess requests\n\nError: esperado 429, recebido 200\nCódigo de saída: 1",
        truncated: false,
        state: "error",
        durationMs: 1_204,
      },
      {
        id: "edit-1",
        type: "action",
        actionType: "edit",
        title: "src/app.ts",
        input: JSON.stringify({ path: "src/app.ts" }),
        output: JSON.stringify({
          changes: [{ path: "src/app.ts", kind: "update", diff }],
        }),
        truncated: false,
        state: "ok",
        durationMs: 78,
      },
      {
        id: "todos-1",
        type: "todos",
        items: [
          { id: "todo-1", title: "Localizar o limitador", state: "done" },
          { id: "todo-2", title: "Ajustar a janela e o limite", state: "done" },
          { id: "todo-3", title: "Cobrir o limite nos testes", state: "working" },
        ],
      },
      {
        id: "plan-1",
        type: "plan",
        markdown:
          "1. Usar uma janela de 60 segundos.\n2. Limitar a 120 chamadas por chave.\n3. Repetir os testes do limitador.",
        state: "approved",
      },
      {
        id: "subagent-1",
        type: "action",
        actionType: "other",
        title: "subagent: Explorar o projeto",
        input: "Mapear a estrutura e localizar testes próximos.",
        output: [
          "Leu o manifesto do projeto",
          "Localizou o limitador",
          "Encontrou os testes relacionados",
          "Conferiu o cliente Redis",
          "Verificou a configuração da janela",
          "Resumiu os pontos de alteração",
        ].join("\n"),
        truncated: false,
        state: "ok",
        durationMs: 642,
      },
      {
        id: "mcp-1",
        type: "action",
        actionType: "other",
        title: "github · criar issue",
        input: JSON.stringify({
          title: "Revisar limite de chamadas por chave",
          repository: "karont/api",
        }),
        output: JSON.stringify({
          number: 284,
          url: "https://github.com/karont/api/issues/284",
          state: "open",
        }),
        truncated: false,
        state: "ok",
        durationMs: 205,
      },
      {
        id: "text-1",
        type: "text",
        markdown: [
          "### Ajuste aplicado",
          "",
          "A janela agora dura `60 segundos` e o limite padrão é de 120 chamadas por chave.",
          "",
          "- Mantive a expiração no Redis.",
          "- O teste mostrou um caso que ainda precisa ser corrigido.",
          "",
          "```ts",
          "const allowed = current <= 120;",
          "```",
        ].join("\n"),
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "user-message-2",
    conversationId: "sample-conversation",
    author: "user",
    status: "done",
    parts: [
      {
        id: "user-text-2",
        type: "text",
        markdown: "Consegue simplificar a função e concluir o teste do limite?",
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "agent-message-2",
    conversationId: "sample-conversation",
    author: "agent",
    status: "streaming",
    startedAt: 0,
    parts: [
      {
        id: "thinking-2",
        type: "thinking",
        text: "Vou simplificar a função e conferir o caso do limite.",
        startedAt: 0,
        endedAt: 4_000,
      },
      {
        id: "read-2-app",
        type: "action",
        actionType: "read",
        title: "src/app.ts",
        input: "src/app.ts",
        output: "",
        truncated: false,
        state: "ok",
        durationMs: 22,
      },
      {
        id: "read-2-tests",
        type: "action",
        actionType: "read",
        title: "src/rate-limit.test.ts",
        input: "src/rate-limit.test.ts",
        output: "",
        truncated: false,
        state: "ok",
        durationMs: 19,
      },
      {
        id: "command-2",
        type: "action",
        actionType: "command",
        title: "npm test",
        input: "npm test",
        output: "Executando os testes do limitador…",
        truncated: false,
        state: "running",
        durationMs: null,
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "user-message-3",
    conversationId: "sample-conversation",
    author: "user",
    status: "done",
    parts: [
      {
        id: "user-text-3",
        type: "text",
        markdown: "Qual é o limite por chave?",
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "agent-message-3",
    conversationId: "sample-conversation",
    author: "agent",
    status: "done",
    parts: [
      {
        id: "text-3",
        type: "text",
        markdown: "O limite é de **120 chamadas por chave** em uma janela de 60 segundos.",
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "agent-message-error",
    conversationId: "sample-conversation",
    author: "agent",
    status: "error",
    parts: [
      {
        id: "error-1",
        type: "error",
        errorType: "failed",
        text: "A execução foi interrompida antes de concluir o último teste.",
        details: "O processo de teste terminou com código de saída 1.",
        retryable: true,
      },
    ],
    createdAt: date,
    updatedAt: date,
  },
];

const suggestions = ["Adicionar testes", "Ver o diff", "Explicar o limite"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getDiff(part: ActionPart): string {
  try {
    const value: unknown = JSON.parse(part.output);
    if (!isRecord(value) || !Array.isArray(value.changes)) return part.output;
    const change = value.changes.find(
      (item): item is { diff: string } => isRecord(item) && typeof item.diff === "string",
    );
    return change?.diff ?? part.output;
  } catch {
    return part.output;
  }
}

function countDiffLines(value: string) {
  const lines = value.split(/\r?\n/);
  return {
    added: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    removed: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
  };
}

function formatJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

const Disclosure = memo(function Disclosure({
  label,
  children,
  icon,
  className,
  panelClassName,
}: {
  label: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const panelId = useId();

  return (
    <div className={`${styles.disclosure} ${className ?? ""}`}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={styles.disclosureButton}
        id={triggerId}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {icon ? <span className={styles.disclosureIcon}>{icon}</span> : null}
        <span className={styles.disclosureLabel}>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          size={14}
          strokeWidth={1.8}
        />
      </button>
      <section
        aria-hidden={!open}
        aria-labelledby={triggerId}
        className={`${styles.disclosurePanel} ${panelClassName ?? ""}`}
        hidden={!open}
        id={panelId}
      >
        {children}
      </section>
    </div>
  );
});

const ThinkingDisclosure = memo(function ThinkingDisclosure({ part }: { part: ThinkingPart }) {
  const seconds =
    part.startedAt !== undefined && part.endedAt !== undefined
      ? Math.max(1, Math.round((part.endedAt - part.startedAt) / 1_000))
      : 0;

  return (
    <Disclosure icon={<Brain aria-hidden="true" size={14} />} label={`Pensou por ${seconds}s`}>
      <p className={styles.thinkingText}>{part.text}</p>
    </Disclosure>
  );
});

const ReadGroup = memo(function ReadGroup({ parts }: { parts: readonly ActionPart[] }) {
  return (
    <Disclosure
      icon={<FileText aria-hidden="true" size={14} />}
      label={`Leu ${parts.length} arquivos`}
    >
      <div className={styles.fileList}>
        {parts.map((part) => (
          <div className={styles.fileRow} key={part.id}>
            <FileText aria-hidden="true" size={14} strokeWidth={1.7} />
            <span className={styles.fileName}>{part.title}</span>
          </div>
        ))}
      </div>
    </Disclosure>
  );
});

const SearchDisclosure = memo(function SearchDisclosure({ part }: { part: ActionPart }) {
  return (
    <Disclosure
      icon={<Search aria-hidden="true" size={14} />}
      label={<>Buscou “{part.title}”</>}
      panelClassName={styles.flushPanel}
    >
      <div className={styles.searchPanel}>
        <div className={styles.searchHeader}>
          <span>Resultados para</span>
          <span className={styles.searchQuery}>“{part.input}”</span>
        </div>
        <pre className={styles.searchOutput}>{part.output}</pre>
      </div>
    </Disclosure>
  );
});

const BashDisclosure = memo(function BashDisclosure({ part }: { part: ActionPart }) {
  const exitCode = part.output.match(/Código de saída:\s*(-?\d+)/i)?.[1];

  return (
    <Disclosure
      icon={<Terminal aria-hidden="true" size={14} />}
      label={
        <>
          Rodou <code>{part.title}</code>
          {part.state === "running" ? <span className={styles.toolState}> · Rodando</span> : null}
        </>
      }
      panelClassName={styles.flushPanel}
    >
      <div className={styles.terminalPanel}>
        <div className={styles.terminalHeader}>
          <span>Saída do comando</span>
          <span className={styles.exitCode}>
            Código de saída {exitCode ?? (part.state === "error" ? "1" : "0")}
          </span>
        </div>
        <pre className={styles.terminalOutput}>{part.output}</pre>
      </div>
    </Disclosure>
  );
});

const EditDisclosure = memo(function EditDisclosure({ part }: { part: ActionPart }) {
  const text = getDiff(part);
  const counts = countDiffLines(text);
  const lineOccurrences = new Map<string, number>();

  return (
    <Disclosure
      icon={<Pencil aria-hidden="true" size={14} />}
      label={
        <>
          Editou <code>{part.title}</code>{" "}
          <span className={styles.diffStats}>
            <span className={styles.addedCount}>+{counts.added}</span>
            <span className={styles.removedCount}>−{counts.removed}</span>
          </span>
        </>
      }
      panelClassName={styles.flushPanel}
    >
      <div className={styles.diffPanel}>
        <div className={styles.diffHeader}>{part.title}</div>
        <pre className={styles.diffOutput}>
          {text.split(/\r?\n/).map((line) => {
            const occurrence = lineOccurrences.get(line) ?? 0;
            lineOccurrences.set(line, occurrence + 1);
            const lineClass = line.startsWith("+")
              ? styles.diffAdded
              : line.startsWith("-")
                ? styles.diffRemoved
                : line.startsWith("@@")
                  ? styles.diffHunk
                  : "";
            return (
              <span className={`${styles.diffLine} ${lineClass}`} key={`${line}-${occurrence}`}>
                {line || " "}
              </span>
            );
          })}
        </pre>
      </div>
    </Disclosure>
  );
});

const TodosDisclosure = memo(function TodosDisclosure({ part }: { part: TodosPart }) {
  const completed = part.items.filter((item) => item.state === "done").length;

  return (
    <Disclosure
      icon={<ListChecks aria-hidden="true" size={14} />}
      label={`Tarefas · ${completed} de ${part.items.length} concluídas`}
    >
      <div className={styles.todoList}>
        {part.items.map((item) => (
          <div className={styles.todoItem} key={item.id}>
            <span className={styles.todoMark}>
              {item.state === "done" ? (
                <Check aria-hidden="true" size={14} />
              ) : item.state === "working" ? (
                <ArrowRight aria-hidden="true" size={14} />
              ) : (
                <Circle aria-hidden="true" size={14} />
              )}
            </span>
            <span className={styles.todoTitle}>{item.title}</span>
            <span className={styles.todoState}>
              {item.state === "done"
                ? "Feita"
                : item.state === "working"
                  ? "Em andamento"
                  : "Pendente"}
            </span>
          </div>
        ))}
      </div>
    </Disclosure>
  );
});

const PlanDisclosure = memo(function PlanDisclosure({ part }: { part: PlanPart }) {
  return (
    <Disclosure icon={<ListTodo aria-hidden="true" size={14} />} label="Plano de execução">
      <div className={styles.planPanel}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.markdown}</ReactMarkdown>
      </div>
    </Disclosure>
  );
});

const PendingPlan = memo(function PendingPlan({ part }: { part: PlanPart }) {
  return (
    <section aria-label="Plano pendente" className={styles.pendingPart}>
      <p className={styles.pendingTitle}>Plano aguardando aprovação</p>
      <div className={styles.planPanel}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.markdown}</ReactMarkdown>
      </div>
    </section>
  );
});

function permissionOptionLabel(option: PermissionPart["options"][number]) {
  switch (option) {
    case "allow":
      return "Permitir";
    case "always":
      return "Permitir sempre";
    case "deny":
      return "Negar";
  }
}

const PendingPermission = memo(function PendingPermission({ part }: { part: PermissionPart }) {
  return (
    <section aria-label="Permissão pendente" className={styles.pendingPart}>
      <p className={styles.pendingTitle}>
        <KeyRound aria-hidden="true" size={14} />
        {part.tool}
      </p>
      <p className={styles.pendingText}>{part.summary}</p>
      {part.description ? <p className={styles.pendingText}>{part.description}</p> : null}
      <fieldset className={styles.pendingOptions}>
        <legend className={styles.srOnly}>Opções disponíveis</legend>
        {part.options.map((option) => (
          <span className={styles.pendingOption} key={option}>
            {permissionOptionLabel(option)}
          </span>
        ))}
      </fieldset>
    </section>
  );
});

const QuestionContent = memo(function QuestionContent({ part }: { part: QuestionPart }) {
  return (
    <div className={styles.questionList}>
      {part.questions.map((question) => (
        <div className={styles.questionItem} key={question.question}>
          <p className={styles.pendingText}>{question.question}</p>
          {question.options.map((option) => (
            <div className={styles.questionOption} key={option.label}>
              <span>{option.label}</span>
              {option.description ? <span>{option.description}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

const PendingQuestion = memo(function PendingQuestion({ part }: { part: QuestionPart }) {
  return (
    <section aria-label="Pergunta pendente" className={styles.pendingPart}>
      <p className={styles.pendingTitle}>O agente precisa de uma resposta</p>
      <QuestionContent part={part} />
    </section>
  );
});

const QuestionDisclosure = memo(function QuestionDisclosure({ part }: { part: QuestionPart }) {
  return (
    <Disclosure icon={<Circle aria-hidden="true" size={14} />} label="Pergunta respondida">
      <QuestionContent part={part} />
    </Disclosure>
  );
});

const PermissionDisclosure = memo(function PermissionDisclosure({
  part,
}: {
  part: PermissionPart;
}) {
  const stateLabel = part.state === "allowed" ? "Permissão concedida" : "Permissão negada";

  return (
    <Disclosure
      icon={<KeyRound aria-hidden="true" size={14} />}
      label={`${stateLabel} · ${part.tool}`}
    >
      <div className={styles.pendingPart}>
        <p className={styles.pendingText}>{part.summary}</p>
        {part.description ? <p className={styles.pendingText}>{part.description}</p> : null}
      </div>
    </Disclosure>
  );
});

const SubagentDisclosure = memo(function SubagentDisclosure({ part }: { part: ActionPart }) {
  const steps = part.output.split(/\r?\n/).filter(Boolean);

  return (
    <Disclosure
      icon={<Bot aria-hidden="true" size={14} />}
      label={`Explorou o projeto · ${steps.length} passos`}
    >
      <div className={styles.subagentPanel}>
        <p className={styles.subagentDescription}>{part.input}</p>
        <ol className={styles.subagentSteps}>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </Disclosure>
  );
});

const McpDisclosure = memo(function McpDisclosure({ part }: { part: ActionPart }) {
  return (
    <Disclosure icon={<KeyRound aria-hidden="true" size={14} />} label={part.title}>
      <div className={styles.mcpPanel}>
        <div className={styles.jsonGroup}>
          <span className={styles.jsonLabel}>Entrada</span>
          <pre className={styles.jsonOutput}>{formatJson(part.input)}</pre>
        </div>
        <div className={styles.jsonGroup}>
          <span className={styles.jsonLabel}>Saída</span>
          <pre className={styles.jsonOutput}>{formatJson(part.output)}</pre>
        </div>
      </div>
    </Disclosure>
  );
});

const ErrorMessage = memo(function ErrorMessage({ part }: { part: ErrorPart }) {
  const [retryQueued, setRetryQueued] = useState(false);

  return (
    <div className={styles.errorMessage}>
      <div className={styles.errorCopy}>
        <CircleAlert aria-hidden="true" className={styles.errorIcon} size={16} strokeWidth={1.8} />
        <div>
          <p className={styles.errorText}>{part.text}</p>
          {part.details ? <p className={styles.errorDetails}>{part.details}</p> : null}
          {retryQueued ? (
            <p aria-live="polite" className={styles.retryNote} role="status">
              Nova tentativa indisponível nesta tela de exemplo.
            </p>
          ) : null}
        </div>
      </div>
      {part.retryable ? (
        <button className={styles.retryButton} onClick={() => setRetryQueued(true)} type="button">
          <RotateCcw aria-hidden="true" size={14} />
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
});

const WorkingIndicator = memo(function WorkingIndicator({ label }: { label: string }) {
  return (
    <div aria-live="polite" className={styles.workingStatus} role="status">
      <svg aria-hidden="true" className={styles.spiralLoader} fill="none" viewBox="0 0 16 16">
        <path
          d="M8 8c0-1.1 1.7-1.1 1.7 0 0 2.2-3.5 2.2-3.5 0s5.4-3.6 5.4 0-7.2 4.8-7.2 0 9-6 9 0"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
      <span className={styles.shimmer}>
        <span className={styles.shimmerBase}>{label}</span>
        <span aria-hidden="true" className={styles.shimmerBand}>
          <span className={styles.shimmerHighlight}>{label}</span>
        </span>
      </span>
    </div>
  );
});

function renderAction(part: ActionPart) {
  switch (part.actionType) {
    case "search":
      return <SearchDisclosure key={part.id} part={part} />;
    case "command":
      return <BashDisclosure key={part.id} part={part} />;
    case "edit":
      return <EditDisclosure key={part.id} part={part} />;
    case "other":
      return part.title.startsWith("subagent:") ? (
        <SubagentDisclosure key={part.id} part={part} />
      ) : part.title.includes(" · ") ? (
        <McpDisclosure key={part.id} part={part} />
      ) : (
        <Disclosure icon={<Wrench aria-hidden="true" size={14} />} key={part.id} label={part.title}>
          <p className={styles.thinkingText}>{part.output || part.input}</p>
        </Disclosure>
      );
    case "read":
      return (
        <Disclosure
          icon={<FileText aria-hidden="true" size={14} />}
          key={part.id}
          label={part.title}
        >
          <p className={styles.thinkingText}>{part.output || part.input}</p>
        </Disclosure>
      );
    case "write":
      return (
        <Disclosure
          icon={<FilePlus aria-hidden="true" size={14} />}
          key={part.id}
          label={part.title}
        >
          <p className={styles.thinkingText}>{part.output || part.input}</p>
        </Disclosure>
      );
    case "web":
      return (
        <Disclosure icon={<Globe aria-hidden="true" size={14} />} key={part.id} label={part.title}>
          <p className={styles.thinkingText}>{part.output || part.input}</p>
        </Disclosure>
      );
  }
}

function isAlwaysVisiblePart(part: MessagePart) {
  return (
    part.type === "error" ||
    (part.type === "permission" && part.state === "pending") ||
    (part.type === "question" && part.state === "pending") ||
    (part.type === "plan" && part.state === "pending")
  );
}

function isToolPart(part: MessagePart) {
  return (
    part.type === "thinking" ||
    part.type === "action" ||
    part.type === "todos" ||
    part.type === "plan" ||
    part.type === "permission" ||
    part.type === "question"
  );
}

function renderMessagePart(part: MessagePart): ReactNode {
  switch (part.type) {
    case "thinking":
      return <ThinkingDisclosure key={part.id} part={part} />;
    case "action":
      return renderAction(part);
    case "todos":
      return <TodosDisclosure key={part.id} part={part} />;
    case "plan":
      return part.state === "pending" ? (
        <PendingPlan key={part.id} part={part} />
      ) : (
        <PlanDisclosure key={part.id} part={part} />
      );
    case "permission":
      return part.state === "pending" ? (
        <PendingPermission key={part.id} part={part} />
      ) : (
        <PermissionDisclosure key={part.id} part={part} />
      );
    case "question":
      return part.state === "pending" ? (
        <PendingQuestion key={part.id} part={part} />
      ) : (
        <QuestionDisclosure key={part.id} part={part} />
      );
    case "error":
      return <ErrorMessage key={part.id} part={part} />;
    case "text":
      return (
        <div className={styles.markdown} key={part.id}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.markdown}</ReactMarkdown>
        </div>
      );
    default:
      return null;
  }
}

function renderMessageParts(parts: readonly MessagePart[]): ReactNode[] {
  const rendered: ReactNode[] = [];
  const toolGroup: ReactNode[] = [];
  let index = 0;

  const flushTools = () => {
    if (toolGroup.length === 0) return;
    rendered.push(
      <div className={styles.toolGroup} key={`tool-group-${rendered.length}`}>
        {toolGroup.splice(0)}
      </div>,
    );
  };

  while (index < parts.length) {
    const part = parts[index];
    if (!part) {
      index += 1;
      continue;
    }

    if (isAlwaysVisiblePart(part)) {
      flushTools();
      const node = renderMessagePart(part);
      if (node !== null) rendered.push(node);
      index += 1;
      continue;
    }

    if (part.type === "action" && part.actionType === "read") {
      const reads: ActionPart[] = [];
      while (index < parts.length) {
        const next = parts[index];
        if (next?.type !== "action" || next.actionType !== "read") break;
        reads.push(next);
        index += 1;
      }
      toolGroup.push(<ReadGroup key={`read-group-${reads[0]?.id ?? index}`} parts={reads} />);
      continue;
    }

    const node = renderMessagePart(part);
    index += 1;
    if (node === null) continue;
    if (isToolPart(part)) {
      toolGroup.push(node);
    } else {
      flushTools();
      rendered.push(node);
    }
  }

  flushTools();
  return rendered;
}

function renderFinalAnswer(parts: readonly TextPart[]) {
  if (parts.length === 0) return null;

  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {parts.map((part) => part.markdown).join("\n\n")}
      </ReactMarkdown>
    </div>
  );
}

function renderCompletedMessage(message: ConversationMessage) {
  const { history, finalAnswer } = splitFinalAnswer(message.parts);
  const historyParts = history.filter((part) => !isAlwaysVisiblePart(part));
  const alwaysVisibleParts = message.parts.filter(isAlwaysVisiblePart);
  const durationMs =
    message.startedAt !== undefined && message.endedAt !== undefined
      ? message.endedAt - message.startedAt
      : undefined;

  return (
    <>
      {historyParts.length > 0 ? (
        <Disclosure
          className={styles.historyDisclosure}
          label={formatWorkDuration(durationMs)}
          panelClassName={styles.historyPanel}
        >
          {renderMessageParts(historyParts)}
        </Disclosure>
      ) : null}
      {alwaysVisibleParts.map((part) => renderMessagePart(part))}
      {renderFinalAnswer(finalAnswer)}
    </>
  );
}

const MessageRow = memo(function MessageRow({ message }: { message: ConversationMessage }) {
  if (message.author === "user") {
    const text = message.parts
      .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.markdown)
      .join("\n");

    return (
      <article aria-label="Mensagem do usuário" className={styles.userMessage}>
        <div className={styles.userBubble}>{text}</div>
      </article>
    );
  }

  if (message.status === "done") {
    return (
      <article aria-label="Resposta do agente" className={styles.agentMessage}>
        {renderCompletedMessage(message)}
      </article>
    );
  }

  if (message.status === "streaming") {
    return (
      <article aria-label="Resposta do agente em andamento" className={styles.agentMessage}>
        {renderMessageParts(message.parts)}
        <WorkingIndicator label="Lendo app.ts" />
      </article>
    );
  }

  return (
    <article aria-label="Resposta do agente" className={styles.agentMessage}>
      {renderMessageParts(message.parts)}
    </article>
  );
});

export const Conversa = memo(function Conversa() {
  const [draft, setDraft] = useState("");
  const [sendNotice, setSendNotice] = useState("");

  return (
    <main aria-label="Conversa de exemplo" className={styles.page}>
      <header className={styles.topBar}>
        <h1 className={styles.pageTitle}>Conversa</h1>
        <p className={styles.prototypeNotice} role="note">
          Tela provisória · dados de exemplo
        </p>
      </header>
      <section aria-label="Mensagens da conversa" className={styles.messageList}>
        {sampleMessages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </section>
      <footer className={styles.composerSection}>
        <fieldset className={styles.suggestions}>
          <legend className={styles.srOnly}>Sugestões de mensagem</legend>
          {suggestions.map((suggestion) => (
            <button
              className={styles.suggestion}
              key={suggestion}
              onClick={() => {
                setDraft(suggestion);
                setSendNotice("");
              }}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </fieldset>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) setSendNotice("Envio desativado nesta tela de exemplo.");
          }}
        >
          <label className={styles.srOnly} htmlFor="sample-message-input">
            Mensagem
          </label>
          <textarea
            className={styles.composerInput}
            id="sample-message-input"
            onChange={(event) => {
              setDraft(event.target.value);
              setSendNotice("");
            }}
            placeholder="Escreva uma mensagem…"
            value={draft}
          />
          <div className={styles.composerFooter}>
            <span className={styles.composerAgent}>Codex · Pode editar</span>
            <button
              aria-label="Enviar mensagem de exemplo"
              className={styles.sendButton}
              disabled={!draft.trim()}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          </div>
        </form>
        <p aria-live="polite" className={styles.sendNotice} role="status">
          {sendNotice}
        </p>
      </footer>
    </main>
  );
});

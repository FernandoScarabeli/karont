// Visual inspirado em Agent Elements (MIT), https://agent-elements.21st.dev

import type { ConversationMessage, MessagePart } from "@karont/contract";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FileText,
  RotateCcw,
} from "lucide-react";
import { memo, type ReactNode, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Conversa.module.css";

type ActionPart = Extract<MessagePart, { type: "action" }>;
type ThinkingPart = Extract<MessagePart, { type: "thinking" }>;
type TodosPart = Extract<MessagePart, { type: "todos" }>;
type PlanPart = Extract<MessagePart, { type: "plan" }>;
type ErrorPart = Extract<MessagePart, { type: "error" }>;

const date = "2026-11-01T15:42:00-03:00";

const readParts: ActionPart[] = [
  {
    id: "read-app",
    type: "action",
    actionType: "read",
    title: "src/app.ts",
    input: "src/app.ts",
    output: "Inicialização do serviço e configuração do limitador.",
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
    output: "Implementação atual do limite por chave.",
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
    output: "Testes existentes para o limitador.",
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

const searchResults = [
  {
    title: "Rate limiting patterns",
    source: "redis.io",
    excerpt: "Use um contador com expiração para limitar chamadas por janela.",
  },
  {
    title: "Fixed window rate limiter",
    source: "github.com/redis",
    excerpt: "Exemplo de limite por chave com contador e tempo de expiração.",
  },
  {
    title: "Rate limiting in Node.js",
    source: "nodejs.org",
    excerpt: "Cuidados com concorrência e armazenamento compartilhado.",
  },
];

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
        id: "search-1",
        type: "action",
        actionType: "search",
        title: "rate limit redis",
        input: "rate limit redis",
        output: JSON.stringify(searchResults),
        truncated: false,
        state: "ok",
        durationMs: 310,
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
    parts: [],
    createdAt: date,
    updatedAt: date,
  },
  {
    id: "agent-message-3",
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

type SearchResult = { title: string; source: string; excerpt: string };

function getSearchResults(output: string): SearchResult[] {
  try {
    const value: unknown = JSON.parse(output);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SearchResult[] => {
      if (
        !isRecord(item) ||
        typeof item.title !== "string" ||
        typeof item.source !== "string" ||
        typeof item.excerpt !== "string"
      ) {
        return [];
      }
      return [{ title: item.title, source: item.source, excerpt: item.excerpt }];
    });
  } catch {
    return [];
  }
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
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
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
        className={styles.disclosurePanel}
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
    <Disclosure label={`Pensou por ${seconds}s`}>
      <p className={styles.thinkingText}>{part.text}</p>
    </Disclosure>
  );
});

const ReadGroup = memo(function ReadGroup({ parts }: { parts: readonly ActionPart[] }) {
  return (
    <Disclosure label={`Leu ${parts.length} arquivos`}>
      <div className={styles.fileList}>
        {parts.map((part) => (
          <div className={styles.fileRow} key={part.id}>
            <FileText aria-hidden="true" size={14} strokeWidth={1.7} />
            <div className={styles.fileDescription}>
              <span className={styles.fileName}>{part.title}</span>
              <span className={styles.fileOutput}>{part.output}</span>
            </div>
          </div>
        ))}
      </div>
    </Disclosure>
  );
});

const SearchDisclosure = memo(function SearchDisclosure({ part }: { part: ActionPart }) {
  const results = getSearchResults(part.output);

  return (
    <Disclosure label={<>Buscou “{part.title}”</>}>
      <div className={styles.searchPanel}>
        <div className={styles.searchHeader}>
          <span>Resultados para</span>
          <span className={styles.searchQuery}>“{part.input}”</span>
        </div>
        <div className={styles.searchResults}>
          {results.map((result) => (
            <div className={styles.searchResult} key={`${result.source}-${result.title}`}>
              <FileText aria-hidden="true" size={14} strokeWidth={1.7} />
              <div className={styles.searchResultCopy}>
                <span className={styles.searchResultTitle}>{result.title}</span>
                <span className={styles.searchResultExcerpt}>{result.excerpt}</span>
              </div>
              <span className={styles.searchSource}>{result.source}</span>
            </div>
          ))}
        </div>
      </div>
    </Disclosure>
  );
});

const BashDisclosure = memo(function BashDisclosure({ part }: { part: ActionPart }) {
  const exitCode = part.output.match(/Código de saída:\s*(-?\d+)/i)?.[1];

  return (
    <Disclosure
      label={
        <>
          Rodou <code>{part.title}</code>
        </>
      }
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
      label={
        <>
          Editou <code>{part.title}</code>{" "}
          <span className={styles.diffStats}>
            <span className={styles.addedCount}>+{counts.added}</span>
            <span className={styles.removedCount}>−{counts.removed}</span>
          </span>
        </>
      }
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
    <Disclosure label={`Tarefas · ${completed} de ${part.items.length} concluídas`}>
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
    <Disclosure label="Plano de execução">
      <div className={styles.planPanel}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.markdown}</ReactMarkdown>
      </div>
    </Disclosure>
  );
});

const SubagentDisclosure = memo(function SubagentDisclosure({ part }: { part: ActionPart }) {
  const steps = part.output.split(/\r?\n/).filter(Boolean);

  return (
    <Disclosure label={`Explorou o projeto · ${steps.length} passos`}>
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
    <Disclosure label={part.title}>
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
  const dotClasses = [
    styles.spiralDot1,
    styles.spiralDot2,
    styles.spiralDot3,
    styles.spiralDot4,
    styles.spiralDot5,
    styles.spiralDot6,
    styles.spiralDot7,
    styles.spiralDot8,
    styles.spiralDot9,
  ];

  return (
    <div aria-live="polite" className={styles.workingStatus} role="status">
      <span aria-hidden="true" className={styles.spiralLoader}>
        {dotClasses.map((className) => (
          <span className={className} key={className} />
        ))}
      </span>
      <span className={styles.shimmer}>{label}</span>
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
      ) : (
        <McpDisclosure key={part.id} part={part} />
      );
    default:
      return (
        <Disclosure key={part.id} label={part.title}>
          <p className={styles.thinkingText}>{part.output || part.input}</p>
        </Disclosure>
      );
  }
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

  if (message.status === "streaming" && message.parts.length === 0) {
    return (
      <article aria-label="Resposta do agente em andamento" className={styles.agentMessage}>
        <WorkingIndicator label="Lendo app.ts" />
      </article>
    );
  }

  const reads = message.parts.filter(
    (part): part is ActionPart => part.type === "action" && part.actionType === "read",
  );
  let readGroupRendered = false;

  return (
    <article aria-label="Resposta do agente" className={styles.agentMessage}>
      {message.parts.map((part) => {
        if (part.type === "action" && part.actionType === "read") {
          if (readGroupRendered) return null;
          readGroupRendered = true;
          return <ReadGroup key="read-group" parts={reads} />;
        }

        switch (part.type) {
          case "thinking":
            return <ThinkingDisclosure key={part.id} part={part} />;
          case "action":
            return renderAction(part);
          case "todos":
            return <TodosDisclosure key={part.id} part={part} />;
          case "plan":
            return <PlanDisclosure key={part.id} part={part} />;
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
      })}
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

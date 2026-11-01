import type { Conversation, ConversationMessage, MessagePart } from "@karont/contract";
import type { PendingComposerAttachment } from "../conversation/ComposerAttachments.tsx";

const conversationId = "chat-preview";
const createdAt = "2026-11-01T14:30:00.000Z";
const cwd = "/home/fernando/projetos/karont";

function message(
  id: string,
  author: ConversationMessage["author"],
  status: ConversationMessage["status"],
  parts: MessagePart[],
  options: Pick<ConversationMessage, "attachments" | "startedAt" | "endedAt"> = {},
): ConversationMessage {
  return {
    id,
    conversationId,
    author,
    status,
    parts,
    ...options,
    createdAt,
    updatedAt: createdAt,
  };
}

function textPart(id: string, markdown: string, startedAt = 1_000, endedAt = 3_000): MessagePart {
  return { id, type: "text", markdown, startedAt, endedAt };
}

type ActionPart = Extract<MessagePart, { type: "action" }>;
type ActionType = ActionPart["actionType"];
type ActionState = ActionPart["state"];

function actionPart(
  id: string,
  actionType: ActionType,
  state: ActionState,
  input: string,
  output: string,
  options: { title?: string; truncated?: boolean } = {},
): ActionPart {
  return {
    id,
    type: "action",
    actionType,
    title: options.title ?? actionType,
    input,
    output,
    truncated: options.truncated ?? false,
    state,
    durationMs: state === "running" || state === "waiting" ? null : 1_280,
    startedAt: 3_000,
    ...(state === "running" || state === "waiting" ? {} : { endedAt: 4_280 }),
  };
}

export const userExamples = {
  short: message("user-short", "user", "done", [
    textPart("user-short-text", "Ajuste o espaçamento do composer para combinar com a conversa."),
  ]),
  long: message("user-long", "user", "done", [
    textPart(
      "user-long-text",
      "Pode revisar o fluxo de anexos no chat?\n\n" +
        "Quando a pessoa cola uma imagem, o composer deve mostrar uma prévia e manter o texto digitado. " +
        "Quando arrasta um arquivo de texto, precisamos mostrar o nome e o tamanho antes do envio.\n\n" +
        "Confira também o estado em que a conversa está esperando uma permissão. O campo não deve " +
        "sumir nem perder o rascunho enquanto a resposta está pausada.\n\n" +
        "No fim, atualize os exemplos de interface e deixe os nomes acessíveis em português.",
    ),
  ]),
  attachments: message(
    "user-attachments",
    "user",
    "done",
    [textPart("user-attachments-text", "Veja a captura e o resumo do fluxo atual.")],
    {
      attachments: [
        {
          name: "composer-atual.png",
          mimeType: "image/png",
          kind: "image",
          sizeBytes: 84_210,
        },
        {
          name: "fluxo-de-anexos.md",
          mimeType: "text/markdown",
          kind: "text",
          sizeBytes: 3_482,
        },
      ],
    },
  ),
};

export const richResponse = message("response-rich", "agent", "done", [
  textPart(
    "response-rich-text",
    "# Revisão do fluxo de anexos\n\n" +
      "O fluxo está organizado em **três etapas**: selecionar o arquivo, conferir a prévia e enviar a mensagem.\n\n" +
      "## O que conferir\n\n" +
      "- Imagens mantêm a prévia dentro do composer.\n" +
      "- Arquivos de texto mostram nome e tamanho.\n" +
      "- O rascunho continua disponível enquanto a conversa aguarda uma permissão.\n\n" +
      "> A interface exibe somente metadados do anexo na lista de mensagens.\n\n" +
      "| Tipo | Limite | Prévia |\n| --- | ---: | --- |\n| Imagem | 5 MB | Miniatura |\n| Texto | 200 kB | Nome e tamanho |\n\n" +
      "A validação fica em `classifyAttachmentFile()`. Consulte o [guia local](./docs/anexos.md) para ver o contrato usado nesta amostra.\n\n" +
      "```ts\n" +
      "const accepted = classifyAttachmentFile(file);\n" +
      "if (!accepted) return showAttachmentError(file.name);\n" +
      "```",
  ),
]);

export const shortResponse = message("response-short", "agent", "done", [
  textPart("response-short-text", "Pronto. Mantive o rascunho ao anexar um arquivo."),
]);

export const streamingResponseText =
  "A revisão está em andamento. Primeiro vou conferir o estado do composer; em seguida, verifico os nomes acessíveis e a prévia dos anexos.";

export const streamingResponse = message(
  "response-streaming",
  "agent",
  "streaming",
  [textPart("response-streaming-text", "A revisão está em andamento.", 1_000, 1_000)],
  { startedAt: 1_000 },
);

export const thinkingMessage = message("thinking", "agent", "done", [
  {
    id: "thinking-part",
    type: "thinking",
    text: "Vou comparar o estado do rascunho antes e depois de anexar o arquivo, sem iniciar uma chamada do serviço.",
    startedAt: 1_000,
    endedAt: 3_800,
  },
]);

const actionInputs: Record<ActionType, string> = {
  read: JSON.stringify({ file_path: `${cwd}/packages/ui/src/conversation/ConversationView.tsx` }),
  edit: JSON.stringify({
    file_path: `${cwd}/packages/ui/src/conversation/ComposerAttachments.tsx`,
  }),
  write: JSON.stringify({ file_path: `${cwd}/docs/fluxo-de-anexos.md` }),
  command: "pnpm lint",
  search: JSON.stringify({ pattern: "AttachmentChips", path: "packages/ui/src" }),
  web: JSON.stringify({ query: "react-markdown remark-gfm documentação" }),
  other: JSON.stringify({ operation: "inspect_workspace", path: cwd }),
};

const actionOutputs: Record<ActionType, string> = {
  read: "import { AttachmentChips } from './ComposerAttachments.tsx';",
  edit: "diff --git a/ComposerAttachments.tsx b/ComposerAttachments.tsx\n+      // mantém o arquivo selecionado enquanto o rascunho é editado",
  write: "Arquivo criado: docs/fluxo-de-anexos.md",
  command: "\n> @karont/ui lint\n> biome check src\n\nChecked 42 files. No fixes applied.",
  search: "packages/ui/src/conversation/ConversationView.tsx: AttachmentChips",
  web: "Documentação sobre renderização Markdown e tabelas GFM.",
  other: "Workspace e projeto identificados para a amostra de desenvolvimento.",
};

export const actionStateExamples: Array<{ actionType: ActionType; actions: ActionPart[] }> = (
  ["read", "edit", "write", "command", "search", "web", "other"] as const
).map((actionType) => ({
  actionType,
  actions: (["running", "ok", "error", "waiting"] as const).map((state) =>
    actionPart(
      `action-${actionType}-${state}`,
      actionType,
      state,
      actionInputs[actionType],
      state === "error" ? `A ação ${actionType} falhou nesta amostra.` : actionOutputs[actionType],
    ),
  ),
}));

export const groupedReadMessage = message("action-read-group", "agent", "done", [
  actionPart(
    "read-group-one",
    "read",
    "ok",
    JSON.stringify({ file_path: `${cwd}/packages/ui/src/App.tsx` }),
    "Rota de desenvolvimento encontrada.",
  ),
  actionPart(
    "read-group-two",
    "read",
    "ok",
    JSON.stringify({ file_path: `${cwd}/packages/ui/src/conversation/ConversationView.tsx` }),
    "Layout do chat encontrado.",
  ),
  actionPart(
    "read-group-three",
    "read",
    "ok",
    JSON.stringify({ file_path: `${cwd}/packages/ui/src/conversation/ConversationParts.tsx` }),
    "Partes da mensagem encontradas.",
  ),
]);

export const longCommandAction = actionPart(
  "action-command-details",
  "command",
  "ok",
  "pnpm lint && pnpm --workspace @karont/ui typecheck",
  "> biome check src\nChecked 42 files. No fixes applied.\n\n> @karont/ui typecheck\nNo errors found.\n\n> build\n1,164 modules transformed\nOutput generated for renderer, preload and main",
  { title: "pnpm lint e typecheck", truncated: true },
);

export const permissionExamples = {
  pending: message("permission-pending", "agent", "done", [
    {
      id: "permission-pending-part",
      type: "permission",
      tool: "Bash",
      summary:
        "pnpm exec playwright test packages/ui/e2e/chat-flow.spec.ts --project=desktop --grep='anexos mantém o rascunho'",
      description: "O agente quer executar um teste de interface no Projeto Karont.",
      options: ["allow", "always", "deny"],
      state: "pending",
      startedAt: 1_000,
    },
  ]),
  allowed: message("permission-allowed", "agent", "done", [
    {
      id: "permission-allowed-part",
      type: "permission",
      tool: "Bash",
      summary: "pnpm lint",
      options: ["allow", "always", "deny"],
      state: "allowed",
      startedAt: 1_000,
      endedAt: 4_100,
    },
  ]),
  denied: message("permission-denied", "agent", "done", [
    {
      id: "permission-denied-part",
      type: "permission",
      tool: "Bash",
      summary: "git clean -fdx && pnpm install --force --ignore-scripts",
      options: ["allow", "always", "deny"],
      state: "denied",
      startedAt: 1_000,
      endedAt: 2_200,
    },
  ]),
};

export const questionExamples = {
  pending: message("question-pending", "agent", "done", [
    {
      id: "question-pending-part",
      type: "question",
      state: "pending",
      questions: [
        {
          header: "Agente padrão",
          question: "Qual agente você quer selecionar para esta conversa?",
          options: [
            { label: "Claude Code", description: "Bom para mudanças em vários arquivos" },
            { label: "Codex", description: "Bom para tarefas curtas e revisão" },
          ],
          multiSelect: false,
          freeText: false,
        },
        {
          header: "Arquivos",
          question: "Quais tipos de anexo devem aparecer nesta amostra?",
          options: [{ label: "Imagem" }, { label: "Arquivo de texto" }, { label: "Código" }],
          multiSelect: true,
          freeText: false,
        },
        {
          header: "Comentário",
          question: "Há algum detalhe adicional para considerar?",
          options: [],
          multiSelect: false,
          freeText: true,
        },
      ],
      startedAt: 1_000,
    },
  ]),
  answered: message("question-answered", "agent", "done", [
    {
      id: "question-answered-part",
      type: "question",
      state: "answered",
      questions: [
        {
          question: "Qual agente você selecionou?",
          options: [{ label: "Codex" }],
          multiSelect: false,
          freeText: false,
        },
      ],
      startedAt: 1_000,
      endedAt: 3_800,
    },
  ]),
};

export const planExamples = [
  {
    id: "plan-pending",
    type: "plan",
    markdown:
      "1. Atualizar a validação do anexo.\n2. Preservar o texto do composer.\n3. Conferir os nomes acessíveis.",
    state: "pending",
    startedAt: 1_000,
  },
  {
    id: "plan-approved",
    type: "plan",
    markdown: "1. Atualizar a validação do anexo.\n2. Preservar o texto do composer.",
    state: "approved",
    startedAt: 1_000,
    endedAt: 5_000,
  },
  {
    id: "plan-rejected",
    type: "plan",
    markdown:
      "1. Enviar o anexo antes de validar o tamanho.\n2. Limpar o rascunho depois do envio.",
    state: "rejected",
    comment: "Mantenha o rascunho se a validação falhar e mostre o erro perto do anexo.",
    startedAt: 1_000,
    endedAt: 5_600,
  },
] satisfies Array<Extract<MessagePart, { type: "plan" }>>;

export const todosPart: Extract<MessagePart, { type: "todos" }> = {
  id: "todos-part",
  type: "todos",
  items: [
    { id: "todo-validation", title: "Validar formato do anexo", state: "done" },
    { id: "todo-draft", title: "Preservar o rascunho", state: "working" },
    { id: "todo-accessibility", title: "Revisar nomes acessíveis", state: "pending" },
  ],
  startedAt: 1_000,
};

const errorSamples: Array<{
  errorType: Extract<MessagePart, { type: "error" }>["errorType"];
  text: string;
}> = [
  { errorType: "cli-not-found", text: "Codex não foi encontrado no PATH desta máquina." },
  {
    errorType: "not-logged-in",
    text: "A CLI ainda não está autenticada. Faça login no próprio Codex.",
  },
  { errorType: "failed", text: "A resposta falhou ao executar a verificação do anexo." },
  { errorType: "interrupted", text: "A resposta foi interrompida antes de terminar." },
];

export const errorExamples = errorSamples.flatMap(({ errorType, text }) =>
  [true, false].map((retryable) =>
    message(
      `error-${errorType}-${retryable ? "retry" : "final"}`,
      "agent",
      errorType === "interrupted" ? "interrupted" : "error",
      [
        {
          id: `error-part-${errorType}-${retryable ? "retry" : "final"}`,
          type: "error",
          errorType,
          text,
          retryable,
          startedAt: 1_000,
          endedAt: 3_000,
        },
      ],
      { startedAt: 1_000, endedAt: 3_000 },
    ),
  ),
);

export const conversationStates: Conversation[] = (
  ["working", "waiting", "idle", "error"] as const
).map((state) => ({
  id: `conversation-${state}`,
  agent: "codex",
  title: "Revisar fluxo de anexos",
  cwd,
  mode: "edit",
  plan: false,
  pinnedAt: null,
  archivedAt: null,
  unreadAt: null,
  state,
  createdAt,
  updatedAt: createdAt,
}));

export const timelineMessage = message(
  "timeline-sample",
  "agent",
  "done",
  [
    {
      id: "timeline-thinking",
      type: "thinking",
      text: "Vou localizar o ponto em que o arquivo entra no composer.",
      startedAt: 1_000,
      endedAt: 4_500,
    },
    textPart("timeline-text", "A seleção do arquivo chega pelo botão de anexar.", 4_500, 7_000),
    actionPart(
      "timeline-read",
      "read",
      "ok",
      actionInputs.read,
      "Componente de anexos localizado.",
    ),
    {
      id: "timeline-permission",
      type: "permission",
      tool: "Bash",
      summary: "pnpm lint",
      options: ["allow", "always", "deny"],
      state: "pending",
      startedAt: 8_280,
      endedAt: 11_000,
    },
    {
      id: "timeline-todos",
      type: "todos",
      items: todosPart.items,
      startedAt: 9_000,
      endedAt: 9_500,
    },
  ],
  { startedAt: 1_000 },
);

export const composerAttachmentExamples: PendingComposerAttachment[] = [
  {
    id: "composer-preview-attachment",
    name: "fluxo-de-anexos.md",
    mimeType: "text/markdown",
    kind: "text",
    data: "# Fluxo\n1. Selecionar\n2. Conferir\n3. Enviar",
    sizeBytes: 84,
  },
];

export const previewConversation = {
  id: conversationId,
  agent: "codex",
  title: "Revisar fluxo de anexos",
  cwd,
} as const;

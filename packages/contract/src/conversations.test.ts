import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSchema, messagePartSchema } from "./conversations.ts";
import { events } from "./events.ts";
import { methods } from "./methods.ts";
import { parseEvent, parseRequest } from "./validate.ts";

const conversation = {
  id: "c1",
  agent: "claude",
  title: "Chat",
  cwd: "/tmp",
  mode: "edit",
  state: "idle",
  pinnedAt: null,
  archivedAt: null,
  unreadAt: null,
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T10:00:00Z",
} as const;

test("contratos da conversa validam criação, opções e resultados conhecidos do Claude", () => {
  assert.equal(methods["conversation.count"].params.safeParse({}).success, true);
  assert.equal(methods["conversation.count"].result.safeParse({ count: 2 }).success, true);
  assert.equal(methods["conversation.count"].result.safeParse({ count: -1 }).success, false);
  assert.equal(methods["conversation.deleteAll"].params.safeParse({}).success, true);
  assert.equal(methods["conversation.deleteAll"].params.safeParse({ id: "c1" }).success, false);
  assert.equal(methods["conversation.deleteAll"].result.safeParse({ deleted: 2 }).success, true);
  assert.equal(methods["conversation.deleteAll"].result.safeParse({ deleted: -1 }).success, false);
  assert.equal(
    parseEvent({ type: "event", event: "conversation.deletedAll", payload: { deleted: 2 } }).ok,
    true,
  );
  const creation = methods["conversation.create"].params.safeParse({
    agent: "claude",
    cwd: "/tmp",
  });
  assert.equal(creation.success, true);
  if (creation.success) assert.equal(creation.data.mode, "edit");
  const rename = methods["conversation.rename"].params.safeParse({
    id: "c1",
    title: "  Revisar o fluxo de acesso  ",
  });
  assert.equal(rename.success, true);
  if (rename.success) assert.equal(rename.data.title, "Revisar o fluxo de acesso");
  assert.equal(
    methods["conversation.rename"].params.safeParse({ id: "c1", title: "   " }).success,
    false,
  );
  assert.equal(
    methods["conversation.setPinned"].params.safeParse({ id: "c1", pinned: true }).success,
    true,
  );
  assert.equal(
    methods["conversation.setArchived"].params.safeParse({ id: "c1", archived: true }).success,
    true,
  );
  assert.equal(methods["conversation.markSeen"].params.safeParse({ id: "c1" }).success, true);
  assert.equal(methods["conversation.markSeen"].result.safeParse({ conversation }).success, true);
  assert.equal(
    methods["conversation.setOptions"].params.safeParse({
      id: "c1",
      options: { mode: "full", model: null, effort: "max", plan: true, fast: true },
    }).success,
    true,
  );
  assert.equal(
    methods["conversation.create"].params.safeParse({
      agent: "claude",
      cwd: "/tmp",
      plan: true,
      fast: true,
    }).success,
    true,
  );
  assert.equal(
    methods["conversation.get"].result.safeParse({
      conversation: { ...conversation, plan: true },
      messages: [],
    }).success,
    true,
  );
  const parsedConversation = conversationSchema.safeParse(conversation);
  assert.equal(parsedConversation.success, true);
  if (parsedConversation.success) assert.equal(parsedConversation.data.fast, false);
  assert.equal(
    methods["conversation.setOptions"].params.safeParse({
      id: "c1",
      options: { plan: "sim" },
    }).success,
    false,
  );
  assert.equal(
    methods["conversation.respond"].params.safeParse({
      id: "c1",
      partId: "p1",
      responseType: "permission",
      decision: "always",
    }).success,
    true,
  );
  assert.equal(
    methods["conversation.respond"].params.safeParse({
      id: "c1",
      partId: "p1",
      responseType: "permission",
      decision: "ignore",
    }).success,
    false,
  );
  assert.equal(
    methods["agent.models"].result.safeParse({
      agent: "claude",
      models: [{ id: "haiku", name: "Haiku", supportsFast: false }],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    }).success,
    true,
  );
  assert.equal(
    methods["agent.models"].result.safeParse({
      agent: "codex",
      models: [
        {
          id: "gpt-6.1-sol",
          name: "gpt-6.1-sol",
          efforts: ["low", "medium", "high"],
          defaultEffort: "medium",
          supportsFast: true,
        },
      ],
      efforts: ["low", "medium", "high"],
      fetchedAt: "2026-10-31T10:00:00Z",
    }).success,
    true,
  );
});

test("contratos guardam partes interativas ordenadas e estados explícitos", () => {
  const message = {
    id: "m1",
    conversationId: "c1",
    author: "agent",
    status: "streaming",
    startedAt: 1_798_000_000_000,
    parts: [
      {
        id: "a1",
        type: "action",
        startedAt: 1_798_000_000_000,
        endedAt: 1_798_000_000_012,
        actionType: "read",
        title: "Read README",
        input: "README.md",
        output: "Conteúdo",
        truncated: false,
        state: "ok",
        durationMs: 12,
      },
      {
        id: "a2",
        type: "action",
        actionType: "command",
        title: "mkdir -p /tmp/x",
        input: "mkdir -p /tmp/x",
        output: "",
        truncated: false,
        state: "waiting",
        durationMs: null,
      },
      {
        id: "p1",
        type: "permission",
        tool: "Bash",
        summary: "mkdir -p /tmp/x",
        description: "Crie a pasta temporária",
        options: ["allow", "always", "deny"],
        state: "pending",
      },
      {
        id: "q1",
        type: "question",
        questions: [
          { question: "Qual?", options: [{ label: "A" }], multiSelect: false, freeText: true },
        ],
        state: "pending",
      },
      { id: "plan1", type: "plan", markdown: "1. Ler", state: "pending" },
      { id: "todos1", type: "todos", items: [{ id: "1", title: "Ler", state: "working" }] },
      { id: "e1", type: "error", errorType: "interrupted", text: "Parada", retryable: true },
    ],
    createdAt: "2026-10-31T10:00:00Z",
    updatedAt: "2026-10-31T10:00:01Z",
  };
  assert.equal(
    methods["conversation.get"].result.safeParse({ conversation, messages: [message] }).success,
    true,
  );
  assert.equal(
    methods["conversation.get"].result.safeParse({
      conversation,
      messages: [
        {
          ...message,
          parts: [
            {
              id: "p1",
              type: "permission",
              tool: "Bash",
              summary: "",
              options: ["allow"],
              state: "maybe",
            },
          ],
        },
      ],
    }).success,
    false,
  );
});

test("preserva os tipos novos de ação e seus campos opcionais na leitura", () => {
  for (const actionType of ["subagent", "mcp", "image"] as const) {
    const parsed = messagePartSchema.safeParse({
      id: `a-${actionType}`,
      type: "action",
      actionType,
      title: "Ação especial",
      input: "{}",
      output: "resultado",
      truncated: false,
      state: "ok",
      durationMs: 1,
      ...(actionType === "mcp" ? { server: "docs", tool: "lookup" } : {}),
      ...(actionType === "subagent" ? { parentId: "task-parent" } : {}),
    });
    assert.equal(parsed.success, true);
    if (parsed.success && parsed.data.type === "action") {
      assert.equal(parsed.data.actionType, actionType);
      if (actionType === "mcp") {
        assert.equal(parsed.data.server, "docs");
        assert.equal(parsed.data.tool, "lookup");
      }
      if (actionType === "subagent") assert.equal(parsed.data.parentId, "task-parent");
    }
  }
});

test("eventos de texto levam só o delta; eventos de método e parte passam pela validação", () => {
  const partEvent = {
    type: "event",
    event: "conversation.partUpdated",
    payload: {
      conversationId: "c1",
      messageId: "m1",
      kind: "delta",
      partId: "text1",
      delta: "novo trecho",
      startedAt: 1_798_000_000_000,
      endedAt: 1_798_000_000_010,
    },
  };
  assert.equal(parseEvent(partEvent).ok, true);
  assert.equal(events["conversation.partUpdated"].safeParse(partEvent.payload).success, true);
  const request = parseRequest({
    type: "request",
    id: "r1",
    method: "conversation.send",
    params: { id: "c1", text: "Oi" },
  });
  assert.equal(request.ok, true);
  assert.equal(
    parseRequest({
      type: "request",
      id: "r2",
      method: "conversation.send",
      params: { id: "c1", text: "Planeje", plan: true },
    }).ok,
    true,
  );
  assert.equal(
    parseRequest({
      type: "request",
      id: "r4",
      method: "conversation.send",
      params: { id: "c1", text: "Oi", plan: false },
    }).ok,
    true,
  );
  assert.equal(
    parseRequest({
      type: "request",
      id: "r3",
      method: "conversation.send",
      params: { id: "c1", text: "Oi", plan: "sim" },
    }).ok,
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationTransitionMachine,
  isComposerReadyForConversation,
  isConversationForTarget,
  reducer,
} from "./useConversation.ts";

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map();

  setTimeout(callback, delayMs) {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + delayMs });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  tick(durationMs) {
    const end = this.now + durationMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
    }
    this.now = end;
  }
}

function createTransition(clock, statuses) {
  return new ConversationTransitionMachine({
    delayMs: 80,
    durationMs: 150,
    setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
    clearTimeout: (id) => clock.clearTimeout(id),
    prefersReducedMotion: () => false,
    onStatusChange: (status) => statuses.push(status),
  });
}

const conversation = {
  id: "conversa-1",
  title: "Teste",
  agent: "claude",
  mode: "edit",
  state: "working",
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  pinnedAt: null,
  archivedAt: null,
  unreadAt: null,
};

function stateWithStreamingMessage() {
  const message = {
    id: "mensagem-1",
    conversationId: "conversa-1",
    author: "agent",
    status: "streaming",
    parts: [],
    startedAt: 1_000,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
  };
  return {
    conversation,
    messageIds: [message.id],
    messagesById: { [message.id]: message },
    loading: false,
    hasOlderMessages: false,
    error: "",
    liveText: "",
    responseFinishedId: null,
  };
}

function historyMessage(id, timestamp) {
  return {
    id,
    conversationId: "conversa-1",
    author: "user",
    status: "done",
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("o reducer anexa páginas antigas antes da janela já aberta", () => {
  const latest = [
    historyMessage("mensagem-3", "2026-11-01T12:00:03.000Z"),
    historyMessage("mensagem-4", "2026-11-01T12:00:04.000Z"),
  ];
  const older = [
    historyMessage("mensagem-1", "2026-11-01T12:00:01.000Z"),
    historyMessage("mensagem-2", "2026-11-01T12:00:02.000Z"),
  ];
  const initial = {
    conversation: null,
    messageIds: [],
    messagesById: {},
    loading: true,
    hasOlderMessages: false,
    error: "",
    liveText: "",
    responseFinishedId: null,
  };
  const loaded = reducer(initial, {
    type: "loaded",
    conversation,
    messages: latest,
    hasOlderMessages: true,
  });
  const paged = reducer(loaded, {
    type: "olderLoaded",
    messages: older,
    hasOlderMessages: false,
  });

  assert.deepEqual(paged.messageIds, ["mensagem-1", "mensagem-2", "mensagem-3", "mensagem-4"]);
  assert.equal(paged.hasOlderMessages, false);
});

test("inicia o blur aos 80 ms e revela quando os dados da conversa chegam aos 120 ms", () => {
  const clock = new FakeClock();
  const statuses = [];
  const transition = createTransition(clock, statuses);

  transition.start();
  clock.tick(80);
  assert.deepEqual(statuses, ["waiting", "blurring"]);

  clock.tick(40);
  transition.markReady();
  assert.deepEqual(statuses, ["waiting", "blurring", "revealing"]);

  clock.tick(149);
  assert.equal(statuses.at(-1), "revealing");
  clock.tick(1);
  assert.equal(statuses.at(-1), "done");
});

test("percorre todos os estados quando a conversa nova chega após o blur", () => {
  const clock = new FakeClock();
  const statuses = [];
  const transition = createTransition(clock, statuses);

  transition.start();
  clock.tick(80);
  clock.tick(150);
  assert.deepEqual(statuses, ["waiting", "blurring", "blurred"]);

  transition.markReady();
  assert.equal(statuses.at(-1), "revealing");
  clock.tick(150);
  assert.deepEqual(statuses, ["waiting", "blurring", "blurred", "revealing", "done"]);
});

test("se a conversa nova chega antes dos 80 ms, conclui sem aplicar blur", () => {
  const clock = new FakeClock();
  const statuses = [];
  const transition = createTransition(clock, statuses);

  transition.start();
  clock.tick(79);
  transition.markReady();
  clock.tick(200);

  assert.deepEqual(statuses, ["waiting", "done"]);
});

test("o atributo entra em blurring aos 80 ms quando os dados chegam aos 92 ms", () => {
  const clock = new FakeClock();
  let attribute = null;
  const changes = [];
  const transition = new ConversationTransitionMachine({
    delayMs: 80,
    durationMs: 150,
    setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
    clearTimeout: (id) => clock.clearTimeout(id),
    prefersReducedMotion: () => false,
    onStatusChange: (status) => {
      attribute = status === "done" ? null : status;
      changes.push({ attribute, at: clock.now });
    },
  });

  transition.start();
  clock.tick(79);
  assert.equal(
    changes.some(({ attribute: value }) => value === "blurring"),
    false,
  );
  clock.tick(1);
  assert.deepEqual(changes.at(-1), { attribute: "blurring", at: 80 });
  assert.equal(attribute, "blurring");

  clock.tick(12);
  transition.markReady();
  assert.deepEqual(changes.at(-1), { attribute: "revealing", at: 92 });
});

test("reinicia os temporizadores após a limpeza do ciclo de efeitos", () => {
  const clock = new FakeClock();
  const firstStatuses = [];
  const first = createTransition(clock, firstStatuses);
  first.start();
  first.dispose();

  const secondStatuses = [];
  const second = createTransition(clock, secondStatuses);
  second.start();
  clock.tick(80);

  assert.deepEqual(secondStatuses, ["waiting", "blurring"]);
});

test("só considera pronta a conversa-alvo e os modelos do agente dela", () => {
  const previous = { ...conversation, id: "conversa-anterior", agent: "claude" };
  const target = {
    ...conversation,
    id: "conversa-alvo",
    agent: "codex",
    model: "gpt-6.1-terra",
    effort: "high",
  };

  assert.equal(isConversationForTarget(previous, target.id), false);
  assert.equal(isComposerReadyForConversation(previous, target.id, "codex"), false);
  assert.equal(isComposerReadyForConversation(target, target.id, "claude"), false);
  assert.equal(isComposerReadyForConversation(target, target.id, "codex"), true);
});

test("a conclusão ao vivo mantém startedAt e endedAt da mensagem", () => {
  const next = reducer(stateWithStreamingMessage(), {
    type: "event",
    event: {
      event: "conversation.stateChanged",
      payload: {
        conversation: { ...conversation, state: "idle" },
        messageId: "mensagem-1",
        messageStatus: "done",
        messageStartedAt: 1_000,
        messageEndedAt: 19_000,
      },
    },
  });

  const message = next.messagesById["mensagem-1"];
  assert.equal(message.status, "done");
  assert.equal(message.startedAt, 1_000);
  assert.equal(message.endedAt, 19_000);
  assert.equal(next.responseFinishedId, "mensagem-1");
});

test("um aviso de estado sem horário não apaga o horário já conhecido", () => {
  const state = stateWithStreamingMessage();
  state.messagesById["mensagem-1"] = { ...state.messagesById["mensagem-1"], endedAt: 19_000 };
  const next = reducer(state, {
    type: "event",
    event: {
      event: "conversation.stateChanged",
      payload: {
        conversation,
        messageId: "mensagem-1",
        messageStatus: "interrupted",
      },
    },
  });

  const message = next.messagesById["mensagem-1"];
  assert.equal(message.status, "interrupted");
  assert.equal(message.startedAt, 1_000);
  assert.equal(message.endedAt, 19_000);
});

test("ignora deltas já incluídos na foto ao reabrir uma resposta", () => {
  const state = stateWithStreamingMessage();
  state.messagesById["mensagem-1"] = {
    ...state.messagesById["mensagem-1"],
    parts: [{ id: "texto-1", type: "text", markdown: "hello world" }],
  };

  const next = reducer(state, {
    type: "deltas",
    deltas: [
      { messageId: "mensagem-1", partId: "texto-1", startOffset: 0, delta: "hello" },
      { messageId: "mensagem-1", partId: "texto-1", startOffset: 5, delta: " world!" },
    ],
  });

  assert.equal(next.messagesById["mensagem-1"].parts[0].markdown, "hello world!");
  assert.equal(next.liveText, "!");
});

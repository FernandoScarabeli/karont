import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_MESSAGE_WINDOW_SIZE,
  MESSAGE_WINDOW_INCREMENT,
  messageWindowSizeForTarget,
  nextMessageWindowSize,
  OLDER_MESSAGE_PAGE_SIZE,
  olderMessageCursor,
  prependOlderMessagePage,
} from "./messageWindow.ts";

function messages(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `message-${index + 1}` }));
}

test("abre com a janela recente e carrega blocos anteriores até o limite", () => {
  const allMessages = messages(300);
  assert.equal(INITIAL_MESSAGE_WINDOW_SIZE, 20);
  assert.equal(OLDER_MESSAGE_PAGE_SIZE, 10);
  assert.equal(nextMessageWindowSize(INITIAL_MESSAGE_WINDOW_SIZE, allMessages.length), 30);
  assert.equal(nextMessageWindowSize(280, allMessages.length), 290);
  assert.equal(nextMessageWindowSize(290, allMessages.length), 300);
  assert.equal(nextMessageWindowSize(300, allMessages.length), 300);
});

test("expande a janela até uma mensagem antiga escolhida no histórico", () => {
  const allMessages = messages(300);
  assert.equal(
    messageWindowSizeForTarget(allMessages, INITIAL_MESSAGE_WINDOW_SIZE, "message-21"),
    280,
  );
  assert.equal(messageWindowSizeForTarget(allMessages, 280, "message-21"), 280);
  assert.equal(messageWindowSizeForTarget(allMessages, 40, "missing"), 40);
  assert.equal(MESSAGE_WINDOW_INCREMENT, 10);
});

test("usa a primeira mensagem como cursor e encerra no início da lista", () => {
  const current = messages(2);
  assert.equal(olderMessageCursor(current, true), "message-1");
  assert.equal(olderMessageCursor(current, false), null);
  assert.equal(olderMessageCursor([], true), null);
});

test("anexa uma página antiga sem duplicar mensagens e para sem progresso", () => {
  const current = [{ id: "message-3" }, { id: "message-4" }];
  const olderPage = [{ id: "message-1" }, { id: "message-2" }, current[0]];
  const page = prependOlderMessagePage(current, olderPage, true);

  assert.deepEqual(
    page.messages.map(({ id }) => id),
    ["message-1", "message-2", "message-3", "message-4"],
  );
  assert.deepEqual(
    page.newMessages.map(({ id }) => id),
    ["message-1", "message-2"],
  );
  assert.equal(page.hasOlderMessages, true);

  const repeated = prependOlderMessagePage(page.messages, olderPage, true);
  assert.deepEqual(repeated.messages, page.messages);
  assert.deepEqual(repeated.newMessages, []);
  assert.equal(repeated.hasOlderMessages, false);
});

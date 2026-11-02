import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_MESSAGE_WINDOW_SIZE,
  MESSAGE_WINDOW_INCREMENT,
  messageWindowSizeForTarget,
  nextMessageWindowSize,
} from "./messageWindow.ts";

function messages(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `message-${index + 1}` }));
}

test("abre com a janela recente e carrega blocos anteriores até o limite", () => {
  const allMessages = messages(300);
  assert.equal(INITIAL_MESSAGE_WINDOW_SIZE, 40);
  assert.equal(nextMessageWindowSize(INITIAL_MESSAGE_WINDOW_SIZE, allMessages.length), 80);
  assert.equal(nextMessageWindowSize(280, allMessages.length), 300);
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
  assert.equal(MESSAGE_WINDOW_INCREMENT, 40);
});

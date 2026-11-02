import assert from "node:assert/strict";
import test from "node:test";
import { areMessageListPropsEqual } from "./messageListMemo.ts";

test("mudanças locais do composer não invalidam props estáveis da lista memoizada", () => {
  const messages = [{ id: "message-1" }];
  const onCopy = () => undefined;
  const props = { messages, onCopy, loading: false, highlightId: null };

  assert.equal(areMessageListPropsEqual(props, { ...props }), true);
  assert.equal(areMessageListPropsEqual(props, { ...props, messages: [...messages] }), false);
  assert.equal(areMessageListPropsEqual(props, { ...props, highlightId: "message-1" }), false);
});

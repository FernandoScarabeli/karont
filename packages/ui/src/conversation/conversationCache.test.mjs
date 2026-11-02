import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedMemoryCache,
  cacheActiveConversationSnapshot,
  cacheConversationSnapshot,
  cacheGitInfo,
  conversationCacheLimits,
  getActiveConversationSnapshot,
  getCachedGitInfo,
  getConversationSnapshot,
  invalidateCachedGitInfo,
} from "./conversationCache.ts";

test("mantém o limite e preserva as conversas usadas mais recentemente", () => {
  const cache = new BoundedMemoryCache(conversationCacheLimits.conversations);

  for (let index = 0; index < conversationCacheLimits.conversations; index += 1) {
    cache.set(`conversa-${index}`, index);
  }
  assert.equal(cache.get("conversa-0"), 0);
  cache.set("conversa-nova", 21);

  assert.equal(cache.size, conversationCacheLimits.conversations);
  assert.equal(cache.get("conversa-1"), undefined);
  assert.equal(cache.get("conversa-0"), 0);
  assert.equal(cache.get("conversa-nova"), 21);
});

test("permite invalidar uma pasta e limpar o cache", () => {
  const cache = new BoundedMemoryCache(2);
  cache.set("/projeto", { branch: "main", detached: false });
  cache.set("/outro", { branch: null, detached: false });

  assert.equal(cache.delete("/projeto"), true);
  assert.equal(cache.get("/projeto"), undefined);
  assert.equal(cache.delete("/projeto"), false);
  cache.clear();
  assert.equal(cache.size, 0);

  const path = "/projeto-teste-cache-invalido";
  cacheGitInfo(path, { branch: "main", detached: false });
  assert.deepEqual(getCachedGitInfo(path), { branch: "main", detached: false });
  invalidateCachedGitInfo(path);
  assert.equal(getCachedGitInfo(path), undefined);
});

test("limita as mensagens mantidas em cada snapshot de conversa", () => {
  const messages = Array.from({ length: 125 }, (_, index) => ({ id: `message-${index}` }));
  cacheConversationSnapshot({
    conversation: { id: "conversation-cache-bound" },
    messages,
    hasOlderMessages: false,
  });

  const snapshot = getConversationSnapshot("conversation-cache-bound");
  assert.equal(snapshot.messages.length, conversationCacheLimits.messagesPerConversation);
  assert.equal(snapshot.messages[0].id, "message-5");
  assert.equal(snapshot.hasOlderMessages, true);
});

test("preserva o snapshot ativo quando ele sai do cache limitado", () => {
  const active = {
    conversation: { id: "conversation-active-snapshot" },
    messages: [{ id: "message-active-snapshot" }],
    hasOlderMessages: false,
  };
  cacheConversationSnapshot(active);
  cacheActiveConversationSnapshot(active);

  for (let index = 0; index <= conversationCacheLimits.conversations; index += 1) {
    cacheConversationSnapshot({
      conversation: { id: `conversation-eviction-${index}` },
      messages: [],
      hasOlderMessages: false,
    });
  }

  assert.equal(getConversationSnapshot(active.conversation.id), undefined);
  assert.deepEqual(getActiveConversationSnapshot(), active);
});

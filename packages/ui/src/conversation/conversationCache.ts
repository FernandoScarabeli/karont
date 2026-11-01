import type { Conversation, ConversationMessage } from "@karont/contract";
import type { AgentModels } from "./ComposerPreferences.tsx";

export type ConversationSnapshot = {
  conversation: Conversation;
  messages: ConversationMessage[];
};

export type CachedGitInfo = { branch: string | null; detached: boolean };

export const conversationCacheLimits = {
  conversations: 20,
  agents: 4,
  folders: 20,
} as const;

export class BoundedMemoryCache<Key, Value> {
  private readonly entries = new Map<Key, Value>();
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("O limite do cache precisa ser um inteiro positivo.");
    }
    this.limit = limit;
  }

  get(key: Key): Value | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
  }

  delete(key: Key): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const conversations = new BoundedMemoryCache<string, ConversationSnapshot>(
  conversationCacheLimits.conversations,
);
const agentModels = new BoundedMemoryCache<AgentModels["agent"], AgentModels>(
  conversationCacheLimits.agents,
);
const gitInfoByPath = new BoundedMemoryCache<string, CachedGitInfo>(
  conversationCacheLimits.folders,
);

export function getConversationSnapshot(id: string): ConversationSnapshot | undefined {
  return conversations.get(id);
}

export function cacheConversationSnapshot(snapshot: ConversationSnapshot): void {
  conversations.set(snapshot.conversation.id, snapshot);
}

export function getCachedAgentModels(agent: AgentModels["agent"]): AgentModels | undefined {
  return agentModels.get(agent);
}

export function cacheAgentModels(models: AgentModels): void {
  agentModels.set(models.agent, models);
}

export function getCachedGitInfo(path: string): CachedGitInfo | undefined {
  return gitInfoByPath.get(path);
}

export function cacheGitInfo(path: string, info: CachedGitInfo): void {
  gitInfoByPath.set(path, info);
}

export function invalidateCachedGitInfo(path: string): void {
  gitInfoByPath.delete(path);
}

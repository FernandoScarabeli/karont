import type { DatabaseSync } from "node:sqlite";
import {
  type Conversation,
  type InboxItem,
  type InboxList,
  MAX_INBOX_ITEMS,
  type MessagePart,
} from "@karont/contract";
import {
  getConversation,
  getErrorDismissedMessageId,
  getLastAgentMessage,
  listConversationsInState,
} from "./db.ts";

export type PendingPart = Extract<MessagePart, { type: "permission" | "question" | "plan" }> & {
  state: "pending";
};

/** Pendência que o processo do agente ainda pode receber; quem sabe disso é o `ConversationManager`. */
export type LivePendingPart = { conversationId: string; messageId: string; part: PendingPart };

function isoFromEpoch(epochMs: number | undefined, fallback: string): string {
  return epochMs === undefined ? fallback : new Date(epochMs).toISOString();
}

function base(conversation: Conversation, messageId: string, partId: string, createdAt: string) {
  return {
    conversationId: conversation.id,
    messageId,
    partId,
    workspaceId: conversation.workspaceId,
    ...(conversation.projectId ? { projectId: conversation.projectId } : {}),
    conversationTitle: conversation.title,
    agent: conversation.agent,
    createdAt,
  };
}

/**
 * A caixa de entrada é derivada, nunca guardada: permissões, perguntas e planos vêm das partes
 * pendentes vivas (o processo do agente ainda responde) de conversas em `waiting`; erros vêm da
 * última resposta de conversas em `error`, menos a que o usuário dispensou. Depois de um reinício
 * do serviço as conversas voltam a `idle` e não há processo vivo, então só sobram os erros.
 */
export function buildInbox(db: DatabaseSync, live: LivePendingPart[]): InboxList {
  const items: InboxItem[] = [];
  const conversations = new Map<string, Conversation | null>();
  const conversationOf = (id: string) => {
    if (!conversations.has(id)) conversations.set(id, getConversation(db, id));
    return conversations.get(id) ?? null;
  };

  for (const { conversationId, messageId, part } of live) {
    const conversation = conversationOf(conversationId);
    if (!conversation || conversation.archivedAt || conversation.state !== "waiting") continue;
    const createdAt = isoFromEpoch(part.startedAt, conversation.updatedAt);
    const common = base(conversation, messageId, part.id, createdAt);
    if (part.type === "permission") {
      items.push({ ...common, id: `permission:${part.id}`, kind: "permission", part });
    } else if (part.type === "question") {
      items.push({ ...common, id: `question:${part.id}`, kind: "question", part });
    } else {
      items.push({ ...common, id: `plan:${part.id}`, kind: "plan", part });
    }
  }

  for (const conversation of listConversationsInState(db, "error")) {
    const message = getLastAgentMessage(db, conversation.id);
    if (message?.status !== "error") continue;
    if (getErrorDismissedMessageId(db, conversation.id) === message.id) continue;
    const part = [...message.parts].reverse().find((item) => item.type === "error");
    if (part?.type !== "error") continue;
    items.push({
      ...base(conversation, message.id, part.id, isoFromEpoch(part.startedAt, message.updatedAt)),
      id: `error:${message.id}`,
      kind: "error",
      part,
    });
  }

  // Ordenação estável: mais antigos primeiro; empates mantêm a ordem de chegada.
  items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { items: items.slice(0, MAX_INBOX_ITEMS), total: items.length };
}

/**
 * Avisa quando a lista muda de verdade. `schedule()` só marca; o recálculo roda uma vez por
 * ciclo do laço de eventos, então rajadas viram, no máximo, um aviso. Lista igual à última
 * emitida não emite.
 */
export class InboxPublisher {
  readonly #compute: () => InboxList;
  readonly #emit: (list: InboxList) => void;
  #last: string;
  #scheduled: NodeJS.Immediate | undefined;

  constructor(compute: () => InboxList, emit: (list: InboxList) => void) {
    this.#compute = compute;
    this.#emit = emit;
    this.#last = JSON.stringify(compute());
  }

  schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = setImmediate(() => {
      this.#scheduled = undefined;
      this.flush();
    });
    this.#scheduled.unref();
  }

  flush(): void {
    let list: InboxList;
    try {
      list = this.#compute();
    } catch {
      return; // Banco fechado no desligamento: nada a avisar.
    }
    const serialized = JSON.stringify(list);
    if (serialized === this.#last) return;
    this.#last = serialized;
    this.#emit(list);
  }

  dispose(): void {
    if (this.#scheduled) clearImmediate(this.#scheduled);
    this.#scheduled = undefined;
  }
}

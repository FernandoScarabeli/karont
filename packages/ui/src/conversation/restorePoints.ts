import type { AnyEvent, KarontBridge, RestorePointSummary } from "@karont/contract";
import { t } from "../i18n/pt-BR.ts";

/** Aviso que vale uma vez por conversa, no ponto mais antigo com aquele motivo. */
export type RestoreNotice = "no-git" | "home";

/** O que uma linha de mensagem precisa saber; o objeto só muda quando algo dela muda. */
export type RestoreRowView = {
  point: RestorePointSummary | null;
  notice: RestoreNotice | null;
};

export const EMPTY_RESTORE_VIEW: RestoreRowView = Object.freeze({ point: null, notice: null });

type ConversationEntry = {
  /** Do mais antigo para o mais novo: a ordem da lista, depois a de chegada dos eventos. */
  order: string[];
  points: Map<string, RestorePointSummary>;
  views: Map<string, RestoreRowView>;
  /** Mensagens que já tiveram evento: uma lista atrasada não as sobrescreve. */
  fromEvent: Set<string>;
  listRequested: boolean;
  listeners: Map<string, Set<() => void>>;
};

export type RestoreStore = {
  /** Assina uma mensagem; a primeira assinatura da conversa carrega `restore.list`. */
  subscribe(conversationId: string, messageId: string, listener: () => void): () => void;
  getView(conversationId: string, messageId: string): RestoreRowView;
};

type BridgeSource = () => Pick<KarontBridge, "request" | "onEvent"> | null;

export function createRestoreStore(getBridge: BridgeSource): RestoreStore {
  const entries = new Map<string, ConversationEntry>();
  let connected = false;

  function entryFor(conversationId: string): ConversationEntry {
    let entry = entries.get(conversationId);
    if (!entry) {
      entry = {
        order: [],
        points: new Map(),
        views: new Map(),
        fromEvent: new Set(),
        listRequested: false,
        listeners: new Map(),
      };
      entries.set(conversationId, entry);
    }
    return entry;
  }

  /** Recalcula as visões e avisa só as mensagens cuja visão mudou. */
  function refresh(entry: ConversationEntry) {
    const oldestByReason = new Map<RestoreNotice, string>();
    for (const id of entry.order) {
      const point = entry.points.get(id);
      if (point?.state !== "unavailable") continue;
      if (point.reason !== "no-git" && point.reason !== "home") continue;
      if (!oldestByReason.has(point.reason)) oldestByReason.set(point.reason, id);
    }
    const changed: string[] = [];
    for (const id of entry.order) {
      const point = entry.points.get(id) ?? null;
      let notice: RestoreNotice | null = null;
      if (oldestByReason.get("no-git") === id) notice = "no-git";
      else if (oldestByReason.get("home") === id) notice = "home";
      const previous = entry.views.get(id);
      if (previous && previous.point === point && previous.notice === notice) continue;
      entry.views.set(id, { point, notice });
      changed.push(id);
    }
    for (const id of changed) {
      for (const listener of entry.listeners.get(id) ?? []) listener();
    }
  }

  function applyEvent(conversationId: string, point: RestorePointSummary) {
    const entry = entries.get(conversationId);
    if (!entry) return;
    entry.fromEvent.add(point.messageId);
    if (!entry.points.has(point.messageId)) entry.order.push(point.messageId);
    entry.points.set(point.messageId, point);
    refresh(entry);
  }

  function applyList(conversationId: string, points: RestorePointSummary[]) {
    const entry = entries.get(conversationId);
    if (!entry) return;
    const listed = new Set(points.map((point) => point.messageId));
    // A lista manda na ordem; o que só chegou por evento (mais novo) vem depois dela.
    const eventOnly = entry.order.filter((id) => !listed.has(id));
    entry.order = [...points.map((point) => point.messageId), ...eventOnly];
    for (const point of points) {
      if (entry.fromEvent.has(point.messageId)) continue;
      entry.points.set(point.messageId, point);
    }
    refresh(entry);
  }

  function connect() {
    if (connected) return;
    const bridge = getBridge();
    if (!bridge) return;
    connected = true;
    bridge.onEvent((event: AnyEvent) => {
      if (event.event !== "restore.changed") return;
      applyEvent(event.payload.conversationId, event.payload.point);
    });
  }

  function loadList(conversationId: string, entry: ConversationEntry) {
    if (entry.listRequested) return;
    const bridge = getBridge();
    if (!bridge) return;
    entry.listRequested = true;
    bridge
      .request("restore.list", { conversationId })
      .then((result) => applyList(conversationId, result.points))
      .catch(() => {
        // Sem a lista a linha simplesmente não aparece; tenta de novo na próxima assinatura.
        entry.listRequested = false;
      });
  }

  return {
    subscribe(conversationId, messageId, listener) {
      const entry = entryFor(conversationId);
      let listeners = entry.listeners.get(messageId);
      if (!listeners) {
        listeners = new Set();
        entry.listeners.set(messageId, listeners);
      }
      listeners.add(listener);
      connect();
      loadList(conversationId, entry);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) entry.listeners.delete(messageId);
      };
    },
    getView(conversationId, messageId) {
      return entries.get(conversationId)?.views.get(messageId) ?? EMPTY_RESTORE_VIEW;
    },
  };
}

/** O que a linha mostra; `null` quando não há nada a dizer. */
export type RestoreSummaryModel =
  | { kind: "changes"; text: string; canUndo: true }
  | { kind: "undone"; text: string }
  | { kind: "message"; text: string };

export function restoreFilesLabel(count: number): string {
  return t.restore.filesChanged(count);
}

export function restoreSummaryModel(view: RestoreRowView): RestoreSummaryModel | null {
  const point = view.point;
  if (!point) return null;
  switch (point.state) {
    case "ready":
      return point.changedFiles > 0
        ? { kind: "changes", text: restoreFilesLabel(point.changedFiles), canUndo: true }
        : null;
    case "undone":
      return { kind: "undone", text: t.restore.undone };
    case "incomplete":
      return { kind: "message", text: t.restore.incomplete };
    case "unavailable":
      if (point.reason === "no-git" || point.reason === "home") {
        if (view.notice !== point.reason) return null;
        return {
          kind: "message",
          text: point.reason === "no-git" ? t.restore.noGit : t.restore.home,
        };
      }
      return { kind: "message", text: t.restore.unavailable };
  }
}

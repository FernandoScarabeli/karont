import { useSyncExternalStore } from "react";

/**
 * Estado de tela do "Ver mudanças" por conversa: qual mensagem tem o painel aberto e se a
 * conversa está ocupada (o que desabilita o Desfazer). Fica fora das props da lista de
 * mensagens, que é memoizada.
 */
type PanelState = { openMessageId: string | null; busy: boolean };

const CLOSED: PanelState = { openMessageId: null, busy: false };
const states = new Map<string, PanelState>();
const listeners = new Map<string, Set<() => void>>();

function read(conversationId: string): PanelState {
  return states.get(conversationId) ?? CLOSED;
}

function write(conversationId: string, next: PanelState) {
  const current = read(conversationId);
  if (current.openMessageId === next.openMessageId && current.busy === next.busy) return;
  if (next.openMessageId === null && !next.busy) states.delete(conversationId);
  else states.set(conversationId, next);
  for (const listener of listeners.get(conversationId) ?? []) listener();
}

export function openRestorePanel(conversationId: string, messageId: string) {
  write(conversationId, { ...read(conversationId), openMessageId: messageId });
}

export function closeRestorePanel(conversationId: string) {
  write(conversationId, { ...read(conversationId), openMessageId: null });
}

export function setRestoreBusy(conversationId: string, busy: boolean) {
  write(conversationId, { ...read(conversationId), busy });
}

function subscribe(conversationId: string, listener: () => void) {
  let set = listeners.get(conversationId);
  if (!set) {
    set = new Set();
    listeners.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(conversationId);
  };
}

/** Mensagem com o painel aberto nesta conversa, ou `null`. */
export function useRestorePanelMessage(conversationId: string): string | null {
  return useSyncExternalStore(
    (listener) => subscribe(conversationId, listener),
    () => read(conversationId).openMessageId,
    () => null,
  );
}

export function useRestoreBusy(conversationId: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribe(conversationId, listener),
    () => read(conversationId).busy,
    () => false,
  );
}

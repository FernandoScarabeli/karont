import { useCallback, useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { createRestoreStore, type RestoreRowView } from "./restorePoints.ts";

const store = createRestoreStore(getBridge);

/**
 * Ponto de restauração de uma mensagem. A primeira linha de uma conversa carrega a lista;
 * depois só `restore.changed` atualiza, e só a linha daquela mensagem re-renderiza.
 */
export function useRestorePoint(conversationId: string, messageId: string): RestoreRowView {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(conversationId, messageId, listener),
    [conversationId, messageId],
  );
  const getSnapshot = useCallback(
    () => store.getView(conversationId, messageId),
    [conversationId, messageId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

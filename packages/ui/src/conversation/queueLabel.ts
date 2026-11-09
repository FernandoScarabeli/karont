import type { ResultOf } from "@karont/contract";
import { t } from "../i18n/pt-BR.ts";

type QueueStatus = ResultOf<"queue.status">;

/** Texto do aviso de fila; sem status ou sem agentes rodando, só "Na fila". */
export function queueLabel(
  status: Pick<QueueStatus, "running" | "queuedConversationIds"> | null,
  conversationId: string,
): string {
  const index = status ? status.queuedConversationIds.indexOf(conversationId) : -1;
  const position = index > 0 ? index + 1 : 1;
  return t.chat.queueLabel(position, status?.running ?? 0);
}

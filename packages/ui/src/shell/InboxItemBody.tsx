import type { InboxItem } from "@karont/contract";
import {
  PermissionPart,
  PlanPart,
  QuestionPart,
  type ResponseInput,
} from "../conversation/ConversationParts.tsx";

/**
 * Corpo dos itens que o chat também mostra. Fica num arquivo à parte, carregado sob demanda,
 * porque `ConversationParts` é grande e não deve entrar no bundle inicial.
 */
export function InboxItemBody({
  item,
  onRespond,
  onAdjust,
}: {
  item: Exclude<InboxItem, { kind: "error" }>;
  onRespond: (response: ResponseInput) => Promise<void>;
  onAdjust: () => void;
}) {
  switch (item.kind) {
    case "permission":
      return <PermissionPart cwd="" onRespond={onRespond} part={item.part} />;
    case "question":
      return <QuestionPart onRespond={onRespond} part={item.part} />;
    case "plan":
      return <PlanPart onAdjust={onAdjust} onRespond={onRespond} part={item.part} />;
  }
}

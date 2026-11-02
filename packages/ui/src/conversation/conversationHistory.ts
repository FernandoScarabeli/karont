import type { ConversationMessage } from "@karont/contract";

export type ConversationHistoryEntry = {
  message: ConversationMessage;
  preview: string;
};

export function getConversationHistory(
  messages: readonly ConversationMessage[],
): ConversationHistoryEntry[] {
  return messages
    .map((message, sourceIndex) => ({ message, sourceIndex }))
    .filter(({ message }) => message.author === "user")
    .sort((a, b) => {
      const timeDifference = Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt);
      return timeDifference || a.sourceIndex - b.sourceIndex;
    })
    .flatMap(({ message }) => {
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.markdown : ""))
        .join("\n")
        .trim();
      const preview =
        text || message.attachments?.map((attachment) => attachment.name).join(" · ") || "";
      return preview ? [{ message, preview }] : [];
    });
}

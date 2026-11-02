import type { ConversationMessage } from "@karont/contract";

export const INITIAL_MESSAGE_WINDOW_SIZE = 20;
export const OLDER_MESSAGE_PAGE_SIZE = 10;
export const MESSAGE_WINDOW_INCREMENT = 10;
export const OLDER_MESSAGE_LOAD_ROOT_MARGIN_PX = 320;

export function isWithinOlderMessageLoadMargin(
  sentinel: Pick<DOMRect, "top" | "bottom">,
  root: Pick<DOMRect, "top" | "bottom">,
): boolean {
  return (
    sentinel.bottom >= root.top - OLDER_MESSAGE_LOAD_ROOT_MARGIN_PX && sentinel.top <= root.bottom
  );
}

export function olderMessageCursor(
  messages: readonly ConversationMessage[],
  hasOlderMessages: boolean,
): string | null {
  return hasOlderMessages ? (messages[0]?.id ?? null) : null;
}

export function prependOlderMessagePage(
  current: readonly ConversationMessage[],
  page: readonly ConversationMessage[],
  hasOlderMessages: boolean,
): {
  messages: ConversationMessage[];
  newMessages: ConversationMessage[];
  hasOlderMessages: boolean;
} {
  const knownIds = new Set(current.map((message) => message.id));
  const newMessages: ConversationMessage[] = [];

  for (const message of page) {
    if (knownIds.has(message.id)) continue;
    knownIds.add(message.id);
    newMessages.push(message);
  }

  return {
    messages: [...newMessages, ...current],
    newMessages,
    hasOlderMessages: hasOlderMessages && newMessages.length > 0,
  };
}

export function nextMessageWindowSize(
  currentSize: number,
  totalMessages: number,
  increment = MESSAGE_WINDOW_INCREMENT,
): number {
  return Math.min(totalMessages, Math.max(0, currentSize) + increment);
}

export function messageWindowSizeForTarget(
  messages: readonly ConversationMessage[],
  currentSize: number,
  messageId: string,
): number {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return currentSize;
  return Math.max(currentSize, messages.length - messageIndex);
}

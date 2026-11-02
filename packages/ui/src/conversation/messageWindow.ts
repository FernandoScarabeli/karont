import type { ConversationMessage } from "@karont/contract";

export const INITIAL_MESSAGE_WINDOW_SIZE = 40;
export const MESSAGE_WINDOW_INCREMENT = 40;

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

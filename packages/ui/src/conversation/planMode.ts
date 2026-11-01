const activeConversationIds = new Set<string>();

function storageKey(conversationId: string): string {
  return `karont.conversation.planMode.${conversationId}`;
}

export function isConversationPlanModeActive(conversationId: string): boolean {
  try {
    const active = window.localStorage.getItem(storageKey(conversationId)) === "on";
    if (active) {
      activeConversationIds.add(conversationId);
    } else {
      activeConversationIds.delete(conversationId);
    }
    return active;
  } catch {
    return activeConversationIds.has(conversationId);
  }
}

export function setConversationPlanModeActive(conversationId: string, active: boolean): void {
  if (active) {
    activeConversationIds.add(conversationId);
  } else {
    activeConversationIds.delete(conversationId);
  }
  try {
    const key = storageKey(conversationId);
    if (active) {
      window.localStorage.setItem(key, "on");
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Keep the mode available in memory when browser storage is disabled.
  }
}

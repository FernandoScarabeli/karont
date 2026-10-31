export type CloseBehavior = "ask" | "background" | "quit";
export type CloseAction = CloseBehavior | "close";

export function decideOnClose({
  stored,
  quitting,
}: {
  stored: unknown;
  quitting: boolean;
}): CloseAction {
  if (quitting) return "close";
  return isCloseBehavior(stored) ? stored : "ask";
}

export function applyDialogResult({
  response,
  checkboxChecked,
}: {
  response: number;
  checkboxChecked: boolean;
}): { action: "background" | "quit" | "cancel"; preference: "background" | "quit" | null } {
  if (response === 0) {
    return { action: "background", preference: checkboxChecked ? "background" : null };
  }
  if (response === 1) {
    return { action: "quit", preference: checkboxChecked ? "quit" : null };
  }
  return { action: "cancel", preference: null };
}

export async function readStoredCloseBehavior(
  read: () => Promise<unknown>,
  timeoutMs = 1_000,
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === "ask" || value === "background" || value === "quit";
}

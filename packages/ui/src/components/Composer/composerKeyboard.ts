export type ComposerAutocompleteKeyAction = "up" | "down" | "select" | "close";

export function composerAutocompleteKeyAction(
  key: string,
  open: boolean,
): ComposerAutocompleteKeyAction | null {
  if (!open) return null;
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "Enter" || key === "Tab") return "select";
  if (key === "Escape") return "close";
  return null;
}

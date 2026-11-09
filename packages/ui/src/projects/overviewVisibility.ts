import type { LayoutNode } from "../workspace/layout.ts";

/** "show" mostra a tela do workspace por cima dos painéis; "hide" mantém a nova conversa limpa. */
export type OverviewOverride = "show" | "hide";

/** Há conversa ou terminal aberto em algum painel? */
export function hasOpenContent(layout: LayoutNode): boolean {
  if (layout.type === "pane") return layout.view.kind !== "new-conversation";
  return layout.children.some(hasOpenContent);
}

/** Sem escolha explícita, a tela aparece quando a aba não tem conversa nem terminal. */
export function isOverviewVisible(hasContent: boolean, override: OverviewOverride | undefined) {
  if (override) return override === "show";
  return !hasContent;
}

/** Clique na aba em que já se está: com conversas abertas, alterna; sem elas, mostra a tela. */
export function overrideAfterActiveTabClick(
  hasContent: boolean,
  visible: boolean,
): OverviewOverride | undefined {
  return visible && hasContent ? undefined : "show";
}

/** Fechar painéis tira a escolha explícita, exceto se não havia nem há conteúdo (só painéis vazios). */
export function shouldClearOverrideOnLayoutChange(hadContent: boolean, hasContent: boolean) {
  return hadContent || hasContent;
}

/** Lógica pura da caixa de entrada: sem React nem ponte. */

/** Uma lista pedida antes de um evento mais novo não vale mais. */
export function isStaleListResponse(requestedVersion: number, currentVersion: number): boolean {
  return requestedVersion !== currentVersion;
}

/**
 * Para onde vai o foco quando o item que tinha o foco sai da lista: o próximo item que continua
 * lá; se não houver, o anterior; se a lista esvaziou, `null` (o título da lista).
 */
export function focusAfterRemoval(
  previousIds: readonly string[],
  currentIds: readonly string[],
  focusedId: string,
): string | null {
  if (currentIds.includes(focusedId)) return focusedId;
  const index = previousIds.indexOf(focusedId);
  if (index < 0) return currentIds[0] ?? null;
  const remaining = new Set(currentIds);
  for (let next = index + 1; next < previousIds.length; next += 1) {
    const id = previousIds[next];
    if (id !== undefined && remaining.has(id)) return id;
  }
  for (let before = index - 1; before >= 0; before -= 1) {
    const id = previousIds[before];
    if (id !== undefined && remaining.has(id)) return id;
  }
  return null;
}

/** Quantos itens existem além dos que a lista traz. */
export function inboxRemainder(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

export const BACKOFF_BASE_MS = 100;
export const BACKOFF_MAX_MS = 10_000;

export function backoffDelay(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError("A tentativa de backoff precisa ser um inteiro não negativo.");
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.min(attempt, 53), BACKOFF_MAX_MS);
}

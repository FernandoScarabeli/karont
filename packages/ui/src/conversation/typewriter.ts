// Ritmo da máquina de escrever para o texto que chega em fluxo. Funções puras,
// sem React, para o loop de quadros poder ser testado isoladamente.

// Drenagem depois de done: o atraso restante escoa em cerca de 1,2 s. Se o atraso
// for grande, o ritmo sobe em vez de o tempo crescer.
export const DRAIN_MS = 1200;

const BASE_CHARS_PER_SECOND = 75;
// Até ~3 s de atraso (3 × 75 caracteres) o ritmo fica no base.
const FREE_LAG_CHARS = 225;
const CHARS_PER_SECOND_PER_EXTRA_CHAR = 0.6;
const MAX_CHARS_PER_SECOND = 400;
const MIN_DRAIN_MS = 16;
// Constante de tempo da suavização do ritmo. Mudanças de velocidade não são bruscas.
const RATE_SMOOTHING_MS = 300;

export { BASE_CHARS_PER_SECOND };

// Ritmo alvo para o atraso atual: base, e acelera devagar só depois de FREE_LAG_CHARS.
export function getCharsPerSecond(backlogChars: number): number {
  const extra = Math.max(0, backlogChars - FREE_LAG_CHARS);
  return Math.min(
    MAX_CHARS_PER_SECOND,
    BASE_CHARS_PER_SECOND + extra * CHARS_PER_SECOND_PER_EXTRA_CHAR,
  );
}

// Aproxima `current` de `target` com suavização exponencial (constante de tempo de
// 300 ms). A velocidade muda gradualmente.
export function smoothRate(current: number, target: number, elapsedMs: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / RATE_SMOOTHING_MS);
  return current + (target - current) * alpha;
}

export type CharReleaseInput = {
  backlogChars: number;
  elapsedMs: number;
  done?: boolean;
  carryChars?: number;
  drainMsLeft?: number;
  rateCps?: number;
};

export type CharReleasePlan = {
  count: number;
  carryChars: number;
  drainMsLeft: number;
  rateCps: number;
};

// Quantos caracteres liberar neste quadro. A parte fracionária vai para carryChars
// e a velocidade suavizada volta em rateCps. Depois de done, a drenagem não é
// suavizada: ela tem prazo e precisa terminar.
export function planCharRelease({
  backlogChars,
  elapsedMs,
  done = false,
  carryChars = 0,
  drainMsLeft = DRAIN_MS,
  rateCps = BASE_CHARS_PER_SECOND,
}: CharReleaseInput): CharReleasePlan {
  if (backlogChars <= 0) {
    return { count: 0, carryChars: 0, drainMsLeft: DRAIN_MS, rateCps };
  }

  const elapsed = Math.max(0, elapsedMs);
  const target = getCharsPerSecond(backlogChars);
  const rate = done
    ? Math.max(target, (backlogChars * 1000) / Math.max(drainMsLeft, MIN_DRAIN_MS))
    : smoothRate(rateCps, target, elapsed);
  const accumulated = carryChars + (rate * elapsed) / 1000;
  const count = Math.min(backlogChars, Math.floor(accumulated));

  return {
    count,
    carryChars: count === backlogChars ? 0 : accumulated - count,
    drainMsLeft: done ? Math.max(0, drainMsLeft - elapsed) : DRAIN_MS,
    rateCps: rate,
  };
}

// Maior comprimento que o texto revelado pode ter. Enquanto o texto chega, uma
// linha de abertura de cerca (```lang ou ~~~) incompleta fica de fora até a
// quebra de linha, para o cursor nunca parar dentro dela.
export function getRevealCeiling(text: string, done = false): number {
  if (done) return text.length;
  const lineStart = text.lastIndexOf("\n") + 1;
  const tail = text.slice(lineStart);
  if (/^ {0,3}(?:`{1,2}|~{1,2})$/u.test(tail) || /^ {0,3}(?:`{3,}|~{3,})/u.test(tail)) {
    return lineStart;
  }
  return text.length;
}

// Nunca corta um par substituto (emoji fora do BMP) no meio.
export function alignRevealEnd(text: string, end: number): number {
  const clamped = Math.min(Math.max(0, end), text.length);
  if (clamped === 0 || clamped === text.length) return clamped;
  const lastUnit = text.charCodeAt(clamped - 1);
  const isHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return isHighSurrogate ? clamped + 1 : clamped;
}

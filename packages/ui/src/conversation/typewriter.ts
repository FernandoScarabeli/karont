// Ritmo da máquina de escrever para o texto que chega em fluxo. Funções puras,
// sem React, para o loop de quadros poder ser testado isoladamente.

export const DRAIN_MS = 350;
// Tempo do fade do cursor depois de done. Deve bater com --k-duration-caret-fade.
export const CARET_FADE_MS = 240;

const BASE_CHARS_PER_SECOND = 220;
const CHARS_PER_SECOND_PER_BACKLOG_CHAR = 1.5;
const MAX_CHARS_PER_SECOND = 1200;
const MIN_DRAIN_MS = 16;

// Ritmo adaptativo: sobe com o atraso acumulado, para o texto revelado não ficar
// muito atrás do que já chegou.
export function getCharsPerSecond(backlogChars: number): number {
  return Math.min(
    MAX_CHARS_PER_SECOND,
    BASE_CHARS_PER_SECOND + Math.max(0, backlogChars) * CHARS_PER_SECOND_PER_BACKLOG_CHAR,
  );
}

export type CharReleaseInput = {
  backlogChars: number;
  elapsedMs: number;
  done?: boolean;
  carryChars?: number;
  drainMsLeft?: number;
};

export type CharReleasePlan = {
  count: number;
  carryChars: number;
  drainMsLeft: number;
};

// Quantos caracteres liberar neste quadro. A parte fracionária é guardada em
// carryChars. Depois de done, o atraso escoa linearmente até drainMsLeft.
export function planCharRelease({
  backlogChars,
  elapsedMs,
  done = false,
  carryChars = 0,
  drainMsLeft = DRAIN_MS,
}: CharReleaseInput): CharReleasePlan {
  if (backlogChars <= 0) return { count: 0, carryChars: 0, drainMsLeft: DRAIN_MS };

  const elapsed = Math.max(0, elapsedMs);
  const paceChars = getCharsPerSecond(backlogChars);
  const rate = done
    ? Math.max(paceChars, (backlogChars * 1000) / Math.max(drainMsLeft, MIN_DRAIN_MS))
    : paceChars;
  const accumulated = carryChars + (rate * elapsed) / 1000;
  const count = Math.min(backlogChars, Math.floor(accumulated));

  return {
    count,
    carryChars: count === backlogChars ? 0 : accumulated - count,
    drainMsLeft: done ? Math.max(0, drainMsLeft - elapsed) : DRAIN_MS,
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

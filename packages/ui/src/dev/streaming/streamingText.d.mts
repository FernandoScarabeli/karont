export type WordSegment = {
  value: string;
  start: number;
  end: number;
  kind: "space" | "word";
};

export type TextToken = {
  value: string;
  start: number;
  end: number;
};

export type WordReleaseInput = {
  backlogWords: number;
  elapsedMs: number;
  done?: boolean;
  carryWords?: number;
  drainMsLeft?: number;
};

export type WordReleasePlan = {
  count: number;
  carryWords: number;
  drainMsLeft: number;
};

export function splitIntoWords(text: string): WordSegment[];
export function splitIntoTokens(
  text: string,
  done?: boolean,
  options?: { valve?: boolean },
): TextToken[];
export function getWordsPerSecond(backlogWords: number): number;
export function planWordRelease(input: WordReleaseInput): WordReleasePlan;

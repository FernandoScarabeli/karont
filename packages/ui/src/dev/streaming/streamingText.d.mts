export type WordSegment = {
  value: string;
  start: number;
  end: number;
  kind: "space" | "word";
};

export function splitIntoWords(text: string): WordSegment[];
export function getSafeRevealLength(
  text: string,
  currentLength: number,
  requestedLength: number,
  done?: boolean,
): number;

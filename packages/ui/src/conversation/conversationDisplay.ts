import type { MessagePart } from "@karont/contract";

type TextPart = Extract<MessagePart, { type: "text" }>;

export function splitFinalAnswer(parts: readonly MessagePart[]): {
  history: MessagePart[];
  finalAnswer: TextPart[];
} {
  const finalAnswerStart = parts.findLastIndex((part) => part.type !== "text") + 1;

  return {
    history: parts.slice(0, finalAnswerStart),
    finalAnswer: parts
      .slice(finalAnswerStart)
      .filter((part): part is TextPart => part.type === "text"),
  };
}

export function formatWorkDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "Trabalhou";

  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `Trabalhou por ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  if (minutes > 0) return `Trabalhou por ${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`;
  return `Trabalhou por ${seconds}s`;
}

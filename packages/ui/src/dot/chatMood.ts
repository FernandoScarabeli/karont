import type { DotMood } from "./EyeTracker.tsx";

type ChatMoodInput = {
  isLatest: boolean;
  conversationState: string | undefined;
  messageStatus: string;
};

/** Humor do rosto do Dot numa resposta: só a última mensagem reage ao estado da conversa. */
export function chatMood({ isLatest, conversationState, messageStatus }: ChatMoodInput): DotMood {
  if (!isLatest) return "idle";
  if (conversationState === "waiting") return "needs-you";
  if (messageStatus === "streaming" || conversationState === "working") return "working";
  return "idle";
}

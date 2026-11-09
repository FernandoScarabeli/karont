export type DotMood = "idle" | "working" | "needs-you" | "sleeping";

export type DotCharacterProps = {
  mood: DotMood;
  size: number;
  /** Dentro da salinha o rótulo é da cena inteira, então o personagem some para leitores de tela. */
  decorative?: boolean;
};

export const dotMoods: readonly DotMood[] = ["idle", "working", "needs-you", "sleeping"];

export const moodNames: Record<DotMood, string> = {
  idle: "Parado",
  working: "Trabalhando",
  "needs-you": "Precisa de você",
  sleeping: "Dormindo",
};

const moodPhrases: Record<DotMood, string> = {
  idle: "parado",
  working: "trabalhando",
  "needs-you": "precisa de você",
  sleeping: "dormindo",
};

export function dotLabel(mood: DotMood) {
  return `Dot ${moodPhrases[mood]}`;
}

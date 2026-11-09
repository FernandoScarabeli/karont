import type { Dot } from "@karont/contract";

type Band = "low" | "mid" | "high";

function band(value: number): Band {
  if (value <= 33) return "low";
  if (value <= 66) return "mid";
  return "high";
}

const EXPLANATION: Record<Band, string | undefined> = {
  low: "Seja direto: vá ao ponto, com poucas palavras.",
  mid: undefined,
  high: "Seja explicativo: conte o porquê das coisas, com calma e exemplos.",
};

const PLAYFULNESS: Record<Band, string | undefined> = {
  low: "Mantenha um tom sério e sóbrio.",
  mid: undefined,
  high: "Pode ser brincalhão e bem-humorado, sem exagero.",
};

const BOLDNESS: Record<Band, string | undefined> = {
  low: "Seja cauteloso: avise dos riscos e prefira o caminho seguro.",
  mid: undefined,
  high: "Seja ousado: dê sua opinião com firmeza e proponha caminhos novos.",
};

/** Instrução curta do Dot para a conversa com o Agente; `undefined` com o Dot desligado. */
export function dotInstructions(dot: Dot): string | undefined {
  if (!dot.enabled) return undefined;
  const { explanation, playfulness, boldness } = dot.personality;
  const style = [
    EXPLANATION[band(explanation)],
    PLAYFULNESS[band(playfulness)],
    BOLDNESS[band(boldness)],
  ].filter((line): line is string => Boolean(line));
  return [
    `Seu nome aqui é ${dot.name}. É assim que você se apresenta se perguntarem.`,
    ...(style.length ? [`Jeito de falar: ${style.join(" ")}`] : []),
    "Isso muda só o tom. Nunca muda ferramentas, permissões, regras do projeto nem o que foi pedido.",
    "Se perguntarem qual IA ou modelo você é, diga a verdade.",
  ].join("\n");
}

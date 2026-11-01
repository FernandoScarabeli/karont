import { useEffect, useState } from "react";
import styles from "./TextType.module.css";

export const funnyPrompts = [
  "Faça meu café",
  "Como dominar o mundo?",
  "Dá pra fazer frontend em Java?",
  "Conserta o bug que eu criei ontem",
  "Explica esse código como se eu tivesse 5 anos",
  "Escreve os testes que eu fiquei com preguiça",
  "Centraliza essa div",
  "Por que funciona na minha máquina?",
  "Refatora sem quebrar nada, por favor",
  "Descobre quem apagou meu ponto e vírgula",
  "Transforma esse if numa obra de arte",
  "Faz esse CSS obedecer",
  "Encontra o parêntese que fugiu",
  "Dá nome bom pra essa variável",
  "Explica o erro sem me julgar",
  "Deixa esse README apresentável",
  "Faz o build passar na primeira",
  "Apaga os comentários que mentem",
  "Me ajuda a sair do tutorial eterno",
  "O que esse código quis dizer?",
  "Faz o botão parar de fugir",
  "Conserta o merge que eu fingi entender",
  "Reduz esse arquivo de 900 linhas",
  "Por que tem um pacote pra isso?",
  "Revisa esse PR com carinho",
  "Escreve uma mensagem de commit decente",
  "Explica promessas sem falar de casamento",
  "Faz essa consulta parar de pensar",
  "Me ajuda a entender esse legado",
  "Troca o nome dessa função suspeita",
  "Acha o bug antes da demo",
  "Ensina meu terminal a colaborar",
  "Arruma o que eu arrumei ontem",
  "Gera um plano que eu consiga seguir",
] as const;

type TextTypeProps = {
  phrases?: readonly string[];
  typingSpeed?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
};

export function TextType({
  phrases = funnyPrompts,
  typingSpeed = 75,
  pauseDuration = 1_500,
  deletingSpeed = 50,
}: TextTypeProps) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phrase = phrases[phraseIndex % phrases.length] ?? "";
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(query.matches);
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setText(phrase);
      return;
    }

    let timer: number | undefined;
    let nextStep: (() => void) | undefined;
    let nextDelay = typingSpeed;
    const schedule = (delay: number, callback: () => void) => {
      nextStep = callback;
      nextDelay = delay;
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        nextStep = undefined;
        callback();
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
      } else if (nextStep) {
        const callback = nextStep;
        schedule(nextDelay, callback);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const phraseCharacters = segmentGraphemes(phrase);
    const visibleCharacters = segmentGraphemes(text);
    if (deleting) {
      if (visibleCharacters.length > 0) {
        schedule(deletingSpeed, () => setText(visibleCharacters.slice(0, -1).join("")));
      } else {
        schedule(typingSpeed, () => {
          setPhraseIndex((index) => (index + 1) % phrases.length);
          setDeleting(false);
        });
      }
    } else if (visibleCharacters.length < phraseCharacters.length) {
      schedule(typingSpeed, () =>
        setText(phraseCharacters.slice(0, visibleCharacters.length + 1).join("")),
      );
    } else {
      schedule(pauseDuration, () => setDeleting(true));
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    deleting,
    deletingSpeed,
    pauseDuration,
    phrase,
    phrases.length,
    reducedMotion,
    text,
    typingSpeed,
  ]);

  return (
    <span aria-hidden="true" className={styles.textType}>
      <span>{text}</span>
      <span className={styles.cursor}>_</span>
    </span>
  );
}

function segmentGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(value)].map(
      (part) => part.segment,
    );
  }
  return Array.from(value);
}

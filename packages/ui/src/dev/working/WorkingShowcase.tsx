import type { MessagePart } from "@karont/contract";
import { useEffect, useState } from "react";
import { WorkingIndicator, type WorkingVariant } from "./WorkingIndicator.tsx";
import styles from "./WorkingShowcase.module.css";

type DemoBeat = { durationMs: number; parts: MessagePart[] };

const demoBeats: [DemoBeat, ...DemoBeat[]] = [
  {
    durationMs: 900,
    parts: [
      {
        id: "thinking-initial",
        type: "thinking",
        text: "Vou conferir o fluxo de carregamento.",
      },
    ],
  },
  {
    durationMs: 1_000,
    parts: [
      {
        id: "thinking-initial",
        type: "thinking",
        text: "Vou conferir o fluxo de carregamento. Depois, verifico os arquivos envolvidos.",
      },
    ],
  },
  {
    durationMs: 1_200,
    parts: [
      {
        id: "thinking-initial",
        type: "thinking",
        text: "Vou conferir o fluxo de carregamento. Depois, verifico os arquivos envolvidos. Por fim, valido a mudança com os testes.",
      },
    ],
  },
  {
    durationMs: 1_800,
    parts: [
      actionPart("read-app", "read", "src/app.ts"),
      actionPart("read-package", "read", "package.json"),
    ],
  },
  {
    durationMs: 1_000,
    parts: [
      {
        id: "thinking-again",
        type: "thinking",
        text: "O carregamento passa por dois pontos. Vou manter o ajuste no fluxo existente.",
      },
    ],
  },
  {
    durationMs: 1_200,
    parts: [
      {
        id: "thinking-again",
        type: "thinking",
        text: "O carregamento passa por dois pontos. Vou manter o ajuste no fluxo existente. Depois, rodo a validação.",
      },
    ],
  },
  {
    durationMs: 2_000,
    parts: [actionPart("test-command", "command", "npm test")],
  },
  {
    durationMs: 2_000,
    parts: [actionPart("edit-app", "edit", "src/app.ts")],
  },
  {
    durationMs: 900,
    parts: [
      {
        id: "thinking-initial",
        type: "thinking",
        text: "Vou conferir o fluxo de carregamento.",
      },
    ],
  },
];

const variants: { id: string; label: string; variant: WorkingVariant }[] = [
  { id: "a", label: "A · mínima", variant: "minimal" },
  { id: "b", label: "B · com raciocínio", variant: "reasoning" },
  { id: "c", label: "C · completa", variant: "complete" },
  { id: "d", label: "D · no fim da resposta", variant: "minimal" },
];

export function WorkingShowcase() {
  const [beatIndex, setBeatIndex] = useState(0);
  const beat = demoBeats[beatIndex] ?? demoBeats[0];

  useEffect(() => {
    const currentBeat = demoBeats[beatIndex] ?? demoBeats[0];
    if (!currentBeat) return;

    const timeout = window.setTimeout(() => {
      setBeatIndex((current) => (current + 1) % demoBeats.length);
    }, currentBeat.durationMs);
    return () => window.clearTimeout(timeout);
  }, [beatIndex]);

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <div className={styles.headingGroup}>
            <h1 className={styles.heading}>Indicador em conversa</h1>
            <p className={styles.description}>Quatro variações no mesmo roteiro simulado.</p>
          </div>
          <p className={styles.notice} role="note">
            Tela provisória · dados de exemplo
          </p>
        </header>

        <section className={styles.variants} aria-label="Variações do indicador Trabalhando">
          {variants.map((item) => (
            <article className={styles.variantCard} key={item.id}>
              <div className={styles.cardHeading}>
                <h2 className={styles.variantTitle}>{item.label}</h2>
              </div>

              <div className={styles.conversation}>
                <div className={styles.userMessage}>
                  <span className={styles.messageAuthor}>Você</span>
                  <p className={styles.userBubble}>
                    Ajuste o carregamento em src/app.ts e valide com npm test.
                  </p>
                </div>

                <div className={styles.agentMessage}>
                  <span className={styles.messageAuthor}>Agente</span>
                  <p className={styles.responseText}>
                    Vou conferir o fluxo atual antes de fazer a alteração.
                  </p>
                  {item.id === "d" ? (
                    <div className={styles.cursorIndicator}>
                      <WorkingIndicator parts={beat.parts} variant={item.variant} />
                    </div>
                  ) : null}
                </div>
              </div>
              {item.id !== "d" ? (
                <div className={styles.fixedIndicator}>
                  <WorkingIndicator parts={beat.parts} variant={item.variant} />
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function actionPart(
  id: string,
  actionType: Extract<MessagePart, { type: "action" }>["actionType"],
  title: string,
): MessagePart {
  return {
    id,
    type: "action",
    actionType,
    title,
    input: "",
    output: "",
    truncated: false,
    state: "running",
    durationMs: null,
  };
}

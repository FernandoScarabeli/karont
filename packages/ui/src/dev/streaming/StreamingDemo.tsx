import { RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/Button/Button.tsx";
import styles from "./StreamingDemo.module.css";
import { type RenderMetrics, StreamingMarkdown } from "./StreamingMarkdown.tsx";
import { sampleMarkdown } from "./sampleMarkdown.ts";
import { useSmoothText } from "./useSmoothText.ts";

type Speed = "normal" | "fast";
type Version = "A" | "B" | "C" | "D";
type FrameSample = { frameId: number; frameStartedAt: number };

const numberFormatter = new Intl.NumberFormat("pt-BR");
const versions: { id: Version; title: string; detail: string }[] = [
  { id: "A", title: "Atual", detail: "Cada lote aparece de uma vez." },
  {
    id: "B",
    title: "Ritmo constante",
    detail: "Atraso ajusta a cadência; palavras ficam inteiras.",
  },
  { id: "C", title: "Ritmo + fade", detail: "Palavras novas entram com fade; código por linha." },
  { id: "D", title: "Ritmo + desfoque", detail: "Fade e desfoque leve no texto que chega." },
];

export function StreamingDemo() {
  const [runId, setRunId] = useState(0);
  const [incomingText, setIncomingText] = useState("");
  const [done, setDone] = useState(false);
  const [speed, setSpeed] = useState<Speed>("normal");
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    let cursor = 0;
    let burstRemaining = 0;
    let stopped = false;
    let timer: number | null = null;
    let randomState = (runId + 1) * 0x45d9f3b;
    const random = () => {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 0x1_0000_0000;
    };

    setIncomingText("");
    setDone(false);

    const receiveBatch = () => {
      if (stopped) return;
      const batchLength = 3 + Math.floor(random() * 58);
      cursor = Math.min(sampleMarkdown.length, cursor + batchLength);
      setIncomingText(sampleMarkdown.slice(0, cursor));

      if (cursor >= sampleMarkdown.length) {
        setDone(true);
        return;
      }

      if (burstRemaining > 0) {
        burstRemaining -= 1;
        timer = window.setTimeout(receiveBatch, 8 + Math.floor(random() * 16));
        return;
      }

      const speedFactor = speedRef.current === "fast" ? 0.5 : 1;
      const pause = random() < 0.09 ? (400 + Math.floor(random() * 401)) * speedFactor : 0;
      const interval = speedRef.current === "fast" ? 26 + random() * 16 : 48 + random() * 32;
      burstRemaining = random() < 0.14 ? 1 + Math.floor(random() * 3) : 0;
      timer = window.setTimeout(receiveBatch, Math.round(pause || interval));
    };

    timer = window.setTimeout(receiveBatch, 120);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [runId]);

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Texto em fluxo</h1>
            <p className={styles.description}>
              Compare como a mesma resposta aparece enquanto os fragmentos chegam.
            </p>
          </div>
          <p className={styles.notice} role="note">
            Tela provisória · dados de exemplo
          </p>
        </header>

        <div className={styles.controls}>
          <div className={styles.streamStatus}>
            <span aria-hidden="true" className={done ? styles.statusDone : styles.statusWorking} />
            <span>{done ? "Fluxo concluído" : "Resposta chegando"}</span>
            <span className={styles.statusCount}>
              {numberFormatter.format(incomingText.length)} /{" "}
              {numberFormatter.format(sampleMarkdown.length)} caracteres
            </span>
          </div>
          <div className={styles.actions}>
            <label className={styles.speedControl}>
              <span>Velocidade</span>
              <select
                className={styles.speedSelect}
                onChange={(event) => setSpeed(event.currentTarget.value as Speed)}
                value={speed}
              >
                <option value="normal">Normal</option>
                <option value="fast">Rápida</option>
              </select>
            </label>
            <Button
              iconStart={<RotateCcw size={14} />}
              onClick={() => setRunId((value) => value + 1)}
            >
              Recomeçar
            </Button>
          </div>
        </div>

        <div className={styles.grid}>
          {versions.map((version) => (
            <VersionColumn
              key={`${runId}-${version.id}`}
              description={version.detail}
              done={done}
              incomingText={incomingText}
              title={version.title}
              totalLength={sampleMarkdown.length}
              version={version.id}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function VersionColumn({
  description,
  done,
  incomingText,
  title,
  totalLength,
  version,
}: {
  description: string;
  done: boolean;
  incomingText: string;
  title: string;
  totalLength: number;
  version: Version;
}) {
  if (version === "A") {
    return (
      <VersionPanel
        description={description}
        done={done}
        incomingLength={incomingText.length}
        title={title}
        totalLength={totalLength}
        version={version}
        visibleText={incomingText}
      />
    );
  }

  return (
    <SmoothVersionColumn
      description={description}
      done={done}
      incomingLength={incomingText.length}
      incomingText={incomingText}
      title={title}
      totalLength={totalLength}
      version={version}
    />
  );
}

function SmoothVersionColumn({
  description,
  done,
  incomingLength,
  incomingText,
  title,
  totalLength,
  version,
}: {
  description: string;
  done: boolean;
  incomingLength: number;
  incomingText: string;
  title: string;
  totalLength: number;
  version: Exclude<Version, "A">;
}) {
  const revealed = useSmoothText(incomingText, { done });
  const motion = useReducedMotion();
  const motionStyle = version === "C" ? "fade" : "blur";

  return (
    <VersionPanel
      description={description}
      done={done}
      frame={revealed}
      incomingLength={incomingLength}
      motion={motion ? "none" : motionStyle}
      title={title}
      totalLength={totalLength}
      version={version}
      visibleText={revealed.text}
    />
  );
}

function VersionPanel({
  description,
  done,
  frame,
  incomingLength,
  motion = "none",
  title,
  totalLength,
  version,
  visibleText,
}: {
  description: string;
  done: boolean;
  frame?: FrameSample;
  incomingLength: number;
  motion?: "none" | "fade" | "blur";
  title: string;
  totalLength: number;
  version: Version;
  visibleText: string;
}) {
  const renderMetrics = useRef<RenderMetrics>({ latestBlockRenders: 0 });
  const frameSamplesRef = useRef({ count: 0, totalMs: 0, lastFrameId: 0 });
  const previousRenderCountRef = useRef(0);
  const [sample, setSample] = useState({ rendersPerSecond: 0, averageFrameMs: 0 });

  useLayoutEffect(() => {
    if (!frame || frame.frameId <= frameSamplesRef.current.lastFrameId) return;
    frameSamplesRef.current.count += 1;
    frameSamplesRef.current.totalMs += Math.max(0, performance.now() - frame.frameStartedAt);
    frameSamplesRef.current.lastFrameId = frame.frameId;
  }, [frame]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentRenderCount = renderMetrics.current.latestBlockRenders;
      const currentFrames = frameSamplesRef.current;
      setSample({
        rendersPerSecond: currentRenderCount - previousRenderCountRef.current,
        averageFrameMs: currentFrames.count > 0 ? currentFrames.totalMs / currentFrames.count : 0,
      });
      previousRenderCountRef.current = currentRenderCount;
      frameSamplesRef.current = { ...currentFrames, count: 0, totalMs: 0 };
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isComplete = done && visibleText.length === totalLength;
  const status = isComplete ? "Concluído" : done ? "Liberando restante" : "Recebendo";

  return (
    <section aria-labelledby={`stream-title-${version}`} className={styles.panel}>
      <header className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <h2 className={styles.panelTitle} id={`stream-title-${version}`}>
            <span className={styles.version}>{version}</span>
            {title}
          </h2>
          <p className={styles.panelDescription}>{description}</p>
        </div>
        <p className={styles.panelStatus}>{status}</p>
      </header>
      <div className={styles.markdownViewport}>
        <StreamingMarkdown
          done={done && visibleText.length === totalLength}
          markdown={visibleText}
          metrics={renderMetrics.current}
          motion={motion}
        />
      </div>
      <footer className={styles.panelFooter}>
        <span>
          {version === "A" ? "Recebidos" : "Exibidos"} {numberFormatter.format(visibleText.length)}{" "}
          / {numberFormatter.format(totalLength)}
        </span>
        {version !== "A" ? (
          <span>{numberFormatter.format(incomingLength - visibleText.length)} em espera</span>
        ) : null}
        <span className={styles.measure}>
          Bloco {numberFormatter.format(sample.rendersPerSecond)}/s · quadro{" "}
          {sample.averageFrameMs > 0 ? `${sample.averageFrameMs.toFixed(1)} ms` : "—"}
        </span>
      </footer>
    </section>
  );
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  return reducedMotion;
}

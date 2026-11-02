import { RotateCcw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/Button/Button.tsx";
import styles from "./StreamingDemo.module.css";
import { type CaretPhase, type RenderMetrics, StreamingMarkdown } from "./StreamingMarkdown.tsx";
import { sampleMarkdown } from "./sampleMarkdown.ts";
import { useSmoothText } from "./useSmoothText.ts";
import { useTypewriterText } from "./useTypewriterText.ts";

type Speed = "normal" | "fast";
type Version = "A" | "B" | "C" | "D" | "E";
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
  {
    id: "E",
    title: "Máquina de escrever",
    detail: "Caractere por caractere, sem fade; cursor de bloco no fim do texto.",
  },
];
const defaultVersion: Version = "E";

export function StreamingDemo() {
  const [runId, setRunId] = useState(0);
  const [incomingText, setIncomingText] = useState("");
  const [done, setDone] = useState(false);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [selectedVersion, setSelectedVersion] = useState<Version>(defaultVersion);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const radioRefs = useRef<Partial<Record<Version, HTMLButtonElement | null>>>({});
  const selectedDetail = versions.find((version) => version.id === selectedVersion)?.detail ?? "";

  // Only the selected version is rendered; changing it restarts the stream.
  const selectVersion = (version: Version) => {
    if (version === selectedVersion) return;
    setSelectedVersion(version);
    setRunId((value) => value + 1);
  };

  const handleRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = versions[(index + step + versions.length) % versions.length];
    if (!next) return;
    radioRefs.current[next.id]?.focus();
    selectVersion(next.id);
  };

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
            <div
              aria-describedby="streaming-version-detail"
              aria-label="Versão exibida"
              className={styles.segmented}
              role="radiogroup"
            >
              {versions.map((version, index) => {
                const selected = version.id === selectedVersion;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: o seletor pedido usa role=radio em botões, com setas e foco roving.
                  <button
                    aria-checked={selected}
                    className={styles.segment}
                    key={version.id}
                    onClick={() => selectVersion(version.id)}
                    onKeyDown={(event) => handleRadioKeyDown(event, index)}
                    ref={(element) => {
                      radioRefs.current[version.id] = element;
                    }}
                    role="radio"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                  >
                    {version.id} · {version.title}
                  </button>
                );
              })}
            </div>
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

        <p className={styles.versionDetail} id="streaming-version-detail">
          {selectedDetail}
        </p>

        <div className={styles.column}>
          <VersionColumn
            key={`${runId}-${selectedVersion}`}
            done={done}
            incomingText={incomingText}
            title={versions.find((version) => version.id === selectedVersion)?.title ?? ""}
            totalLength={sampleMarkdown.length}
            version={selectedVersion}
          />
        </div>
      </div>
    </main>
  );
}

function VersionColumn({
  done,
  incomingText,
  title,
  totalLength,
  version,
}: {
  done: boolean;
  incomingText: string;
  title: string;
  totalLength: number;
  version: Version;
}) {
  if (version === "A") {
    return (
      <VersionPanel
        done={done}
        incomingLength={incomingText.length}
        title={title}
        totalLength={totalLength}
        version={version}
        visibleText={incomingText}
      />
    );
  }

  if (version === "E") {
    return (
      <TypewriterVersionColumn
        done={done}
        incomingText={incomingText}
        title={title}
        totalLength={totalLength}
        version={version}
      />
    );
  }

  return (
    <SmoothVersionColumn
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
  done,
  incomingLength,
  incomingText,
  title,
  totalLength,
  version,
}: {
  done: boolean;
  incomingLength: number;
  incomingText: string;
  title: string;
  totalLength: number;
  version: Exclude<Version, "A" | "E">;
}) {
  const revealed = useSmoothText(incomingText, { done });
  const motion = useReducedMotion();
  const motionStyle = version === "C" ? "fade" : "blur";

  return (
    <VersionPanel
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

function TypewriterVersionColumn({
  done,
  incomingText,
  title,
  totalLength,
  version,
}: {
  done: boolean;
  incomingText: string;
  title: string;
  totalLength: number;
  version: Extract<Version, "E">;
}) {
  const revealed = useTypewriterText(incomingText, { done });
  const caughtUp = revealed.text.length === incomingText.length;
  // Solid while streaming; blinks while idle; fades out after done.
  const caretPhase: CaretPhase = !caughtUp ? "streaming" : done ? "done" : "idle";

  return (
    <VersionPanel
      caretPhase={caretPhase}
      done={done}
      frame={revealed}
      incomingLength={incomingText.length}
      title={title}
      totalLength={totalLength}
      version={version}
      visibleText={revealed.text}
    />
  );
}

function VersionPanel({
  caretPhase = "off",
  done,
  frame,
  incomingLength,
  motion = "none",
  title,
  totalLength,
  version,
  visibleText,
}: {
  caretPhase?: CaretPhase;
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
        </div>
        <p className={styles.panelStatus}>{status}</p>
      </header>
      <div className={styles.markdownViewport}>
        <StreamingMarkdown
          caretPhase={caretPhase}
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

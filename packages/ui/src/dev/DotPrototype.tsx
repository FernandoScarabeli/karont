import { useEffect, useRef, useState } from "react";
import { type DotMood, type DotShape, EyeTracker } from "../dot/EyeTracker.tsx";
import styles from "./DotPrototype.module.css";

type AccentId = "ivory" | "magenta" | "turquoise" | "lime" | "blue" | "coral";
type Tone = "dark" | "light";

const accents: readonly { id: AccentId; name: string; className: string }[] = [
  { id: "ivory", name: "Marfim", className: styles.swatchIvory ?? "" },
  { id: "magenta", name: "Magenta", className: styles.swatchMagenta ?? "" },
  { id: "turquoise", name: "Turquesa", className: styles.swatchTurquoise ?? "" },
  { id: "lime", name: "Lima", className: styles.swatchLime ?? "" },
  { id: "blue", name: "Azul elétrico", className: styles.swatchBlue ?? "" },
  { id: "coral", name: "Coral", className: styles.swatchCoral ?? "" },
];

const shapeOptions: readonly { value: DotShape; label: string }[] = [
  { value: "flame", label: "Chama" },
  { value: "veil", label: "Véu" },
  { value: "wisp", label: "Fiapo" },
];

const moodOptions: readonly { value: DotMood; label: string }[] = [
  { value: "idle", label: "Parado" },
  { value: "working", label: "Trabalhando" },
  { value: "needs-you", label: "Precisa de você" },
  { value: "sleeping", label: "Dormindo" },
  { value: "done", label: "Terminou" },
];

const toneOptions: readonly { value: Tone; label: string }[] = [
  { value: "dark", label: "Escuro" },
  { value: "light", label: "Claro" },
];

const chatSampleName = "Dot · via Codex";

type ChoiceGroupProps<T extends string> = {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

function ChoiceGroup<T extends string>({ legend, options, value, onChange }: ChoiceGroupProps<T>) {
  return (
    <fieldset className={styles.field}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.choices}>
        {options.map((option) => (
          <button
            aria-pressed={option.value === value}
            className={styles.choice}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className={styles.check} fill="none" viewBox="0 0 16 16">
      <path
        d="M4 8.5 L6.8 11.2 L12 5.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function DotPrototype() {
  const pageRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<DotShape>("flame");
  const [mood, setMood] = useState<DotMood>("idle");
  const [tone, setTone] = useState<Tone>("dark");
  const [accent, setAccent] = useState<AccentId>("ivory");

  useEffect(() => {
    pageRef.current?.style.setProperty("--k-color-brand", `var(--k-accent-${accent})`);
  }, [accent]);

  return (
    <main className={styles.page} ref={pageRef}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Dot · protótipo</h1>
          <p className={styles.badge}>Dados de exemplo</p>
        </header>

        <section aria-labelledby="dot-stage" className={styles.section}>
          <h2 className={styles.srOnly} id="dot-stage">
            Dot em tamanho grande
          </h2>
          <div className={styles.stage} ref={stageRef}>
            <EyeTracker mood={mood} shape={shape} size={180} tone={tone} within={stageRef} />
          </div>
        </section>

        <section aria-labelledby="dot-controls" className={styles.panel}>
          <h2 className={styles.srOnly} id="dot-controls">
            Controles
          </h2>
          <div className={styles.controls}>
            <ChoiceGroup legend="Forma" onChange={setShape} options={shapeOptions} value={shape} />
            <ChoiceGroup legend="Humor" onChange={setMood} options={moodOptions} value={mood} />
            <ChoiceGroup legend="Corpo" onChange={setTone} options={toneOptions} value={tone} />
            <fieldset className={styles.field}>
              <legend className={styles.legend}>Cor de destaque</legend>
              <div className={styles.choices}>
                {accents.map((item) => (
                  <button
                    aria-label={item.name}
                    aria-pressed={item.id === accent}
                    className={`${styles.swatch} ${item.className}`}
                    key={item.id}
                    onClick={() => setAccent(item.id)}
                    type="button"
                  >
                    {item.id === accent ? <CheckIcon /> : null}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="dot-sizes" className={styles.section}>
          <h2 className={styles.title} id="dot-sizes">
            Tamanhos
          </h2>
          <div className={styles.sizes}>
            <span className={styles.chatSample}>
              <EyeTracker mood={mood} shape={shape} size={20} still tone={tone} />
              <span className={styles.chatName}>{chatSampleName}</span>
            </span>
            <EyeTracker mood={mood} shape={shape} size={40} still tone={tone} />
            <EyeTracker mood={mood} shape={shape} size={96} still tone={tone} />
          </div>
        </section>

        <section aria-labelledby="dot-compare" className={styles.section}>
          <h2 className={styles.title} id="dot-compare">
            Formas lado a lado
          </h2>
          <div className={styles.compare}>
            {shapeOptions.map((option) => (
              <figure className={styles.figure} key={option.value}>
                <EyeTracker mood={mood} shape={option.value} size={64} still tone={tone} />
                <figcaption className={styles.caption}>{option.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

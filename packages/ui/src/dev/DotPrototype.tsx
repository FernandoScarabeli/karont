import { useRef, useState } from "react";
import { ColorWell } from "../components/ColorPicker/ColorPicker.tsx";
import { DEFAULT_COLOR } from "../components/ColorPicker/color.ts";
import { type DotMood, EyeTracker } from "../dot/EyeTracker.tsx";
import styles from "./DotPrototype.module.css";

const moodOptions: readonly { value: DotMood; label: string }[] = [
  { value: "idle", label: "Parado" },
  { value: "working", label: "Trabalhando" },
  { value: "needs-you", label: "Precisa de você" },
  { value: "sleeping", label: "Dormindo" },
  { value: "happy", label: "Feliz" },
  { value: "sad", label: "Triste" },
  { value: "dancing", label: "Dançando" },
  { value: "surprised", label: "Surpreso" },
  { value: "angry", label: "Bravo" },
  { value: "confused", label: "Confuso" },
  { value: "love", label: "Apaixonado" },
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

export function DotPrototype() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<DotMood>("idle");
  const [color, setColor] = useState(DEFAULT_COLOR);

  return (
    <main className={styles.page}>
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
            <EyeTracker color={color} mood={mood} size={180} within={stageRef} />
          </div>
        </section>

        <section aria-labelledby="dot-controls" className={styles.panel}>
          <h2 className={styles.srOnly} id="dot-controls">
            Controles
          </h2>
          <div className={styles.controls}>
            <ChoiceGroup legend="Humor" onChange={setMood} options={moodOptions} value={mood} />
            <div className={styles.field}>
              <span className={styles.legend}>Cor do Dot</span>
              <div className={styles.choices}>
                <ColorWell onChange={setColor} value={color} />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="dot-sizes" className={styles.section}>
          <h2 className={styles.title} id="dot-sizes">
            Tamanhos
          </h2>
          <div className={styles.sizes}>
            <span className={styles.chatSample}>
              <EyeTracker color={color} mood={mood} size={20} still />
              <span className={styles.chatName}>{chatSampleName}</span>
            </span>
            <EyeTracker color={color} mood={mood} size={40} still />
            <EyeTracker color={color} mood={mood} size={96} still />
          </div>
        </section>

        <section aria-labelledby="dot-compare" className={styles.section}>
          <h2 className={styles.title} id="dot-compare">
            Os onze humores
          </h2>
          <div className={styles.compare}>
            {moodOptions.map((option) => (
              <figure className={styles.figure} key={option.value}>
                <EyeTracker color={color} mood={option.value} size={64} still />
                <figcaption className={styles.caption}>{option.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

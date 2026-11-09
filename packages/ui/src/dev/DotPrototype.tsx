import { useEffect, useRef, useState } from "react";
import styles from "./DotPrototype.module.css";
import { characterComponent, type DotCharacterId, dotCharacters } from "./dot/characters.ts";
import { Room, type RoomTime } from "./dot/Room.tsx";
import { type DotMood, dotMoods, moodNames } from "./dot/types.ts";

type AccentId = "ivory" | "magenta" | "turquoise" | "lime" | "blue" | "coral";

const accents: readonly { id: AccentId; name: string; className: string }[] = [
  { id: "ivory", name: "Marfim", className: styles.swatchIvory ?? "" },
  { id: "magenta", name: "Magenta", className: styles.swatchMagenta ?? "" },
  { id: "turquoise", name: "Turquesa", className: styles.swatchTurquoise ?? "" },
  { id: "lime", name: "Lima", className: styles.swatchLime ?? "" },
  { id: "blue", name: "Azul elétrico", className: styles.swatchBlue ?? "" },
  { id: "coral", name: "Coral", className: styles.swatchCoral ?? "" },
];

const timeOptions: readonly { value: RoomTime; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "night", label: "Noite" },
];

const chatSampleName = "Dot · via Codex";
const sampleSizes = [20, 40, 120] as const;

function initialTime(): RoomTime {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

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

type RangeFieldProps = {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
};

function RangeField({ label, max, value, onChange }: RangeFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.rangeHead}>
        <span className={styles.legend}>{label}</span>
        <output className={styles.rangeValue}>{value}</output>
      </span>
      <input
        className={styles.range}
        max={max}
        min={0}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        type="range"
        value={value}
      />
    </label>
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

function ComparisonTable({ character }: { character: (typeof dotCharacters)[number] }) {
  const Character = characterComponent(character.id);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{character.name}</caption>
        <thead className={styles.tableHead}>
          <tr>
            <th scope="col">Humor</th>
            <th scope="col">20 px</th>
            <th scope="col">40 px</th>
            <th scope="col">120 px</th>
          </tr>
        </thead>
        <tbody>
          {dotMoods.map((mood) => (
            <tr className={styles.row} key={mood}>
              <th className={styles.moodCell} scope="row">
                {moodNames[mood]}
              </th>
              <td className={styles.cell}>
                <span className={styles.srOnly}>20 px</span>
                <span className={styles.chatSample}>
                  <Character mood={mood} size={sampleSizes[0]} />
                  <span className={styles.chatName}>{chatSampleName}</span>
                </span>
              </td>
              <td className={styles.cell}>
                <span className={styles.srOnly}>40 px</span>
                <Character mood={mood} size={sampleSizes[1]} />
              </td>
              <td className={styles.cell}>
                <span className={styles.srOnly}>120 px</span>
                <Character mood={mood} size={sampleSizes[2]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DotPrototype() {
  const pageRef = useRef<HTMLElement>(null);
  const [character, setCharacter] = useState<DotCharacterId>("point");
  const [mood, setMood] = useState<DotMood>("idle");
  const [time, setTime] = useState<RoomTime>(initialTime);
  const [memories, setMemories] = useState(12);
  const [pending, setPending] = useState(3);
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

        <section aria-labelledby="dot-controls" className={styles.panel}>
          <h2 className={styles.srOnly} id="dot-controls">
            Controles
          </h2>
          <div className={styles.controls}>
            <ChoiceGroup
              legend="Personagem"
              onChange={setCharacter}
              options={dotCharacters.map((item) => ({ value: item.id, label: item.name }))}
              value={character}
            />
            <ChoiceGroup
              legend="Humor"
              onChange={setMood}
              options={dotMoods.map((item) => ({ value: item, label: moodNames[item] }))}
              value={mood}
            />
            <ChoiceGroup legend="Janela" onChange={setTime} options={timeOptions} value={time} />
            <RangeField label="Memórias" max={50} onChange={setMemories} value={memories} />
            <RangeField label="Pendentes" max={20} onChange={setPending} value={pending} />
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

        <section aria-labelledby="dot-room" className={styles.section}>
          <h2 className={styles.title} id="dot-room">
            Salinha
          </h2>
          <Room
            character={character}
            memories={memories}
            mood={mood}
            pending={pending}
            time={time}
          />
        </section>

        <section aria-labelledby="dot-compare" className={styles.section}>
          <h2 className={styles.title} id="dot-compare">
            Comparação
          </h2>
          <div className={styles.tables}>
            {dotCharacters.map((item) => (
              <ComparisonTable character={item} key={item.id} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

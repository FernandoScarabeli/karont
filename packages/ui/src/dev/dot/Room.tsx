import { characterComponent, type DotCharacterId } from "./characters.ts";
import styles from "./Room.module.css";
import { type DotMood, dotLabel } from "./types.ts";

export type RoomTime = "day" | "night";

export type RoomProps = {
  character: DotCharacterId;
  mood: DotMood;
  time: RoomTime;
  /** Memórias aprovadas: viram livros na estante (0 a 50). */
  memories: number;
  /** Memórias pendentes: viram um envelope com número (0 a 20). */
  pending: number;
};

const characterSize = 44;

const spots: Record<DotMood, "desk" | "bed" | "middle" | "front"> = {
  idle: "middle",
  working: "desk",
  sleeping: "bed",
  "needs-you": "front",
};

const spotNames = {
  desk: "na mesa",
  bed: "na cama",
  middle: "no meio do quarto",
  front: "na frente",
} as const;

/* Estante: três prateleiras, do chão para cima. */
const shelfLeft = 14;
const shelfRowBottoms = [116, 84, 52] as const;
const looseBooks = { perRow: 8, pitch: 7.2, width: 5.8, max: 24 } as const;
const packedBooks = {
  perGroup: 6,
  pitch: 2.8,
  width: 2.4,
  groupGap: 2.2,
  groupsPerRow: 3,
} as const;
const bookHeights = [22, 18, 24, 16, 21, 25, 17, 20, 23, 15, 19, 24] as const;
const bookTones = ["book1", "book2", "book3", "book4"] as const;

type Book = { x: number; y: number; w: number; h: number; tone: (typeof bookTones)[number] };

export function layoutBooks(count: number): Book[] {
  const books: Book[] = [];
  const packed = count > looseBooks.max;
  const perRow = packed ? packedBooks.perGroup * packedBooks.groupsPerRow : looseBooks.perRow;

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    const h = bookHeights[(index * 7) % bookHeights.length] ?? 20;
    const tone = bookTones[(index * 5) % bookTones.length] ?? "book1";
    const bottom = shelfRowBottoms[row] ?? shelfRowBottoms[0];
    let x: number;
    let w: number;
    if (packed) {
      const group = Math.floor(column / packedBooks.perGroup);
      const inGroup = column % packedBooks.perGroup;
      const groupWidth =
        packedBooks.perGroup * packedBooks.pitch - (packedBooks.pitch - packedBooks.width);
      x = shelfLeft + group * (groupWidth + packedBooks.groupGap) + inGroup * packedBooks.pitch;
      w = packedBooks.width;
    } else {
      x = shelfLeft + column * looseBooks.pitch;
      w = looseBooks.width;
    }
    books.push({ x, y: bottom - h, w, h, tone });
  }
  return books;
}

export function roomLabel({ mood, time, memories, pending }: Omit<RoomProps, "character">) {
  return [
    `Salinha do Dot: ${dotLabel(mood)} ${spotNames[spots[mood]]}`,
    `${memories} ${memories === 1 ? "memória aprovada" : "memórias aprovadas"} na estante`,
    pending > 0
      ? `${pending} ${pending === 1 ? "pendente" : "pendentes"} no envelope`
      : "nenhuma pendente",
    time === "day" ? "dia na janela" : "noite na janela",
  ].join(", ");
}

export function Room(props: RoomProps) {
  const { character, mood, time, memories, pending } = props;
  const Character = characterComponent(character);
  const books = layoutBooks(memories);

  return (
    <svg
      aria-label={roomLabel(props)}
      className={styles.room}
      data-time={time}
      role="img"
      viewBox="0 0 320 200"
    >
      <rect className={styles.wall} height="150" width="320" x="0" y="0" />
      <rect className={styles.floor} height="50" width="320" x="0" y="150" />
      <rect className={styles.baseboard} height="2" width="320" x="0" y="148" />

      {/* Janela */}
      <rect className={styles.wood} height="58" rx="3" width="54" x="95" y="25" />
      <rect className={styles.sky} data-time={time} height="48" rx="1" width="44" x="100" y="30" />
      {time === "day" ? (
        <>
          <circle className={styles.light} cx="113" cy="43" r="5" />
          <rect className={styles.cloud} height="5" rx="2.5" width="18" x="122" y="52" />
          <rect className={styles.cloud} height="4" rx="2" width="12" x="127" y="48" />
        </>
      ) : (
        <>
          <path className={styles.moon} d="M113 36 A8 8 0 1 0 121 48 A6.5 6.5 0 0 1 113 36 Z" />
          <circle className={`${styles.light} ${styles.twinkle}`} cx="131" cy="38" r="1" />
          <circle
            className={`${styles.light} ${styles.twinkle} ${styles.twinkleLate}`}
            cx="136"
            cy="56"
            r="0.9"
          />
          <circle className={styles.light} cx="106" cy="68" r="0.8" />
        </>
      )}
      <line className={styles.mullion} x1="122" x2="122" y1="30" y2="78" />
      <line className={styles.mullion} x1="100" x2="144" y1="54" y2="54" />

      {/* Estante */}
      <rect className={styles.shelfInside} height="100" width="58" x="14" y="20" />
      {books.map((book) => (
        <rect
          className={styles[book.tone]}
          height={book.h}
          key={`${book.x}-${book.y}`}
          rx="0.6"
          width={book.w}
          x={book.x}
          y={book.y}
        />
      ))}
      {[20, 52, 84, 116].map((y) => (
        <rect className={styles.wood} height="4" key={y} width="66" x="10" y={y} />
      ))}
      <rect className={styles.wood} height="100" width="4" x="10" y="20" />
      <rect className={styles.wood} height="100" width="4" x="72" y="20" />

      {/* Cama (parte de trás) */}
      <rect className={styles.wood} height="52" rx="2" width="8" x="304" y="98" />
      <rect className={styles.wood} height="10" width="76" x="232" y="140" />
      <rect className={styles.mattress} height="10" rx="3" width="76" x="232" y="130" />
      <rect className={styles.pillow} height="9" rx="3" width="28" x="272" y="121" />

      {/* Dot */}
      <g className={styles.dotSlot} data-spot={spots[mood]}>
        <Character decorative mood={mood} size={characterSize} />
      </g>

      {/* Mesa */}
      <rect className={styles.wood} height="5" rx="1" width="68" x="88" y="122" />
      <rect className={styles.wood} height="8" width="60" x="92" y="127" />
      <rect className={styles.wood} height="15" width="4" x="94" y="135" />
      <rect className={styles.wood} height="15" width="4" x="146" y="135" />

      {/* Cobertor */}
      <rect className={styles.blanket} height="18" rx="4" width="66" x="232" y="124" />

      {/* Envelope */}
      {pending > 0 ? (
        <g>
          <rect className={styles.paper} height="11" rx="1.5" width="18" x="133" y="111" />
          <path className={styles.fold} d="M133.8 112.2 L142 118.2 L150.2 112.2" />
          <circle className={styles.light} cx="142" cy="118.2" r="1.4" />
          <text className={styles.count} x="155" y="121">
            {pending}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

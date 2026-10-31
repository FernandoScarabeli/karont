import { MAX_FRAME_BYTES } from "@karont/contract";

export class FrameTooLargeError extends Error {
  constructor() {
    super(`A mensagem excede o limite de ${MAX_FRAME_BYTES} bytes.`);
    this.name = "FrameTooLargeError";
  }
}

export type DecodedItem =
  | { kind: "frame"; value: unknown }
  | { kind: "too_large" }
  | { kind: "invalid_json" };

export function encodeFrame(value: unknown): Buffer {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new TypeError("A mensagem não pode ser serializada como JSON.");
  const frame = Buffer.from(`${serialized}\n`, "utf8");
  if (frame.byteLength > MAX_FRAME_BYTES) throw new FrameTooLargeError();
  return frame;
}

export class FrameDecoder {
  readonly #line = Buffer.alloc(MAX_FRAME_BYTES);
  #lineLength = 0;
  #droppingOversizedLine = false;

  push(chunk: Buffer): DecodedItem[] {
    const decoded: DecodedItem[] = [];
    let offset = 0;

    while (offset < chunk.byteLength) {
      if (this.#droppingOversizedLine) {
        const newline = chunk.indexOf(0x0a, offset);
        if (newline === -1) return decoded;
        this.#droppingOversizedLine = false;
        this.#lineLength = 0;
        offset = newline + 1;
        continue;
      }

      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.byteLength : newline;
      const segmentLength = end - offset;
      const totalLength = this.#lineLength + segmentLength + (newline === -1 ? 0 : 1);

      if (totalLength > MAX_FRAME_BYTES) {
        this.#lineLength = 0;
        decoded.push({ kind: "too_large" });
        if (newline === -1) {
          this.#droppingOversizedLine = true;
          return decoded;
        }
        offset = newline + 1;
        continue;
      }

      if (segmentLength > 0) {
        chunk.copy(this.#line, this.#lineLength, offset, end);
        this.#lineLength += segmentLength;
      }

      if (newline === -1) return decoded;

      const lineLength = this.#lineLength;
      this.#lineLength = 0;
      offset = newline + 1;
      if (lineLength === 0) continue;

      try {
        decoded.push({
          kind: "frame",
          value: JSON.parse(this.#line.toString("utf8", 0, lineLength)) as unknown,
        });
      } catch {
        decoded.push({ kind: "invalid_json" });
      }
    }

    return decoded;
  }
}

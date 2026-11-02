export type AnsiOutputSegment = {
  text: string;
  foreground: number | null;
  background: number | null;
  bold: boolean;
  dim: boolean;
};

export type ParsedAnsiOutput = {
  segments: AnsiOutputSegment[];
  hasSgr: boolean;
};

type AnsiStyle = Omit<AnsiOutputSegment, "text">;

const ESC = "\u001b";

export function parseAnsiOutput(value: string): ParsedAnsiOutput {
  const segments: AnsiOutputSegment[] = [];
  const style: AnsiStyle = { foreground: null, background: null, bold: false, dim: false };
  let text = "";
  let hasSgr = false;

  const flush = () => {
    if (!text) return;
    const previous = segments.at(-1);
    if (
      previous &&
      previous.foreground === style.foreground &&
      previous.background === style.background &&
      previous.bold === style.bold &&
      previous.dim === style.dim
    ) {
      previous.text += text;
    } else {
      segments.push({ text, ...style });
    }
    text = "";
  };

  for (let index = 0; index < value.length; ) {
    const char = value[index];
    if (char === undefined) break;
    if (char === ESC) {
      const next = value[index + 1];
      if (next === "[") {
        const end = findCsiEnd(value, index + 2);
        if (end === -1) {
          index = value.length;
          continue;
        }
        const final = value[end];
        const params = value.slice(index + 2, end);
        if (final === "m") {
          flush();
          hasSgr = true;
          applySgr(params, style);
        }
        index = end + 1;
        continue;
      }
      if (next === "]") {
        index = skipOsc(value, index + 2);
        continue;
      }
      if (next === "P" || next === "X" || next === "^" || next === "_") {
        index = skipStringControl(value, index + 2);
        continue;
      }
      index = skipEscapeSequence(value, index + 1);
      continue;
    }
    if (char === "\u009b") {
      const end = findCsiEnd(value, index + 1);
      if (end === -1) {
        index = value.length;
        continue;
      }
      if (value[end] === "m") {
        flush();
        hasSgr = true;
        applySgr(value.slice(index + 1, end), style);
      }
      index = end + 1;
      continue;
    }
    if (char === "\u009d") {
      index = skipOsc(value, index + 1);
      continue;
    }
    if (char === "\u0090" || char === "\u0098" || char === "\u009e" || char === "\u009f") {
      index = skipStringControl(value, index + 1);
      continue;
    }

    if (char === "\r" && value[index + 1] === "\n") {
      text += "\n";
      index += 2;
      continue;
    }
    if (isControlCharacter(char)) {
      index += 1;
      continue;
    }
    text += char;
    index += 1;
  }
  flush();
  return { segments, hasSgr };
}

function findCsiEnd(value: string, index: number): number {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) return cursor;
  }
  return -1;
}

function skipOsc(value: string, index: number): number {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    if (value[cursor] === "\u0007") return cursor + 1;
    if (value[cursor] === "\u009c") return cursor + 1;
    if (value[cursor] === ESC && value[cursor + 1] === "\\") return cursor + 2;
  }
  return value.length;
}

function skipStringControl(value: string, index: number): number {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    if (value[cursor] === "\u009c") return cursor + 1;
    if (value[cursor] === ESC && value[cursor + 1] === "\\") return cursor + 2;
  }
  return value.length;
}

function skipEscapeSequence(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code < 0x20 || code > 0x2f) break;
    cursor += 1;
  }
  return Math.min(cursor + 1, value.length);
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code < 0x20 && char !== "\n" && char !== "\t") || (code >= 0x7f && code <= 0x9f);
}

function applySgr(params: string, style: AnsiStyle): void {
  const values = params.split(";").map((value) => (/^\d+$/u.test(value) ? Number(value) : null));
  if (values.length === 0) values.push(0);

  for (let index = 0; index < values.length; index += 1) {
    const code = values[index] ?? 0;
    if (code === 38 || code === 48) {
      const colorSpace = values[index + 1];
      index += colorSpace === 2 ? 4 : colorSpace === 5 ? 2 : 0;
      continue;
    }
    if (code === 0) {
      style.foreground = null;
      style.background = null;
      style.bold = false;
      style.dim = false;
    } else if (code === 1) {
      style.bold = true;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 39) {
      style.foreground = null;
    } else if (code === 49) {
      style.background = null;
    } else if (code >= 30 && code <= 37) {
      style.foreground = code - 30;
    } else if (code >= 40 && code <= 47) {
      style.background = code - 40;
    } else if (code >= 90 && code <= 97) {
      style.foreground = code - 90 + 8;
    } else if (code >= 100 && code <= 107) {
      style.background = code - 100 + 8;
    }
  }
}

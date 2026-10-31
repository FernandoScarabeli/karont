export type SseParser = {
  push(chunk: string): void;
  reset(): void;
};

export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = "";
  let dataLines: string[] = [];

  function dispatch(): void {
    if (dataLines.length > 0) onData(dataLines.join("\n"));
    dataLines = [];
  }

  function processLine(line: string): void {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    let value = line.slice("data:".length);
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      buffer = buffer.replace(/\r\n/g, "\n");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    reset(): void {
      buffer = "";
      dataLines = [];
    },
  };
}

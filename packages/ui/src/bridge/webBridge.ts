import {
  type AnyEvent,
  BridgeError,
  ERROR_CODES,
  type KarontBridge,
  type MethodName,
  type ParamsOf,
  parseEvent,
  parseResult,
  type ResultOf,
} from "@karont/contract";
import { createSseParser } from "./sse.ts";

const retryDelays = [500, 1_000, 2_000, 4_000, 8_000, 10_000] as const;

export function createWebBridge(token: string): KarontBridge {
  const listeners = new Set<(event: AnyEvent) => void>();
  let controller: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryIndex = 0;

  function publish(event: AnyEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A listener must not prevent delivery to the remaining listeners.
      }
    }
  }

  function publishStatus(state: "connected" | "disconnected"): void {
    const parsed = parseEvent({ type: "event", event: "bridge.status", payload: { state } });
    if (parsed.ok) publish(parsed.event);
  }

  function scheduleRetry(): void {
    if (listeners.size === 0 || retryTimer !== undefined) return;
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)] ?? 10_000;
    retryIndex += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      startStream();
    }, delay);
  }

  async function readStream(signal: AbortSignal): Promise<void> {
    try {
      const response = await fetch("/__karont/events", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok || !response.body) throw new Error("A ponte de eventos está indisponível.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser((data) => {
        try {
          const value: unknown = JSON.parse(data);
          if (typeof value !== "object" || value === null) return;
          const frame = value as { event?: unknown; payload?: unknown };
          const parsed = parseEvent({ type: "event", event: frame.event, payload: frame.payload });
          if (parsed.ok) publish(parsed.event);
        } catch {
          // Malformed SSE data is ignored; the stream remains usable.
        }
      });
      retryIndex = 0;
      while (listeners.size > 0) {
        const { done, value } = await reader.read();
        if (done) throw new Error("O fluxo de eventos foi encerrado.");
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      if (!signal.aborted && listeners.size > 0) {
        publishStatus("disconnected");
        scheduleRetry();
      }
    }
  }

  function startStream(): void {
    if (listeners.size === 0 || controller) return;
    controller = new AbortController();
    const activeController = controller;
    void readStream(activeController.signal).finally(() => {
      if (controller === activeController) {
        controller = undefined;
      }
    });
  }

  function stopStream(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    controller?.abort();
    controller = undefined;
    retryIndex = 0;
  }

  return {
    async request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
      let response: Response;
      try {
        response = await fetch("/__karont/request", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ method, params }),
        });
      } catch {
        throw new BridgeError("unavailable", "Não foi possível alcançar a ponte do preview.");
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new BridgeError("unavailable", "A ponte do preview retornou uma resposta inválida.");
      }
      if (typeof body !== "object" || body === null || !("ok" in body)) {
        throw new BridgeError("unavailable", "A ponte do preview retornou uma resposta inválida.");
      }
      const resultBody = body as { ok?: unknown; result?: unknown; error?: unknown };
      if (resultBody.ok === false) {
        const error = resultBody.error;
        if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
          const detail = error as { code: unknown; message: unknown };
          if (
            typeof detail.code === "string" &&
            (ERROR_CODES as readonly string[]).includes(detail.code) &&
            typeof detail.message === "string"
          ) {
            throw new BridgeError(detail.code as (typeof ERROR_CODES)[number], detail.message);
          }
        }
        throw new BridgeError(
          "unavailable",
          "A ponte do preview não conseguiu concluir a requisição.",
        );
      }
      if (resultBody.ok !== true) {
        throw new BridgeError("unavailable", "A ponte do preview retornou uma resposta inválida.");
      }
      const parsed = parseResult(method, resultBody.result);
      if (!parsed.ok) throw new BridgeError(parsed.error.code, parsed.error.message);
      return parsed.result;
    },
    onEvent(listener): () => void {
      listeners.add(listener);
      if (listeners.size === 1) startStream();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopStream();
      };
    },
  };
}

import {
  BridgeError,
  ERROR_CODES,
  type KarontBridge,
  type MethodName,
  type NativeBridge,
  type NativeResult,
  type ParamsOf,
  type PickFolderOptions,
  type PickFolderResult,
  parseEvent,
  parseResult,
  type ResultOf,
} from "@karont/contract";
import { createWebBridge } from "./webBridge.ts";

declare global {
  interface Window {
    karont?: KarontBridge;
    karontNative?: NativeBridge;
  }
}

export function getBridge(): KarontBridge | null {
  if (typeof window === "undefined") return null;
  if (bridge !== undefined) return bridge;
  if (window.karontNative) {
    bridge = createNativeBridge(window.karontNative);
    return bridge;
  }
  if (window.karont) {
    bridge = window.karont;
    return bridge;
  }
  if (!import.meta.env.DEV) return null;
  const token = document.querySelector<HTMLMetaElement>('meta[name="karont-dev-bridge"]')?.content;
  if (!token) return null;
  bridge = createWebBridge(token);
  return bridge;
}

let bridge: KarontBridge | undefined;

function createNativeBridge(native: NativeBridge): KarontBridge {
  return {
    async request<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
      let response: NativeResult;
      try {
        response = await native.request(method, params);
      } catch {
        throw new BridgeError("unavailable", "Não foi possível alcançar a ponte nativa.");
      }

      if (!isRecord(response) || typeof response.ok !== "boolean") {
        throw new BridgeError("internal", "A ponte nativa retornou uma resposta inválida.");
      }
      if (response.ok === false) {
        if (
          !isRecord(response.error) ||
          typeof response.error.code !== "string" ||
          !(ERROR_CODES as readonly string[]).includes(response.error.code) ||
          typeof response.error.message !== "string" ||
          response.error.message.length > 2_000
        ) {
          throw new BridgeError("internal", "A ponte nativa retornou um erro inválido.");
        }
        throw new BridgeError(
          response.error.code as (typeof ERROR_CODES)[number],
          response.error.message,
        );
      }

      const parsed = parseResult(method, response.result);
      if (!parsed.ok) throw new BridgeError(parsed.error.code, parsed.error.message);
      return parsed.result;
    },
    onEvent(listener): () => void {
      return native.onEvent((value) => {
        if (!isRecord(value)) return;
        const parsed = parseEvent({
          type: "event",
          event: value.event,
          payload: value.payload,
        });
        if (!parsed.ok) return;
        try {
          listener(parsed.event);
        } catch {
          // Um consumidor não deve impedir a entrega a outros ouvintes.
        }
      });
    },
    async pickFolder(options?: PickFolderOptions): Promise<PickFolderResult> {
      try {
        return await native.pickFolder(options);
      } catch {
        return null;
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

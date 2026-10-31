import { createKarontBridge } from '../shared/createBridge';
import type { KarontBridge } from '../shared/bridge';

type RpcResponse = { ok: true; value?: unknown } | { ok: false; error: string };

export function createWebBridge(token: string): KarontBridge {
  let eventSource: EventSource | undefined;

  return createKarontBridge({
    runtime: { sandboxed: false, contextIsolated: false },
    invoke: async (channel, value) => {
      const response = await fetch('/__karont/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-karont-preview-token': token,
        },
        body: JSON.stringify(value === undefined ? { channel } : { channel, value }),
      });
      if (response.status !== 200)
        throw new Error(`HTTP ${response.status} ao invocar o canal '${channel}'.`);

      const result = (await response.json()) as RpcResponse;
      if (!result.ok)
        throw new Error(`Error invoking remote method '${channel}': Error: ${result.error}`);
      return result.value;
    },
    on: (channel, listener) => {
      eventSource ??= new EventSource(`/__karont/events?token=${encodeURIComponent(token)}`);
      const handler: EventListener = (event) => {
        listener(JSON.parse((event as MessageEvent<string>).data));
      };
      eventSource.addEventListener(channel, handler);
      return () => eventSource?.removeEventListener(channel, handler);
    },
  });
}

import type { KarontBridge } from '../../shared/bridge';

export type * from '../../shared/bridge';

declare global {
  interface Window {
    karont: KarontBridge;
  }
}

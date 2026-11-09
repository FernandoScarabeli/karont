import type { DatabaseSync } from "node:sqlite";
import type { AgentUsage, AnyEvent } from "@karont/contract";
import type { AgentAdapterRegistration } from "./adapter.ts";
import { recordUsage } from "./usage.ts";

export const USAGE_REFRESH_MIN_MS = 120_000;
export const USAGE_REFRESH_FORCE_MIN_MS = 5_000;

export type UsageRefresherOptions = {
  db: DatabaseSync;
  dataDir: string;
  /** Ids dos agentes encontrados (já respeita a detecção desligada). */
  foundAgents: () => Promise<string[]>;
  registrations: () => ReadonlyMap<string, AgentAdapterRegistration>;
  emit: (event: AnyEvent) => Promise<void>;
  list: () => AgentUsage[];
  now?: () => number;
};

// Lê o uso dos agentes sem mandar mensagem: um agente por vez, uma leitura por vez.
export class UsageRefresher {
  readonly #options: UsageRefresherOptions;
  readonly #now: () => number;
  #running: Promise<AgentUsage[]> | undefined;
  #lastFinishedAt: number | undefined;
  #controller: AbortController | undefined;
  #disposed = false;

  constructor(options: UsageRefresherOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  refresh({ force = false }: { force?: boolean } = {}): Promise<AgentUsage[]> {
    if (this.#running) return this.#running;
    if (this.#disposed) return Promise.resolve(this.#safeList());
    const minimum = force ? USAGE_REFRESH_FORCE_MIN_MS : USAGE_REFRESH_MIN_MS;
    if (this.#lastFinishedAt !== undefined && this.#now() - this.#lastFinishedAt < minimum)
      return Promise.resolve(this.#safeList());
    const controller = new AbortController();
    this.#controller = controller;
    const running = this.#execute(controller);
    this.#running = running;
    return running;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#controller?.abort();
    await this.#running?.catch(() => undefined);
  }

  async #execute(controller: AbortController): Promise<AgentUsage[]> {
    try {
      await this.#run(controller.signal);
    } catch {
      // Nunca rejeita.
    }
    this.#running = undefined;
    this.#controller = undefined;
    this.#lastFinishedAt = this.#now();
    return this.#safeList();
  }

  #safeList(): AgentUsage[] {
    try {
      return this.#options.list();
    } catch {
      return [];
    }
  }

  async #run(signal: AbortSignal): Promise<void> {
    let found: string[];
    try {
      found = await this.#options.foundAgents();
    } catch {
      return;
    }
    const registrations = this.#options.registrations();
    for (const agent of found) {
      if (signal.aborted) return;
      const readUsage = registrations.get(agent)?.readUsage;
      if (!readUsage) continue;
      try {
        const windows = await readUsage({ dataDir: this.#options.dataDir, signal });
        if (signal.aborted) return;
        const usage = recordUsage(
          this.#options.db,
          agent,
          windows,
          new Date(this.#now()).toISOString(),
        );
        if (usage) await this.#options.emit({ event: "usage.updated", payload: usage });
      } catch {
        // Uma falha não impede o próximo agente nem apaga o valor guardado.
      }
    }
  }
}

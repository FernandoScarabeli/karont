import type { DatabaseSync } from "node:sqlite";
import type { Agent } from "@karont/contract";
import {
  addCustomAgent,
  type CustomAgentRecord,
  listCustomAgents,
  removeCustomAgent,
} from "../db.ts";
import { ServiceError } from "../errors.ts";
import { agentCatalog } from "./catalog.ts";
import {
  type AgentDetectionOptions,
  type DetectedAgent,
  detectAgents,
  resolveAgentCommand,
} from "./detect.ts";

export type AgentListResult = { agents: Agent[]; detectedAt: string };

export class AgentRegistry {
  private cachedDetection: DetectedAgent[] | undefined;
  private cachedCustomPaths = new Map<string, string | undefined>();
  private detectedAt: string | undefined;
  private detectionPromise: Promise<void> | undefined;
  private readonly db: DatabaseSync;
  private readonly options: AgentDetectionOptions;

  constructor(db: DatabaseSync, options: AgentDetectionOptions) {
    this.db = db;
    this.options = options;
  }

  async list(): Promise<AgentListResult> {
    if (this.detectionPromise) await this.detectionPromise;
    else if (!this.cachedDetection) await this.refreshDetection();
    return this.makeListResult();
  }

  async detect(): Promise<AgentListResult> {
    await this.refreshDetection();
    return this.makeListResult();
  }

  async add({ name, command }: { name: string; command: string }): Promise<{ agent: Agent }> {
    const resolvedPath = await resolveAgentCommand(command, this.options);
    if (!resolvedPath) {
      throw new ServiceError("invalid_request", "Não encontrei um executável para esse comando.");
    }

    const normalizedName = name.toLowerCase();
    const knownName = agentCatalog.some((agent) => agent.name.toLowerCase() === normalizedName);
    const customName = listCustomAgents(this.db).some(
      (agent) => agent.name.toLowerCase() === normalizedName,
    );
    if (knownName || customName) {
      throw new ServiceError("invalid_request", "Já existe um agente com esse nome.");
    }

    const record = addCustomAgent(this.db, { name, command });
    this.cachedCustomPaths.set(record.id, resolvedPath);
    return { agent: toCustomAgent(record, resolvedPath) };
  }

  remove(id: string): { removed: true } {
    if (agentCatalog.some((agent) => agent.id === id) || !removeCustomAgent(this.db, id)) {
      throw new ServiceError("invalid_request", "Esse agente não existe ou não pode ser removido.");
    }
    this.cachedCustomPaths.delete(id);
    return { removed: true };
  }

  private refreshDetection(): Promise<void> {
    if (this.detectionPromise) return this.detectionPromise;
    const detectionPromise = (async () => {
      const detected = await detectAgents(this.options);
      const customRecords = listCustomAgents(this.db);
      const customPaths = new Map<string, string | undefined>();
      await Promise.all(
        customRecords.map(async (record) => {
          const resolvedPath =
            this.options.env.KARONT_DISABLE_AGENT_DETECTION === "1"
              ? undefined
              : await resolveAgentCommand(record.command, this.options);
          customPaths.set(record.id, resolvedPath);
        }),
      );
      this.cachedDetection = detected;
      this.cachedCustomPaths = customPaths;
      this.detectedAt = new Date().toISOString();
    })();
    this.detectionPromise = detectionPromise;
    void detectionPromise.then(
      () => {
        if (this.detectionPromise === detectionPromise) this.detectionPromise = undefined;
      },
      () => {
        if (this.detectionPromise === detectionPromise) this.detectionPromise = undefined;
      },
    );
    return detectionPromise;
  }

  private makeListResult(): AgentListResult {
    const detectedAt = this.detectedAt;
    if (!detectedAt || !this.cachedDetection)
      throw new Error("Detecção de agentes não inicializada.");
    const knownAgents = this.cachedDetection.map(toKnownAgent);
    const customAgents = listCustomAgents(this.db).map((record) =>
      toCustomAgent(record, this.cachedCustomPaths.get(record.id)),
    );
    return { agents: [...knownAgents, ...customAgents], detectedAt };
  }
}

function toKnownAgent(agent: DetectedAgent): Agent {
  return {
    id: agent.id,
    name: agent.name,
    kind: "known",
    structured: agent.structured,
    found: agent.found,
    ...(agent.path ? { path: agent.path } : {}),
  };
}

function toCustomAgent(record: CustomAgentRecord, resolvedPath?: string): Agent {
  return {
    id: record.id,
    name: record.name,
    kind: "custom",
    structured: false,
    found: resolvedPath !== undefined,
    ...(resolvedPath ? { path: resolvedPath } : {}),
    command: record.command,
  };
}

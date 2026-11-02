import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import path from "node:path";
import { agentCatalog } from "./catalog.ts";

export type AgentDetectionFs = {
  access(filePath: string, mode?: number): Promise<void>;
  stat(filePath: string): Promise<{ isFile(): boolean }>;
  readdir(directoryPath: string): Promise<string[]>;
};

export type AgentDetectionOptions = {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  fs?: AgentDetectionFs;
};

export type DetectedAgent = {
  id: string;
  name: string;
  structured: boolean;
  found: boolean;
  path?: string;
};

const defaultFs: AgentDetectionFs = {
  access: nodeFs.access,
  stat: nodeFs.stat,
  readdir: async (directoryPath) => nodeFs.readdir(directoryPath),
};

export async function detectAgents(options: AgentDetectionOptions): Promise<DetectedAgent[]> {
  if (options.env.KARONT_DISABLE_AGENT_DETECTION === "1") {
    return agentCatalog.map(({ id, name, structured }) => ({ id, name, structured, found: false }));
  }

  const directories = await getSearchDirectories(options, true);
  const fs = options.fs ?? defaultFs;
  const agents: DetectedAgent[] = [];

  for (const catalogEntry of agentCatalog) {
    let foundPath: string | undefined;
    for (const binary of catalogEntry.binaries) {
      const searchDirectories =
        binary === "claude"
          ? directories
          : directories.filter(
              (directory) =>
                directory !==
                getPathApi(options.platform).resolve(options.homeDir, ".claude/local"),
            );
      foundPath = await findInDirectories(
        binary,
        searchDirectories,
        fs,
        getPathApi(options.platform),
      );
      if (foundPath) break;
    }
    agents.push({
      id: catalogEntry.id,
      name: catalogEntry.name,
      structured: catalogEntry.structured,
      found: foundPath !== undefined,
      ...(foundPath ? { path: foundPath } : {}),
    });
  }
  return agents;
}

export async function resolveAgentCommand(
  command: string,
  options: AgentDetectionOptions,
): Promise<string | undefined> {
  if (options.env.KARONT_DISABLE_AGENT_DETECTION === "1") return undefined;

  const fs = options.fs ?? defaultFs;
  const pathApi = getPathApi(options.platform);
  if (command.startsWith("/")) {
    const resolvedPath = pathApi.resolve(command);
    return (await isExecutableFile(resolvedPath, fs)) ? resolvedPath : undefined;
  }

  const directories = await getSearchDirectories(options, command === "claude");
  return findInDirectories(command, directories, fs, pathApi);
}

async function getSearchDirectories(
  options: AgentDetectionOptions,
  includeClaudeLocal: boolean,
): Promise<string[]> {
  const pathApi = getPathApi(options.platform);
  const directories: string[] = [];
  const pathValue = options.env.PATH ?? "";
  for (const directory of pathValue.split(pathApi.delimiter)) {
    if (directory.length > 0) directories.push(directory);
  }

  directories.push(
    pathApi.join(options.homeDir, ".local/bin"),
    pathApi.join(options.homeDir, "bin"),
    pathApi.join(options.homeDir, ".npm-global/bin"),
    pathApi.join(options.homeDir, ".bun/bin"),
    pathApi.join(options.homeDir, ".cargo/bin"),
  );
  if (includeClaudeLocal) directories.push(pathApi.join(options.homeDir, ".claude/local"));
  directories.push("/usr/local/bin", "/usr/bin");

  const nvmNodeDirectory = pathApi.join(options.homeDir, ".nvm/versions/node");
  try {
    const versions = await (options.fs ?? defaultFs).readdir(nvmNodeDirectory);
    versions.sort(compareVersionsDescending);
    for (const version of versions) {
      directories.push(pathApi.join(nvmNodeDirectory, version, "bin"));
    }
  } catch {
    // Uma instalação ausente ou sem permissão não impede a detecção nas demais pastas.
  }

  const seen = new Set<string>();
  return directories.flatMap((directory) => {
    const normalized = pathApi.resolve(directory);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

async function findInDirectories(
  binary: string,
  directories: string[],
  fs: AgentDetectionFs,
  pathApi: typeof path.posix | typeof path.win32,
): Promise<string | undefined> {
  for (const directory of directories) {
    const candidate = pathApi.join(directory, binary);
    if (await isExecutableFile(candidate, fs)) return candidate;
  }
  return undefined;
}

async function isExecutableFile(filePath: string, fs: AgentDetectionFs): Promise<boolean> {
  try {
    await fs.access(filePath, constants.X_OK);
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function getPathApi(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

function compareVersionsDescending(first: string, second: string): number {
  const firstParts = first.match(/\d+|\D+/g) ?? [first];
  const secondParts = second.match(/\d+|\D+/g) ?? [second];
  const maxLength = Math.max(firstParts.length, secondParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const firstPart = firstParts[index] ?? "";
    const secondPart = secondParts[index] ?? "";
    const firstNumeric = /^\d+$/.test(firstPart);
    const secondNumeric = /^\d+$/.test(secondPart);
    let comparison = 0;
    if (firstNumeric && secondNumeric) {
      comparison = firstPart.length - secondPart.length || firstPart.localeCompare(secondPart);
    } else {
      comparison = firstPart.localeCompare(secondPart);
    }
    if (comparison !== 0) return -comparison;
  }
  return second.localeCompare(first);
}

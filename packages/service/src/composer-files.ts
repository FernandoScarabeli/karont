import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ComposerSkill } from "@karont/contract";
import { ServiceError } from "./errors.ts";

const FILE_CACHE_TTL_MS = 10_000;
const MAX_INDEXED_FILES = 25_000;
const MAX_VISITED_ENTRIES = 50_000;
const MAX_DIRECTORY_DEPTH = 32;
const MAX_RESULTS = 50;
const IGNORED_DIRECTORY_NAMES = new Set(["node_modules", ".git", "dist", "build"]);

type FileCacheEntry = { cachedAt: number; paths: string[] };
type GitFileLister = (cwd: string) => Promise<string[] | null>;

export class ComposerFileSearch {
  readonly #cache = new Map<string, FileCacheEntry>();
  readonly #now: () => number;
  readonly #listGitFiles: GitFileLister;

  constructor(now: () => number = Date.now, gitFileLister: GitFileLister = listGitFiles) {
    this.#now = now;
    this.#listGitFiles = gitFileLister;
  }

  async search(cwd: string, query: string): Promise<{ path: string; name: string }[]> {
    const root = path.resolve(cwd);
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(root);
    } catch {
      throw new ServiceError("invalid_request", `A pasta do projeto não existe: ${root}`);
    }
    if (!details.isDirectory()) {
      throw new ServiceError("invalid_request", `O caminho do projeto não é uma pasta: ${root}`);
    }

    const paths = await this.#files(root);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return paths
      .map((filePath) => ({ path: filePath, name: path.posix.basename(filePath) }))
      .map((file) => ({ ...file, score: fileScore(file.path, file.name, normalizedQuery) }))
      .filter((file) => file.score >= 0)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, MAX_RESULTS)
      .map(({ path: filePath, name }) => ({ path: filePath, name }));
  }

  async #files(root: string): Promise<string[]> {
    const cached = this.#cache.get(root);
    if (cached && this.#now() - cached.cachedAt < FILE_CACHE_TTL_MS) return cached.paths;
    if (cached) this.#cache.delete(root);

    const gitPaths = await this.#listGitFiles(root);
    const paths = gitPaths ?? (await walkFiles(root));
    this.#cache.set(root, { cachedAt: this.#now(), paths });
    while (this.#cache.size > 32) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    return paths;
  }
}

export type SkillLoader = (cwd: string) => Promise<ComposerSkill[]>;

function listGitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, encoding: "utf8", timeout: 2_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const paths = stdout.split("\0").filter(isSafeRelativePath).slice(0, MAX_INDEXED_FILES);
        resolve(paths);
      },
    );
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [{ path: "", depth: 0 }];
  let visitedEntries = 0;
  while (
    pending.length &&
    files.length < MAX_INDEXED_FILES &&
    visitedEntries < MAX_VISITED_ENTRIES
  ) {
    const directory = pending.pop();
    if (!directory) break;
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(root, directory.path), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_INDEXED_FILES || visitedEntries >= MAX_VISITED_ENTRIES) break;
      visitedEntries += 1;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name) && directory.depth < MAX_DIRECTORY_DEPTH) {
          pending.push({
            path: path.posix.join(directory.path, entry.name),
            depth: directory.depth + 1,
          });
        }
      } else if (entry.isFile()) {
        const filePath = path.posix.join(directory.path, entry.name);
        if (filePath) files.push(filePath);
      }
    }
  }
  return files;
}

function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0") || path.posix.isAbsolute(filePath)) return false;
  const normalized = filePath.replaceAll("\\", "/");
  return !normalized.split("/").some((segment) => segment === "..");
}

function fileScore(filePath: string, fileName: string, query: string): number {
  if (!query) return 0;
  const name = subsequenceScore(fileName.toLocaleLowerCase(), query);
  const fullPath = subsequenceScore(filePath.toLocaleLowerCase(), query);
  if (name < 0 && fullPath < 0) return -1;
  if (name >= 0) return (fileName.toLocaleLowerCase().includes(query) ? 2_000 : 1_000) + name;
  return 300 + fullPath;
}

function subsequenceScore(value: string, query: string): number {
  let queryIndex = 0;
  let previousIndex = -2;
  let score = 0;
  for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    score += previousIndex + 1 === index ? 12 : 2;
    if (queryIndex === 0) score += Math.max(0, 10 - index);
    previousIndex = index;
    queryIndex += 1;
  }
  return queryIndex === query.length ? score - (previousIndex - query.length + 1) : -1;
}

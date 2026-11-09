import { randomBytes } from "node:crypto";
import { realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Worktree, WorktreeStatus } from "@karont/contract";
import {
  countBusyWorktreeConversations,
  createWorktreeRecord,
  deleteWorktreeRecord,
  getProject,
  getWorktree,
} from "../db.ts";
import { ServiceError } from "../errors.ts";
import { ensurePrivateDir } from "../paths.ts";
import { Deadline, GitFailure, resolveRepository, runGit } from "./restore-points.ts";

export const WORKTREE_CREATE_TIMEOUT_MS = 120_000;
export const WORKTREE_REMOVE_TIMEOUT_MS = 30_000;
export const WORKTREE_STATUS_TIMEOUT_MS = 15_000;

const MAX_SLUG_LENGTH = 40;
const MAX_BRANCH_ATTEMPTS = 5;

export type WorktreeOptions = {
  dataDir: string;
  homeDir?: string;
  signal?: AbortSignal;
};

/** Pasta onde ficam todas as cópias: fora de qualquer projeto. */
export function worktreesRoot(dataDir: string): string {
  return path.join(path.resolve(dataDir), "worktrees");
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "projeto";
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function refExists(root: string, ref: string, deadline: Deadline): Promise<boolean> {
  try {
    await runGit(["rev-parse", "-q", "--verify", ref], { cwd: root, deadline });
    return true;
  } catch (error) {
    if (error instanceof GitFailure && error.kind === "exit") return false;
    throw error;
  }
}

function gitUnavailable(error: unknown, action: string): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof GitFailure && error.kind === "timeout") {
    return new ServiceError("unavailable", `O Git demorou demais para ${action}.`);
  }
  const detail =
    error instanceof Error ? error.message.split("\n").slice(0, 2).join(" ").trim() : "";
  return new ServiceError(
    "unavailable",
    `Não foi possível ${action}.${detail ? ` ${detail}` : ""}`,
  );
}

/** Cria a cópia separada (git worktree) de um projeto, fora da pasta dele. */
export async function createWorktree(
  db: DatabaseSync,
  projectId: string,
  options: WorktreeOptions,
): Promise<Worktree> {
  const project = getProject(db, projectId);
  if (!project) throw new ServiceError("invalid_request", "O projeto não existe.");
  const signal = options.signal ?? new AbortController().signal;
  const resolved = await resolveRepository(
    project.path,
    options.homeDir ?? os.homedir(),
    signal,
    WORKTREE_STATUS_TIMEOUT_MS,
  );
  if ("unavailable" in resolved) {
    if (resolved.unavailable === "no-git" || resolved.unavailable === "home") {
      throw new ServiceError(
        "invalid_request",
        "Este projeto não usa Git, então não dá para criar uma cópia separada.",
      );
    }
    throw new ServiceError("unavailable", "O Git não respondeu a tempo. Tente de novo.");
  }
  const repoRoot = resolved.root;
  const deadline = new Deadline(signal, WORKTREE_CREATE_TIMEOUT_MS);
  let createdPath: string | null = null;
  let createdBranch: string | null = null;
  try {
    let baseCommit: string;
    try {
      baseCommit = (
        await runGit(["rev-parse", "-q", "--verify", "HEAD"], { cwd: repoRoot, deadline })
      ).trim();
    } catch (error) {
      if (error instanceof GitFailure && error.kind === "exit") {
        throw new ServiceError("invalid_request", "O repositório precisa de pelo menos um commit.");
      }
      throw error;
    }
    if (!baseCommit) {
      throw new ServiceError("invalid_request", "O repositório precisa de pelo menos um commit.");
    }

    const base = worktreesRoot(options.dataDir);
    await ensurePrivateDir(path.resolve(options.dataDir));
    await ensurePrivateDir(base);

    const slug = slugify(project.name);
    let worktreePath = "";
    let branch = "";
    for (let attempt = 0; attempt < MAX_BRANCH_ATTEMPTS; attempt += 1) {
      const hex = randomBytes(3).toString("hex");
      const candidatePath = path.join(base, `${slug}-${hex}`);
      const candidateBranch = `karont/${slug}-${hex}`;
      if (
        (await pathExists(candidatePath)) ||
        (await refExists(repoRoot, `refs/heads/${candidateBranch}`, deadline))
      ) {
        continue;
      }
      worktreePath = candidatePath;
      branch = candidateBranch;
      break;
    }
    if (!worktreePath) {
      throw new ServiceError(
        "unavailable",
        "Não foi possível escolher um nome livre para a cópia.",
      );
    }

    createdPath = worktreePath;
    createdBranch = branch;
    await runGit(["worktree", "add", "-q", "-b", branch, worktreePath, baseCommit], {
      cwd: repoRoot,
      deadline,
    });
    return createWorktreeRecord(db, {
      projectId: project.id,
      repoRoot,
      path: worktreePath,
      branch,
      baseCommit,
    });
  } catch (error) {
    await cleanupFailedCreate(repoRoot, createdPath, createdBranch);
    throw gitUnavailable(error, "criar a cópia separada");
  } finally {
    deadline.dispose();
  }
}

/** Limpa o que uma criação que falhou possa ter deixado. Melhor esforço, com prazo próprio. */
async function cleanupFailedCreate(
  repoRoot: string,
  createdPath: string | null,
  createdBranch: string | null,
): Promise<void> {
  if (!createdPath && !createdBranch) return;
  const deadline = new Deadline(new AbortController().signal, WORKTREE_REMOVE_TIMEOUT_MS);
  try {
    if (createdPath) {
      await runGit(["worktree", "remove", "--force", createdPath], {
        cwd: repoRoot,
        deadline,
      }).catch(() => undefined);
      await rm(createdPath, { recursive: true, force: true }).catch(() => undefined);
      await runGit(["worktree", "prune"], { cwd: repoRoot, deadline }).catch(() => undefined);
    }
    if (createdBranch) {
      await runGit(["branch", "-D", createdBranch], { cwd: repoRoot, deadline }).catch(
        () => undefined,
      );
    }
  } finally {
    deadline.dispose();
  }
}

function countPorcelainEntries(output: string): number {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  let count = 0;
  for (let index = 0; index < entries.length; index += 1) {
    count += 1;
    const status = entries[index]?.slice(0, 2) ?? "";
    // Renomeação e cópia trazem o caminho antigo como item extra.
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return count;
}

async function computeStatus(
  db: DatabaseSync,
  worktree: Worktree,
  signal: AbortSignal,
): Promise<WorktreeStatus> {
  const deadline = new Deadline(signal, WORKTREE_STATUS_TIMEOUT_MS);
  try {
    const missing = !(await pathExists(worktree.path));
    let dirtyFiles = 0;
    if (!missing) {
      const output = await runGit(["status", "--porcelain", "-z", "--untracked-files=all"], {
        cwd: worktree.path,
        deadline,
      });
      dirtyFiles = countPorcelainEntries(output);
    }
    let unmergedCommits = 0;
    if (await refExists(worktree.repoRoot, `refs/heads/${worktree.branch}`, deadline)) {
      const output = await runGit(["rev-list", "--count", `HEAD..refs/heads/${worktree.branch}`], {
        cwd: worktree.repoRoot,
        deadline,
      });
      unmergedCommits = Number.parseInt(output.trim(), 10) || 0;
    }
    return {
      dirtyFiles,
      unmergedCommits,
      busyConversations: countBusyWorktreeConversations(db, worktree.id),
      missing,
    };
  } finally {
    deadline.dispose();
  }
}

export async function worktreeStatus(
  db: DatabaseSync,
  id: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<WorktreeStatus> {
  const worktree = getWorktree(db, id);
  if (!worktree) throw new ServiceError("invalid_request", "A cópia não existe.");
  try {
    return await computeStatus(db, worktree, signal);
  } catch (error) {
    throw gitUnavailable(error, "ler o estado da cópia");
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Remove a cópia. Só roda por clique do usuário (o chamador decide); aqui garantimos que nada some
 * por engano: conversa ocupada bloqueia sempre, e sujeira ou commits só caem com `force`.
 */
export async function removeWorktree(
  db: DatabaseSync,
  id: string,
  options: WorktreeOptions & { force?: boolean },
): Promise<{ worktree: Worktree; branchKept: boolean }> {
  const worktree = getWorktree(db, id);
  if (!worktree) throw new ServiceError("invalid_request", "A cópia não existe.");
  const signal = options.signal ?? new AbortController().signal;

  const base = worktreesRoot(options.dataDir);
  const resolvedPath = path.resolve(worktree.path);
  if (!isInside(base, resolvedPath)) {
    throw new ServiceError(
      "invalid_request",
      "Esta cópia está fora da pasta do Karont e não será removida.",
    );
  }
  if (await pathExists(resolvedPath)) {
    const [realBase, realTarget] = await Promise.all([
      realpath(base).catch(() => base),
      realpath(resolvedPath),
    ]);
    if (!isInside(realBase, realTarget)) {
      throw new ServiceError(
        "invalid_request",
        "Esta cópia está fora da pasta do Karont e não será removida.",
      );
    }
  }

  let status: WorktreeStatus;
  try {
    status = await computeStatus(db, worktree, signal);
  } catch (error) {
    throw gitUnavailable(error, "ler o estado da cópia");
  }
  if (status.busyConversations > 0) {
    throw new ServiceError(
      "invalid_request",
      `Há ${plural(status.busyConversations, "conversa trabalhando", "conversas trabalhando")} nesta cópia. Espere terminar ou pare o agente antes de remover.`,
    );
  }
  const force = options.force === true;
  if (!force && (status.dirtyFiles > 0 || status.unmergedCommits > 0)) {
    const parts: string[] = [];
    if (status.dirtyFiles > 0) {
      parts.push(plural(status.dirtyFiles, "arquivo com mudanças", "arquivos com mudanças"));
    }
    if (status.unmergedCommits > 0) {
      parts.push(plural(status.unmergedCommits, "commit não trazido", "commits não trazidos"));
    }
    throw new ServiceError(
      "invalid_request",
      `Remover esta cópia perderia ${parts.join(" e ")}. Confirme para remover mesmo assim.`,
    );
  }

  const deadline = new Deadline(signal, WORKTREE_REMOVE_TIMEOUT_MS);
  let branchKept = false;
  try {
    try {
      if (status.missing) {
        await runGit(["worktree", "prune"], { cwd: worktree.repoRoot, deadline });
      } else {
        await runGit(["worktree", "remove", ...(force ? ["--force"] : []), resolvedPath], {
          cwd: worktree.repoRoot,
          deadline,
        });
      }
    } catch (error) {
      throw gitUnavailable(error, "remover a cópia");
    }
    try {
      if (await refExists(worktree.repoRoot, `refs/heads/${worktree.branch}`, deadline)) {
        if (status.unmergedCommits === 0) {
          try {
            await runGit(["branch", "-D", worktree.branch], {
              cwd: worktree.repoRoot,
              deadline,
            });
          } catch {
            branchKept = true;
          }
        } else {
          branchKept = true;
        }
      }
    } catch {
      branchKept = true;
    }
  } finally {
    deadline.dispose();
  }
  deleteWorktreeRecord(db, worktree.id);
  return { worktree, branchKept };
}

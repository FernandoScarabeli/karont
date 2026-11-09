import { randomBytes } from "node:crypto";
import { realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  Worktree,
  WorktreeMergeBlocked,
  WorktreeMergePreview,
  WorktreeStatus,
} from "@karont/contract";
import {
  busyConversationCwds,
  countBusyWorktreeConversations,
  createWorktreeRecord,
  deleteWorktreeRecord,
  getProject,
  getWorktree,
  markWorktreeMerged,
} from "../db.ts";
import { ServiceError } from "../errors.ts";
import { ensurePrivateDir } from "../paths.ts";
import {
  createSnapshot,
  Deadline,
  GitFailure,
  resolveRepository,
  runGit,
} from "./restore-points.ts";

export const WORKTREE_CREATE_TIMEOUT_MS = 120_000;
export const WORKTREE_REMOVE_TIMEOUT_MS = 30_000;
export const WORKTREE_STATUS_TIMEOUT_MS = 15_000;
export const WORKTREE_MERGE_PREVIEW_TIMEOUT_MS = 30_000;
export const WORKTREE_MERGE_TIMEOUT_MS = 60_000;

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

/** Raízes de repositório com um "trazer" em andamento: um de cada vez, para não pisar no merge do outro. */
const mergesInProgress = new Set<string>();

const KARONT_IDENTITY = { name: "Karont", email: "karont@localhost" };

function porcelainPaths(output: string): string[] {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    paths.push(entry.slice(3));
    if (entry.slice(0, 2).includes("R") || entry.slice(0, 2).includes("C")) index += 1;
  }
  return paths;
}

async function normalizedPath(target: string): Promise<string> {
  return realpath(target).catch(() => path.resolve(target));
}

async function hasBusyConversationIn(db: DatabaseSync, root: string): Promise<boolean> {
  const cwds = busyConversationCwds(db);
  if (cwds.length === 0) return false;
  const realRoot = await normalizedPath(root);
  for (const cwd of cwds) {
    for (const candidate of [path.resolve(cwd), await normalizedPath(cwd)]) {
      if (
        candidate === realRoot ||
        candidate === path.resolve(root) ||
        isInside(realRoot, candidate)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Só preenche o que falta: a configuração do usuário vale. */
async function identityEnvironment(cwd: string, deadline: Deadline): Promise<NodeJS.ProcessEnv> {
  const read = async (key: string) =>
    (await runGit(["config", "--get", key], { cwd, deadline, okExitCodes: [1] })).trim();
  const env: NodeJS.ProcessEnv = {};
  if (!(await read("user.name"))) {
    env.GIT_AUTHOR_NAME = KARONT_IDENTITY.name;
    env.GIT_COMMITTER_NAME = KARONT_IDENTITY.name;
  }
  if (!(await read("user.email"))) {
    env.GIT_AUTHOR_EMAIL = KARONT_IDENTITY.email;
    env.GIT_COMMITTER_EMAIL = KARONT_IDENTITY.email;
  }
  return env;
}

/** Prévia do "trazer": só lê. Não mexe em working tree, index, HEAD, stash nem na cópia. */
async function computeMergePreview(
  db: DatabaseSync,
  worktree: Worktree,
  deadline: Deadline,
): Promise<WorktreeMergePreview> {
  const preview: WorktreeMergePreview = {
    targetBranch: null,
    commits: 0,
    uncommittedFiles: 0,
    changedFiles: 0,
    conflicts: [],
    blocked: null,
    targetDirtyFiles: [],
  };
  const block = (blocked: WorktreeMergeBlocked): WorktreeMergePreview => ({ ...preview, blocked });
  const root = worktree.repoRoot;

  if (!(await pathExists(worktree.path))) return block("missing");
  if (countBusyWorktreeConversations(db, worktree.id) > 0) return block("busy");
  if (await hasBusyConversationIn(db, root)) return block("target-busy");

  const targetBranch = (
    await runGit(["symbolic-ref", "-q", "--short", "HEAD"], {
      cwd: root,
      deadline,
      okExitCodes: [1],
    })
  ).trim();
  if (!targetBranch) return block("detached");
  preview.targetBranch = targetBranch;

  if (await refExists(root, "MERGE_HEAD", deadline)) return block("target-merging");

  const targetStatus = await runGit(["status", "--porcelain", "-z", "--untracked-files=no"], {
    cwd: root,
    deadline,
  });
  const targetDirty = porcelainPaths(targetStatus);
  if (targetDirty.length > 0) {
    preview.targetDirtyFiles = targetDirty;
    return block("target-dirty");
  }

  let tip: string;
  try {
    tip = (
      await runGit(["rev-parse", "-q", "--verify", `refs/heads/${worktree.branch}`], {
        cwd: root,
        deadline,
      })
    ).trim();
  } catch (error) {
    if (error instanceof GitFailure && error.kind === "exit") {
      throw new ServiceError(
        "invalid_request",
        `A branch ${worktree.branch} da cópia não existe mais.`,
      );
    }
    throw error;
  }

  const copyStatus = await runGit(["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: worktree.path,
    deadline,
  });
  preview.uncommittedFiles = countPorcelainEntries(copyStatus);

  let source = tip;
  if (preview.uncommittedFiles > 0) {
    const snapshot = await createSnapshot(worktree.path, deadline.signal, deadline.remaining(), {
      parent: tip,
    });
    if ("unavailable" in snapshot) {
      throw new ServiceError(
        "unavailable",
        snapshot.unavailable === "timeout"
          ? "O Git demorou demais para ler as mudanças da cópia."
          : "Não foi possível ler as mudanças da cópia.",
      );
    }
    source = snapshot.commit;
  }

  const target = `refs/heads/${targetBranch}`;
  const count = await runGit(["rev-list", "--count", `${target}..${source}`], {
    cwd: root,
    deadline,
  });
  preview.commits = Number.parseInt(count.trim(), 10) || 0;
  if (preview.commits === 0) return block("nothing");

  const changed = await runGit(["diff", "--name-only", "-z", `${target}...${source}`], {
    cwd: root,
    deadline,
  });
  preview.changedFiles = changed.split("\0").filter((entry) => entry.length > 0).length;

  const mergeTree = await runGit(
    ["merge-tree", "--write-tree", "--name-only", "-z", target, source],
    {
      cwd: root,
      deadline,
      okExitCodes: [1],
    },
  );
  // Código 1 (conflito): "<tree>\0<arquivo>\0...<arquivo>\0\0<mensagens>". Código 0: só "<tree>\0".
  const parts = mergeTree.split("\0");
  const conflicts: string[] = [];
  for (const entry of parts.slice(1)) {
    if (entry === "") break;
    conflicts.push(entry);
  }
  preview.conflicts = [...new Set(conflicts)];
  return preview;
}

export async function worktreeMergePreview(
  db: DatabaseSync,
  id: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<WorktreeMergePreview> {
  const worktree = getWorktree(db, id);
  if (!worktree) throw new ServiceError("invalid_request", "A cópia não existe.");
  const deadline = new Deadline(signal, WORKTREE_MERGE_PREVIEW_TIMEOUT_MS);
  try {
    return await computeMergePreview(db, worktree, deadline);
  } catch (error) {
    throw gitUnavailable(error, "preparar o que será trazido");
  } finally {
    deadline.dispose();
  }
}

function blockedMessage(preview: WorktreeMergePreview, worktree: Worktree): string | null {
  const target = preview.targetBranch ?? "do projeto";
  switch (preview.blocked) {
    case "missing":
      return "A pasta da cópia não está mais no disco. Não dá para trazer.";
    case "busy":
      return "Há conversa trabalhando nesta cópia. Espere terminar ou pare o agente antes de trazer.";
    case "target-busy":
      return "Há conversa trabalhando na pasta do projeto. Espere terminar ou pare o agente antes de trazer.";
    case "detached":
      return "A pasta do projeto não está em nenhuma branch (HEAD solto). Escolha uma branch antes de trazer.";
    case "target-merging":
      return `A branch ${target} está no meio de um merge. Conclua ou cancele antes de trazer.`;
    case "target-dirty": {
      const files = preview.targetDirtyFiles;
      const list = files.slice(0, 5).join(", ");
      const more = files.length > 5 ? ` e mais ${files.length - 5}` : "";
      return `A branch ${target} tem alterações não salvas (${list}${more}). Salve ou descarte antes de trazer.`;
    }
    case "nothing":
      return `Não há nada novo em ${worktree.branch} para trazer.`;
    default:
      break;
  }
  if (preview.conflicts.length > 0) {
    const files = preview.conflicts.slice(0, 5).join(", ");
    const more = preview.conflicts.length > 5 ? ` e mais ${preview.conflicts.length - 5}` : "";
    return `Há conflito em ${plural(preview.conflicts.length, "arquivo", "arquivos")} (${files}${more}). O Karont não resolve conflitos sozinho.`;
  }
  return null;
}

function mergeFailure(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof GitFailure && error.kind === "exit") {
    const lines = error.message.split("\n").slice(1);
    const overwritten = lines.findIndex((line) =>
      /untracked working tree files would be overwritten/.test(line),
    );
    if (overwritten >= 0) {
      const files = lines
        .slice(overwritten + 1)
        .filter((line) => line.startsWith("\t"))
        .map((line) => line.trim());
      return new ServiceError(
        "invalid_request",
        `Há arquivos na pasta do projeto que ainda não estão no Git e seriam sobrescritos (${files.join(", ")}). Mova ou salve esses arquivos e tente de novo. Nada foi trazido.`,
      );
    }
    const detail = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");
    return new ServiceError(
      "invalid_request",
      `O Git não conseguiu trazer as mudanças.${detail ? ` ${detail}` : ""} A pasta do projeto ficou como estava.`,
    );
  }
  return gitUnavailable(error, "trazer as mudanças");
}

/** Cancela um merge que ficou pela metade, para o repositório principal voltar a como estava. */
async function abortUnfinishedMerge(root: string): Promise<void> {
  const deadline = new Deadline(new AbortController().signal, WORKTREE_REMOVE_TIMEOUT_MS);
  try {
    if (await refExists(root, "MERGE_HEAD", deadline)) {
      await runGit(["merge", "--abort"], { cwd: root, deadline });
    }
  } catch {
    // Melhor esforço: o erro principal já vai para o usuário.
  } finally {
    deadline.dispose();
  }
}

/**
 * Traz a cópia de volta para a branch do usuário. Só roda por clique. Mudanças não commitadas viram
 * commit na branch da cópia; conflito ou sujeira no destino param tudo sem mexer em nada.
 */
export async function mergeWorktree(
  db: DatabaseSync,
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ worktree: Worktree; commit: string; targetBranch: string }> {
  const found = getWorktree(db, id);
  if (!found) throw new ServiceError("invalid_request", "A cópia não existe.");
  if (mergesInProgress.has(found.repoRoot)) {
    throw new ServiceError(
      "invalid_request",
      "Já há uma cópia sendo trazida para este projeto. Espere terminar.",
    );
  }
  mergesInProgress.add(found.repoRoot);
  const deadline = new Deadline(
    options.signal ?? new AbortController().signal,
    WORKTREE_MERGE_TIMEOUT_MS,
  );
  try {
    const root = found.repoRoot;
    let preview: WorktreeMergePreview;
    try {
      preview = await computeMergePreview(db, found, deadline);
    } catch (error) {
      throw gitUnavailable(error, "preparar o que será trazido");
    }
    const message = blockedMessage(preview, found);
    if (message || !preview.targetBranch) {
      throw new ServiceError("invalid_request", message ?? "Não foi possível trazer.");
    }
    const targetBranch = preview.targetBranch;

    try {
      if (preview.uncommittedFiles > 0) {
        const env = await identityEnvironment(found.path, deadline);
        await runGit(["add", "-A"], { cwd: found.path, deadline });
        await runGit(["commit", "-q", "--no-verify", "-m", "karont: mudanças da cópia separada"], {
          cwd: found.path,
          deadline,
          env,
        });
      }
    } catch (error) {
      throw gitUnavailable(error, "guardar as mudanças da cópia");
    }

    try {
      const env = await identityEnvironment(root, deadline);
      await runGit(
        [
          "merge",
          "--no-edit",
          "--no-verify",
          "-m",
          `karont: traz ${found.branch}`,
          `refs/heads/${found.branch}`,
        ],
        { cwd: root, deadline, env },
      );
    } catch (error) {
      await abortUnfinishedMerge(root);
      throw mergeFailure(error);
    }

    let commit: string;
    try {
      commit = (await runGit(["rev-parse", "HEAD"], { cwd: root, deadline })).trim();
    } catch (error) {
      throw gitUnavailable(error, "ler o resultado do merge");
    }
    const worktree = markWorktreeMerged(db, found.id) ?? found;
    return { worktree, commit, targetBranch };
  } finally {
    deadline.dispose();
    mergesInProgress.delete(found.repoRoot);
  }
}

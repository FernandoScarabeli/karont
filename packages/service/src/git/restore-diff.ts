import { lstat, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  createSnapshot,
  Deadline,
  GitFailure,
  restoreRef,
  runGit,
  undoRef,
  writeRestoreRef,
} from "./restore-points.ts";

export const LIST_TIMEOUT_MS = 15_000;
export const DIFF_TIMEOUT_MS = 15_000;
export const UNDO_TIMEOUT_MS = 30_000;
export const MAX_CHANGED_FILES = 2_000;
export const MAX_PATCH_BYTES = 256 * 1024;
const PATCH_READ_BYTES = 1024 * 1024;
const SUBMODULE_MODE = "160000";

export type RestoreFileStatus = "added" | "modified" | "deleted" | "renamed";

export type RestoreFileChange = {
  path: string;
  oldPath?: string;
  status: RestoreFileStatus;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

export type RestoreChanges = { files: RestoreFileChange[]; truncated: boolean };
export type RestorePatch = { patch: string; binary: boolean; truncated: boolean };

export type RestoreErrorKind = "gone" | "timeout" | "aborted" | "failed" | "not-in-list";

/** Falha de leitura ou de desfazer, já com texto para o usuário. */
export class RestoreError extends Error {
  readonly kind: RestoreErrorKind;
  constructor(kind: RestoreErrorKind, message?: string) {
    super(message ?? defaultMessage(kind));
    this.kind = kind;
  }
}

function defaultMessage(kind: RestoreErrorKind): string {
  switch (kind) {
    case "gone":
      return "Este ponto de restauração não está mais disponível.";
    case "timeout":
      return "O Git demorou demais para responder. Tente de novo.";
    case "aborted":
      return "A operação foi interrompida.";
    case "not-in-list":
      return "Este arquivo não está nas mudanças desse ponto de restauração.";
    default:
      return "Não foi possível ler o repositório Git.";
  }
}

function toRestoreError(error: unknown): RestoreError {
  if (error instanceof RestoreError) return error;
  if (error instanceof GitFailure) {
    if (error.kind === "timeout") return new RestoreError("timeout");
    if (error.kind === "aborted") return new RestoreError("aborted");
  }
  return new RestoreError("failed");
}

type PointCommits = { conversationId: string; messageId: string; before: string; after: string };

/** A ref e o commit precisam existir e coincidir com o banco; senão o ponto sumiu (limpeza, gc). */
async function assertPointExists(
  root: string,
  point: PointCommits,
  deadline: Deadline,
): Promise<void> {
  const checks: Array<[string, string]> = [
    [restoreRef(point.conversationId, point.messageId, "before"), point.before],
    [restoreRef(point.conversationId, point.messageId, "after"), point.after],
  ];
  for (const [ref, commit] of checks) {
    let resolved = "";
    try {
      resolved = (
        await runGit(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: root, deadline })
      ).trim();
    } catch (error) {
      if (error instanceof GitFailure && error.kind === "exit") throw new RestoreError("gone");
      throw error;
    }
    if (resolved !== commit) throw new RestoreError("gone");
  }
}

function tokens(output: string): string[] {
  const parts = output.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

type NameStatus = { status: RestoreFileStatus; path: string; oldPath?: string };

function parseNameStatus(output: string): NameStatus[] {
  const parts = tokens(output);
  const entries: NameStatus[] = [];
  for (let index = 0; index < parts.length; ) {
    const code = parts[index++] ?? "";
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = parts[index++];
      const newPath = parts[index++];
      if (oldPath === undefined || newPath === undefined) break;
      entries.push(
        letter === "R"
          ? { status: "renamed", path: newPath, oldPath }
          : { status: "added", path: newPath },
      );
      continue;
    }
    const filePath = parts[index++];
    if (filePath === undefined) break;
    entries.push({
      status: letter === "A" ? "added" : letter === "D" ? "deleted" : "modified",
      path: filePath,
    });
  }
  return entries;
}

type NumStat = { additions: number | null; deletions: number | null; binary: boolean };

function parseNumstat(output: string): Map<string, NumStat> {
  const parts = tokens(output);
  const stats = new Map<string, NumStat>();
  for (let index = 0; index < parts.length; ) {
    const record = parts[index++] ?? "";
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record);
    if (!match) continue;
    let filePath = match[3] ?? "";
    if (filePath === "") {
      index += 1; // caminho antigo de uma renomeação
      filePath = parts[index++] ?? "";
    }
    const binary = match[1] === "-" && match[2] === "-";
    stats.set(filePath, {
      additions: binary ? null : Number(match[1]),
      deletions: binary ? null : Number(match[2]),
      binary,
    });
  }
  return stats;
}

async function readChanges(
  root: string,
  before: string,
  after: string,
  deadline: Deadline,
  limit: number,
): Promise<RestoreChanges & { total: number }> {
  const [statusOutput, numstatOutput] = [
    await runGit(
      ["diff", "--no-ext-diff", "--find-renames", "--name-status", "-z", before, after],
      {
        cwd: root,
        deadline,
      },
    ),
    await runGit(["diff", "--no-ext-diff", "--find-renames", "--numstat", "-z", before, after], {
      cwd: root,
      deadline,
    }),
  ];
  const entries = parseNameStatus(statusOutput);
  const stats = parseNumstat(numstatOutput);
  const files = entries.slice(0, limit).map((entry): RestoreFileChange => {
    const stat = stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false };
    return { ...entry, ...stat };
  });
  return { files, truncated: entries.length > limit, total: entries.length };
}

/** Arquivos que mudaram entre as duas fotos do turno (até 2000). */
export async function listRestoreChanges(
  root: string,
  point: PointCommits,
  signal: AbortSignal,
  timeoutMs: number = LIST_TIMEOUT_MS,
): Promise<RestoreChanges> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await assertPointExists(root, point, deadline);
    const { files, truncated } = await readChanges(
      root,
      point.before,
      point.after,
      deadline,
      MAX_CHANGED_FILES,
    );
    return { files, truncated };
  } catch (error) {
    throw toRestoreError(error);
  } finally {
    deadline.dispose();
  }
}

/** Só a contagem, para gravar ao fim do turno. Lança em caso de falha. */
export async function countRestoreChanges(
  root: string,
  before: string,
  after: string,
  signal: AbortSignal,
  timeoutMs: number = LIST_TIMEOUT_MS,
): Promise<number> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    const output = await runGit(
      ["diff", "--no-ext-diff", "--find-renames", "--name-status", "-z", before, after],
      { cwd: root, deadline },
    );
    return parseNameStatus(output).length;
  } finally {
    deadline.dispose();
  }
}

/** Patch de um arquivo da lista de mudanças do ponto (até 256 KiB). */
export async function readRestorePatch(
  root: string,
  point: PointCommits,
  filePath: string,
  signal: AbortSignal,
  timeoutMs: number = DIFF_TIMEOUT_MS,
): Promise<RestorePatch> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await assertPointExists(root, point, deadline);
    const { files } = await readChanges(
      root,
      point.before,
      point.after,
      deadline,
      Number.POSITIVE_INFINITY,
    );
    const entry = files.find((file) => file.path === filePath);
    if (!entry) throw new RestoreError("not-in-list");
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const output = await runGit(
      [
        "--literal-pathspecs",
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        point.before,
        point.after,
        "--",
        ...paths,
      ],
      { cwd: root, deadline, maxBuffer: PATCH_READ_BYTES, truncateOverflow: true },
    );
    const bytes = Buffer.from(output, "utf8");
    const truncated = bytes.byteLength > MAX_PATCH_BYTES;
    const patch = truncated
      ? bytes.subarray(0, MAX_PATCH_BYTES).toString("utf8").replace(/�$/, "")
      : output;
    return { patch, binary: entry.binary, truncated };
  } catch (error) {
    throw toRestoreError(error);
  } finally {
    deadline.dispose();
  }
}

type RawEntry = { status: string; path: string; submodule: boolean };

function parseRaw(output: string): RawEntry[] {
  const parts = tokens(output);
  const entries: RawEntry[] = [];
  for (let index = 0; index < parts.length; ) {
    const meta = parts[index++] ?? "";
    const filePath = parts[index++];
    if (filePath === undefined) break;
    const fields = meta.replace(/^:/, "").split(" ");
    entries.push({
      status: fields[4]?.[0] ?? "M",
      path: filePath,
      submodule: fields[0] === SUBMODULE_MODE || fields[1] === SUBMODULE_MODE,
    });
  }
  return entries;
}

async function readRaw(
  root: string,
  before: string,
  after: string,
  deadline: Deadline,
): Promise<RawEntry[]> {
  return parseRaw(
    await runGit(
      ["diff", "--no-ext-diff", "--no-renames", "--raw", "--no-abbrev", "-z", before, after],
      { cwd: root, deadline },
    ),
  );
}

export type UndoPreview = {
  files: number;
  userChanged: string[];
  submodulesSkipped: string[];
};

/** Quais arquivos do ponto o usuário alterou depois do turno. Não grava nada. */
export async function previewUndo(
  root: string,
  point: PointCommits,
  signal: AbortSignal,
  timeoutMs: number = UNDO_TIMEOUT_MS,
): Promise<UndoPreview> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await assertPointExists(root, point, deadline);
    const entries = await readRaw(root, point.before, point.after, deadline);
    const submodulesSkipped = entries.filter((entry) => entry.submodule).map((e) => e.path);
    const mine = new Set(entries.filter((entry) => !entry.submodule).map((entry) => entry.path));
    const current = await createSnapshot(root, deadline.signal, deadline.remaining());
    if ("unavailable" in current) throw new RestoreError(current.unavailable);
    const differing = tokens(
      await runGit(
        ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", point.after, current.commit],
        { cwd: root, deadline },
      ),
    );
    const userChanged = differing.filter((file) => mine.has(file));
    return { files: mine.size, userChanged, submodulesSkipped };
  } catch (error) {
    throw toRestoreError(error);
  } finally {
    deadline.dispose();
  }
}

/**
 * Rede de segurança: fotografa o estado atual e guarda em `.../undo` antes de qualquer arquivo ser
 * tocado. Devolve o commit para o chamador gravar no banco.
 */
export async function saveUndoSafety(
  root: string,
  point: PointCommits,
  signal: AbortSignal,
  timeoutMs: number = UNDO_TIMEOUT_MS,
): Promise<string> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await assertPointExists(root, point, deadline);
    const current = await createSnapshot(root, deadline.signal, deadline.remaining());
    if ("unavailable" in current) throw new RestoreError(current.unavailable);
    const written = await writeRestoreRef(
      root,
      undoRef(point.conversationId, point.messageId),
      current.commit,
      deadline.signal,
      deadline.remaining(),
    );
    if ("unavailable" in written) throw new RestoreError(written.unavailable);
    return current.commit;
  } catch (error) {
    throw toRestoreError(error);
  } finally {
    deadline.dispose();
  }
}

function isInside(rootReal: string, candidate: string): boolean {
  return candidate === rootReal || candidate.startsWith(rootReal + path.sep);
}

/** Apaga arquivos criados pelo agente sem sair da raiz nem seguir link simbólico. */
async function removeCreatedFiles(
  root: string,
  files: readonly string[],
  signal: AbortSignal,
): Promise<number> {
  const rootReal = await realpath(root);
  const parents = new Set<string>();
  let removed = 0;
  for (const relative of files) {
    if (signal.aborted) throw new RestoreError("aborted");
    const segments = relative.split("/");
    if (
      !relative ||
      path.isAbsolute(relative) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      segments[0] === ".git"
    )
      continue;
    const absolute = path.join(rootReal, ...segments);
    const parent = path.dirname(absolute);
    let parentReal: string;
    try {
      parentReal = await realpath(parent);
    } catch {
      continue;
    }
    // Um link simbólico em qualquer parte do caminho muda o realpath: nesse caso não apaga nada.
    if (parentReal !== parent || !isInside(rootReal, parentReal)) continue;
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (info.isDirectory()) continue;
    try {
      await unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    removed += 1;
    parents.add(parent);
  }
  const ordered = [...parents].sort((a, b) => b.length - a.length);
  for (const start of ordered) {
    let directory = start;
    while (directory !== rootReal && isInside(rootReal, directory)) {
      try {
        await rmdir(directory);
      } catch {
        break;
      }
      directory = path.dirname(directory);
    }
  }
  return removed;
}

export type UndoOutcome = { restored: number; removed: number };

/**
 * Volta os arquivos do ponto a como estavam antes do turno. Só mexe na árvore de trabalho:
 * HEAD, branches, stash e o index real ficam como estão.
 */
export async function applyUndo(
  root: string,
  point: PointCommits,
  signal: AbortSignal,
  timeoutMs: number = UNDO_TIMEOUT_MS,
): Promise<UndoOutcome> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await assertPointExists(root, point, deadline);
    const entries = (await readRaw(root, point.before, point.after, deadline)).filter(
      (entry) => !entry.submodule,
    );
    const created = entries.filter((entry) => entry.status === "A").map((entry) => entry.path);
    const toRestore = entries.filter((entry) => entry.status !== "A").map((entry) => entry.path);
    const removed = await removeCreatedFiles(root, created, deadline.signal);
    if (toRestore.length > 0) {
      await runGit(
        [
          "--literal-pathspecs",
          "restore",
          `--source=${point.before}`,
          "--worktree",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        { cwd: root, deadline, input: `${toRestore.join("\0")}\0` },
      );
    }
    return { restored: toRestore.length, removed };
  } catch (error) {
    throw toRestoreError(error);
  } finally {
    deadline.dispose();
  }
}

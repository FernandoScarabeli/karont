import { execFile } from "node:child_process";
import { copyFile, mkdtemp, realpath, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RestoreUnavailableReason = "no-git" | "home" | "timeout" | "failed";

export type RepositoryResolution = { root: string } | { unavailable: RestoreUnavailableReason };

export type SnapshotResult =
  | { commit: string; head: string | null }
  | { unavailable: "timeout" | "failed" };

export type RestorePhase = "before" | "after";

/** Pedido de uma foto. `repoRoot` vem preenchido na foto "depois" (a raiz já foi descoberta). */
export type RestoreSnapshotRequest = {
  phase: RestorePhase;
  cwd: string;
  repoRoot: string | null;
  homeDir: string;
  conversationId: string;
  messageId: string;
  signal: AbortSignal;
  timeoutMs: number;
};

export type RestoreSnapshotOutcome =
  | { repoRoot: string; commit: string; head: string | null }
  | { repoRoot: string | null; unavailable: RestoreUnavailableReason };

export const DEFAULT_RESTORE_TIMEOUT_MS = 10_000;
const SNAPSHOT_MESSAGE = "karont: ponto de restauração";
const REF_PATTERN =
  /^refs\/karont\/restore\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:before|after|undo)$/;
const INHERITED_GIT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

export function restoreRef(conversationId: string, messageId: string, phase: RestorePhase): string {
  return `refs/karont/restore/${conversationId}/${messageId}/${phase}`;
}

export function restoreRefs(conversationId: string, messageId: string): string[] {
  return [
    restoreRef(conversationId, messageId, "before"),
    restoreRef(conversationId, messageId, "after"),
    undoRef(conversationId, messageId),
  ];
}

/** Foto de segurança do desfazer: guarda o que o usuário tinha antes de os arquivos serem tocados. */
export function undoRef(conversationId: string, messageId: string): string {
  return `refs/karont/restore/${conversationId}/${messageId}/undo`;
}

export class GitFailure extends Error {
  readonly kind: "timeout" | "aborted" | "exit" | "spawn";
  constructor(kind: GitFailure["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_GIT_VARIABLES) delete env[name];
  env.GIT_OPTIONAL_LOCKS = "0";
  env.LC_ALL = "C";
  env.GIT_TERMINAL_PROMPT = "0";
  return { ...env, ...extra };
}

/** Prazo único para a operação inteira: o relógio e o sinal do chamador valem para todas as chamadas. */
export class Deadline {
  readonly signal: AbortSignal;
  readonly #deadlineAt: number;
  readonly #caller: AbortSignal;
  readonly #cleanup: () => void;

  constructor(caller: AbortSignal, timeoutMs: number) {
    this.#caller = caller;
    this.#deadlineAt = Date.now() + timeoutMs;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, Math.max(1, timeoutMs));
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", abort, { once: true });
    this.signal = controller.signal;
    this.#cleanup = () => {
      clearTimeout(timer);
      caller.removeEventListener("abort", abort);
    };
  }

  remaining(): number {
    return Math.max(1, this.#deadlineAt - Date.now());
  }

  get timedOut(): boolean {
    return this.signal.aborted && !this.#caller.aborted;
  }

  dispose(): void {
    this.#cleanup();
  }
}

export function runGit(
  args: string[],
  options: {
    cwd: string;
    deadline: Deadline;
    env?: NodeJS.ProcessEnv;
    input?: string;
    maxBuffer?: number;
    /** Saída acima de `maxBuffer` devolve o que coube em vez de falhar. */
    truncateOverflow?: boolean;
    /** Códigos de saída que não são erro: a saída é devolvida (ex.: `merge-tree` devolve 1 com conflito). */
    okExitCodes?: readonly number[];
  },
): Promise<string> {
  const { deadline } = options;
  return new Promise((resolve, reject) => {
    if (deadline.signal.aborted) {
      reject(new GitFailure(deadline.timedOut ? "timeout" : "aborted", "git cancelado"));
      return;
    }
    const child = execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        env: gitEnvironment(options.env),
        signal: deadline.signal,
        timeout: deadline.remaining(),
        killSignal: "SIGKILL",
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if (
          options.truncateOverflow &&
          (error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ) {
          resolve(stdout);
          return;
        }
        if (deadline.signal.aborted) {
          reject(new GitFailure(deadline.timedOut ? "timeout" : "aborted", error.message));
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === "number" && options.okExitCodes?.includes(code)) {
          resolve(stdout);
          return;
        }
        if (typeof code === "string") {
          reject(new GitFailure(code === "ETIMEDOUT" ? "timeout" : "spawn", error.message));
          return;
        }
        if ((error as { killed?: boolean }).killed) {
          reject(new GitFailure("timeout", error.message));
          return;
        }
        reject(new GitFailure("exit", error.message));
      },
    );
    if (options.input !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(options.input);
    }
  });
}

export function unavailableFrom(error: unknown): "timeout" | "failed" {
  return error instanceof GitFailure && error.kind === "timeout" ? "timeout" : "failed";
}

async function samePath(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    realpath(left).catch(() => path.resolve(left)),
    realpath(right).catch(() => path.resolve(right)),
  ]);
  return a === b;
}

/** Descobre a raiz do repositório de `cwd`. A pasta pessoal nunca vale, mesmo sendo um repositório. */
export async function resolveRepository(
  cwd: string,
  homeDir: string = os.homedir(),
  signal: AbortSignal = new AbortController().signal,
  timeoutMs: number = DEFAULT_RESTORE_TIMEOUT_MS,
): Promise<RepositoryResolution> {
  const deadline = new Deadline(signal, timeoutMs);
  try {
    const output = await runGit(["rev-parse", "--show-toplevel"], { cwd, deadline });
    const root = output.replace(/\r?\n$/, "");
    if (!root) return { unavailable: "no-git" };
    if (await samePath(root, homeDir)) return { unavailable: "home" };
    return { root };
  } catch (error) {
    if (error instanceof GitFailure && (error.kind === "exit" || error.kind === "spawn")) {
      return { unavailable: "no-git" };
    }
    return { unavailable: unavailableFrom(error) };
  } finally {
    deadline.dispose();
  }
}

/**
 * Fotografa os arquivos do repositório (inclusive os novos) num commit solto, usando um index
 * temporário. Não toca em HEAD, branch, stash nem no index real.
 */
export async function createSnapshot(
  root: string,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_RESTORE_TIMEOUT_MS,
  options: { parent?: string } = {},
): Promise<SnapshotResult> {
  const deadline = new Deadline(signal, timeoutMs);
  let tempDir: string | undefined;
  try {
    const indexOutput = await runGit(["rev-parse", "--git-path", "index"], {
      cwd: root,
      deadline,
    });
    const realIndex = path.resolve(root, indexOutput.replace(/\r?\n$/, ""));
    tempDir = await mkdtemp(path.join(os.tmpdir(), "karont-index-"));
    const tempIndex = path.join(tempDir, "index");
    try {
      await copyFile(realIndex, tempIndex);
      // O Git usa o horário do index para desconfiar de edições no mesmo instante ("racy git").
      // Com o horário da cópia, ele deixaria passar uma edição de mesmo tamanho e a foto sairia errada.
      const original = await stat(realIndex);
      await utimes(tempIndex, original.atime, original.mtime);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (deadline.signal.aborted) throw new GitFailure("aborted", "cancelado");
    const env = { GIT_INDEX_FILE: tempIndex };
    await runGit(["add", "-A"], { cwd: root, deadline, env });
    const tree = (await runGit(["write-tree"], { cwd: root, deadline, env })).trim();
    const commit = (
      await runGit(
        [
          "commit-tree",
          tree,
          ...(options.parent && /^[0-9a-f]{40,64}$/.test(options.parent)
            ? ["-p", options.parent]
            : []),
          "-m",
          SNAPSHOT_MESSAGE,
        ],
        {
          cwd: root,
          deadline,
          env: {
            GIT_AUTHOR_NAME: "Karont",
            GIT_AUTHOR_EMAIL: "karont@localhost",
            GIT_COMMITTER_NAME: "Karont",
            GIT_COMMITTER_EMAIL: "karont@localhost",
          },
        },
      )
    ).trim();
    let head: string | null = null;
    try {
      head = (
        await runGit(["rev-parse", "-q", "--verify", "HEAD"], { cwd: root, deadline })
      ).trim();
      if (!head) head = null;
    } catch (error) {
      if (!(error instanceof GitFailure) || error.kind !== "exit") throw error;
    }
    if (!commit) return { unavailable: "failed" };
    return { commit, head };
  } catch (error) {
    return { unavailable: unavailableFrom(error) };
  } finally {
    deadline.dispose();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function writeRestoreRef(
  root: string,
  ref: string,
  commit: string,
  signal: AbortSignal,
  timeoutMs: number = DEFAULT_RESTORE_TIMEOUT_MS,
): Promise<{ ok: true } | { unavailable: "timeout" | "failed" }> {
  if (!REF_PATTERN.test(ref) || !/^[0-9a-f]{40,64}$/.test(commit)) return { unavailable: "failed" };
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await runGit(["update-ref", ref, commit], { cwd: root, deadline });
    return { ok: true };
  } catch (error) {
    return { unavailable: unavailableFrom(error) };
  } finally {
    deadline.dispose();
  }
}

/** Apaga várias refs numa chamada só. Melhor esforço: nada propaga. */
export async function deleteRestoreRefs(
  root: string,
  refs: readonly string[],
  signal: AbortSignal = new AbortController().signal,
  timeoutMs: number = DEFAULT_RESTORE_TIMEOUT_MS,
): Promise<boolean> {
  const valid = refs.filter((ref) => REF_PATTERN.test(ref));
  if (valid.length === 0) return true;
  const deadline = new Deadline(signal, timeoutMs);
  try {
    await runGit(["update-ref", "--stdin"], {
      cwd: root,
      deadline,
      input: valid.map((ref) => `delete ${ref}\n`).join(""),
    });
    return true;
  } catch {
    return false;
  } finally {
    deadline.dispose();
  }
}

/** Foto completa de um turno: descobre o repositório (só no "antes"), fotografa e grava a ref. */
export async function takeRestorePoint(
  request: RestoreSnapshotRequest,
): Promise<RestoreSnapshotOutcome> {
  const deadline = new Deadline(request.signal, request.timeoutMs);
  const fail = (
    repoRoot: string | null,
    reason: RestoreUnavailableReason,
  ): RestoreSnapshotOutcome => ({
    repoRoot,
    unavailable:
      reason === "no-git" || reason === "home" ? reason : deadline.timedOut ? "timeout" : "failed",
  });
  try {
    let root = request.repoRoot;
    if (!root) {
      const resolved = await resolveRepository(
        request.cwd,
        request.homeDir,
        deadline.signal,
        deadline.remaining(),
      );
      if ("unavailable" in resolved) return fail(null, resolved.unavailable);
      root = resolved.root;
    }
    const snapshot = await createSnapshot(root, deadline.signal, deadline.remaining());
    if ("unavailable" in snapshot) return fail(root, snapshot.unavailable);
    const written = await writeRestoreRef(
      root,
      restoreRef(request.conversationId, request.messageId, request.phase),
      snapshot.commit,
      deadline.signal,
      deadline.remaining(),
    );
    if ("unavailable" in written) return fail(root, written.unavailable);
    return { repoRoot: root, commit: snapshot.commit, head: snapshot.head };
  } finally {
    deadline.dispose();
  }
}

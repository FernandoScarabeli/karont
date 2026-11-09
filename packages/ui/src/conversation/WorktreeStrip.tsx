import {
  BridgeError,
  type Worktree,
  type WorktreeMergePreview,
  type WorktreeStatus,
} from "@karont/contract";
import { GitFork, TriangleAlert } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { t } from "../i18n/pt-BR.ts";
import { removeWorktreeFromStore, useWorktrees } from "../projects/useWorktrees.ts";
import styles from "./WorktreeStrip.module.css";

function errorText(error: unknown, fallback: string): string {
  return error instanceof BridgeError && error.message ? error.message : fallback;
}

/**
 * Faixa abaixo do composer de uma conversa que trabalha numa cópia separada: mostra a
 * branch e oferece trazer o trabalho de volta ou remover a cópia. Não aparece se a cópia
 * não está mais na lista do projeto.
 */
export function WorktreeStrip({
  projectId,
  worktreeId,
  busy,
}: {
  projectId: string | undefined;
  worktreeId: string | undefined;
  /** Conversa ocupada (fila, trabalhando ou esperando): não dá para trazer nem remover. */
  busy: boolean;
}) {
  const { worktrees } = useWorktrees(projectId);
  const worktree = worktreeId ? worktrees.find((item) => item.id === worktreeId) : undefined;
  const [notice, setNotice] = useState("");
  const lastWorktreeId = useRef(worktreeId);

  useEffect(() => {
    if (lastWorktreeId.current === worktreeId) return;
    lastWorktreeId.current = worktreeId;
    setNotice("");
  }, [worktreeId]);

  if (!worktree || !projectId) return null;
  return (
    <WorktreeStripContent
      busy={busy}
      notice={notice}
      onMerged={(target) => setNotice(t.worktrees.merged(target))}
      projectId={projectId}
      worktree={worktree}
    />
  );
}

function WorktreeStripContent({
  worktree,
  projectId,
  busy,
  notice,
  onMerged,
}: {
  worktree: Worktree;
  projectId: string;
  busy: boolean;
  notice: string;
  onMerged: (target: string) => void;
}) {
  const bringButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const [checking, setChecking] = useState<"merge" | "remove" | null>(null);
  const [checkError, setCheckError] = useState("");
  const [preview, setPreview] = useState<WorktreeMergePreview | null>(null);
  const [status, setStatus] = useState<WorktreeStatus | null>(null);

  const openMerge = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || checking) return;
    setChecking("merge");
    setCheckError("");
    try {
      setPreview(await bridge.request("worktrees.mergePreview", { id: worktree.id }));
    } catch (error) {
      setCheckError(errorText(error, t.worktrees.mergePreviewFailed));
    } finally {
      setChecking(null);
    }
  }, [checking, worktree.id]);

  const openRemove = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge || checking) return;
    setChecking("remove");
    setCheckError("");
    try {
      setStatus(await bridge.request("worktrees.status", { id: worktree.id }));
    } catch (error) {
      setCheckError(errorText(error, t.worktrees.statusFailed));
    } finally {
      setChecking(null);
    }
  }, [checking, worktree.id]);

  return (
    <div className={styles.stripWrap}>
      <div className={styles.strip}>
        <span className={styles.label} title={worktree.branch}>
          <GitFork aria-hidden="true" size={14} />
          <span>{t.worktrees.stripBranch(worktree.branch)}</span>
        </span>
        <span className={styles.actions}>
          <button
            aria-busy={checking === "merge" || undefined}
            className={styles.action}
            disabled={busy || checking !== null}
            onClick={() => void openMerge()}
            ref={bringButtonRef}
            type="button"
          >
            {checking === "merge" ? t.worktrees.checking : t.worktrees.bringBack}
          </button>
          <button
            aria-busy={checking === "remove" || undefined}
            className={styles.action}
            disabled={busy || checking !== null}
            onClick={() => void openRemove()}
            ref={removeButtonRef}
            type="button"
          >
            {checking === "remove" ? t.worktrees.checking : t.worktrees.removeCopy}
          </button>
        </span>
      </div>
      <p className={styles.notice} role="status">
        {notice}
      </p>
      {checkError ? (
        <p className={styles.error} role="alert">
          <TriangleAlert aria-hidden="true" size={14} />
          {checkError}
        </p>
      ) : null}
      <MergeDialog
        onClose={() => setPreview(null)}
        onMerged={(target) => {
          setPreview(null);
          onMerged(target);
        }}
        preview={preview}
        returnFocusRef={bringButtonRef}
        worktreeId={worktree.id}
      />
      <RemoveDialog
        onClose={() => setStatus(null)}
        projectId={projectId}
        returnFocusRef={removeButtonRef}
        status={status}
        worktreeId={worktree.id}
      />
    </div>
  );
}

function PathList({ label, paths }: { label: string; paths: string[] }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: lista com rolagem acessível por teclado.
    <ul aria-label={label} className={styles.pathList} tabIndex={0}>
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function DialogError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className={styles.dialogError} role="alert">
      <TriangleAlert aria-hidden="true" size={14} />
      {message}
    </p>
  );
}

function blockedText(preview: WorktreeMergePreview): string | null {
  const target = preview.targetBranch ?? t.worktrees.targetFallback;
  switch (preview.blocked) {
    case null:
      return null;
    case "target-merging":
      return t.worktrees.blocked["target-merging"](target);
    case "target-dirty":
      return t.worktrees.blocked["target-dirty"](target);
    default:
      return t.worktrees.blocked[preview.blocked];
  }
}

function MergeDialog({
  preview,
  worktreeId,
  returnFocusRef,
  onClose,
  onMerged,
}: {
  preview: WorktreeMergePreview | null;
  worktreeId: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onMerged: (target: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");
  // O diálogo fica montado: o foco volta ao botão que abriu quando ele fecha.
  useEffect(() => {
    if (preview) {
      setMerging(false);
      setError("");
    }
  }, [preview]);
  const target = preview?.targetBranch ?? t.worktrees.targetFallback;
  const blocked = preview ? blockedText(preview) : null;
  const hasConflicts = preview !== null && preview.blocked === null && preview.conflicts.length > 0;
  const canConfirm = preview !== null && preview.blocked === null && !hasConflicts;

  const close = () => {
    if (!merging) onClose();
  };

  async function confirm() {
    const bridge = getBridge();
    if (!bridge || merging) return;
    setMerging(true);
    setError("");
    try {
      const result = await bridge.request("worktrees.merge", { id: worktreeId });
      onMerged(result.targetBranch);
    } catch (mergeError) {
      setError(errorText(mergeError, t.worktrees.mergeFailed));
      setMerging(false);
    }
  }

  return (
    <Dialog
      footer={
        canConfirm ? (
          <>
            <Button disabled={merging} onClick={close} ref={closeRef} variant="secondary">
              {t.worktrees.cancel}
            </Button>
            <Button disabled={merging} onClick={() => void confirm()} variant="primary">
              {merging ? t.worktrees.bringing : t.worktrees.bring}
            </Button>
          </>
        ) : (
          <Button onClick={close} ref={closeRef} variant="secondary">
            {t.worktrees.close}
          </Button>
        )
      }
      initialFocusRef={closeRef}
      onClose={close}
      open={preview !== null}
      returnFocusRef={returnFocusRef}
      title={t.worktrees.mergeTitle(preview?.targetBranch ?? null)}
    >
      <div className={styles.dialogBody}>
        {blocked ? <p className={styles.text}>{blocked}</p> : null}
        {preview?.blocked === "target-dirty" && preview.targetDirtyFiles.length > 0 ? (
          <PathList label={t.worktrees.targetDirtyList} paths={preview.targetDirtyFiles} />
        ) : null}
        {preview && hasConflicts ? (
          <>
            <p className={styles.text}>{t.worktrees.conflictsText(target)}</p>
            <PathList label={t.worktrees.conflictsList} paths={preview.conflicts} />
          </>
        ) : null}
        {preview && canConfirm ? (
          <>
            <p className={styles.text}>{t.worktrees.filesArrive(preview.changedFiles, target)}</p>
            {preview.uncommittedFiles > 0 ? (
              <p className={styles.text}>
                {t.worktrees.uncommittedBecomeCommit(preview.uncommittedFiles)}
              </p>
            ) : null}
          </>
        ) : null}
        <DialogError message={error} />
      </div>
    </Dialog>
  );
}

function RemoveDialog({
  status,
  worktreeId,
  projectId,
  returnFocusRef,
  onClose,
}: {
  status: WorktreeStatus | null;
  worktreeId: string;
  projectId: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (status) {
      setRemoving(false);
      setError("");
    }
  }, [status]);
  const dirtyFiles = status?.dirtyFiles ?? 0;
  const unmergedCommits = status?.unmergedCommits ?? 0;
  const busyConversations = status?.busyConversations ?? 0;
  const hasWarning = dirtyFiles > 0 || unmergedCommits > 0;
  const blockedByBusy = busyConversations > 0;

  const close = () => {
    if (!removing) onClose();
  };

  async function confirm() {
    const bridge = getBridge();
    if (!bridge || removing) return;
    setRemoving(true);
    setError("");
    try {
      await bridge.request("worktrees.remove", {
        id: worktreeId,
        ...(hasWarning ? { force: true } : {}),
      });
      onClose();
      removeWorktreeFromStore(projectId, worktreeId);
    } catch (removeError) {
      setError(errorText(removeError, t.worktrees.removeFailed));
      setRemoving(false);
    }
  }

  return (
    <Dialog
      description={t.worktrees.removeDescription}
      footer={
        <>
          <Button disabled={removing} onClick={close} ref={cancelRef} variant="secondary">
            {blockedByBusy ? t.worktrees.close : t.worktrees.cancel}
          </Button>
          {blockedByBusy ? null : (
            <Button disabled={removing} onClick={() => void confirm()} variant="danger">
              {removing ? t.worktrees.removing : t.worktrees.removeCopy}
            </Button>
          )}
        </>
      }
      initialFocusRef={cancelRef}
      onClose={close}
      open={status !== null}
      returnFocusRef={returnFocusRef}
      title={t.worktrees.removeTitle}
    >
      <div className={styles.dialogBody}>
        {blockedByBusy ? (
          <p className={styles.text}>{t.worktrees.removeBusy(busyConversations)}</p>
        ) : null}
        {dirtyFiles > 0 ? (
          <p className={styles.text}>{t.worktrees.removeDirty(dirtyFiles)}</p>
        ) : null}
        {unmergedCommits > 0 ? (
          <p className={styles.text}>{t.worktrees.removeUnmerged(unmergedCommits)}</p>
        ) : null}
        <DialogError message={error} />
      </div>
    </Dialog>
  );
}

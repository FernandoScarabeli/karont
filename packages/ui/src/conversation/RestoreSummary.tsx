import { BridgeError, type ResultOf } from "@karont/contract";
import { TriangleAlert } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./RestoreSummary.module.css";
import { openRestorePanel, useRestoreBusy } from "./restorePanelStore.ts";
import { restoreSummaryModel } from "./restorePoints.ts";
import { useRestorePoint } from "./useRestorePoints.ts";

type UndoPreview = ResultOf<"restore.undoPreview">;

function errorText(error: unknown, fallback: string): string {
  return error instanceof BridgeError && error.message ? error.message : fallback;
}

/**
 * Linha discreta abaixo da resposta do agente: quantos arquivos mudaram, ver mudanças e
 * desfazer. Só esta linha re-renderiza quando o ponto de restauração da mensagem muda.
 */
export const RestoreSummary = memo(function RestoreSummary({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const view = useRestorePoint(conversationId, messageId);
  const busy = useRestoreBusy(conversationId);
  const model = restoreSummaryModel(view);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");

  const startUndo = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setPreviewing(true);
    setPreviewError("");
    try {
      const result = await bridge.request("restore.undoPreview", { conversationId, messageId });
      setUndoError("");
      setPreview(result);
    } catch (error) {
      setPreviewError(errorText(error, t.restore.undoPreviewFailed));
    } finally {
      setPreviewing(false);
    }
  }, [conversationId, messageId]);

  const closeDialog = useCallback(() => {
    if (undoing) return;
    setPreview(null);
    setUndoError("");
  }, [undoing]);

  const confirmUndo = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setUndoing(true);
    setUndoError("");
    try {
      await bridge.request("restore.undo", { conversationId, messageId });
      setPreview(null);
    } catch (error) {
      setUndoError(errorText(error, t.restore.undoFailed));
    } finally {
      setUndoing(false);
    }
  }, [conversationId, messageId]);

  return (
    <>
      {model?.kind === "message" ? <p className={styles.note}>{model.text}</p> : null}
      {model?.kind === "changes" || model?.kind === "undone" ? (
        <div className={styles.line}>
          <span className={styles.text}>{model.text}</span>
          <span aria-hidden="true" className={styles.separator}>
            ·
          </span>
          <button
            className={styles.action}
            data-restore-changes-for={messageId}
            onClick={() => openRestorePanel(conversationId, messageId)}
            ref={viewButtonRef}
            type="button"
          >
            {t.restore.viewChanges}
          </button>
          {model.kind === "changes" ? (
            <>
              <span aria-hidden="true" className={styles.separator}>
                ·
              </span>
              <button
                aria-busy={previewing || undefined}
                className={styles.action}
                disabled={busy || previewing}
                onClick={() => void startUndo()}
                type="button"
              >
                {previewing ? t.restore.undoPreviewing : t.restore.undo}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {previewError ? (
        <p className={styles.error} role="alert">
          <TriangleAlert aria-hidden="true" size={14} />
          {previewError}
        </p>
      ) : null}
      {model?.kind === "changes" || preview ? (
        <Dialog
          // A mesma conta da linha acima: a prévia conta o renomeado como dois caminhos.
          description={t.restore.undoDescription(view.point?.changedFiles ?? preview?.files ?? 0)}
          footer={
            <>
              <Button disabled={undoing} onClick={closeDialog} ref={cancelRef}>
                {t.restore.cancel}
              </Button>
              <Button disabled={undoing} onClick={() => void confirmUndo()} variant="danger">
                {undoing ? t.restore.undoing : t.restore.confirmUndo}
              </Button>
            </>
          }
          initialFocusRef={cancelRef}
          onClose={closeDialog}
          open={preview !== null}
          returnFocusRef={viewButtonRef}
          title={t.restore.undoTitle}
        >
          {preview ? <UndoWarnings preview={preview} /> : null}
          {undoError ? (
            <p className={styles.dialogError} role="alert">
              <TriangleAlert aria-hidden="true" size={14} />
              {undoError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
});

function UndoWarnings({ preview }: { preview: UndoPreview }) {
  return (
    <div className={styles.warnings}>
      {preview.userChanged.length > 0 ? (
        <>
          <p className={styles.warning}>{t.restore.userChanged}</p>
          <PathList label={t.restore.userChangedList} paths={preview.userChanged} />
          <p className={styles.warning}>{t.restore.userChangedKept}</p>
        </>
      ) : null}
      {preview.headMoved ? <p className={styles.warning}>{t.restore.headMoved}</p> : null}
      {preview.concurrent ? <p className={styles.warning}>{t.restore.concurrentUndo}</p> : null}
      {preview.submodulesSkipped.length > 0 ? (
        <>
          <p className={styles.warning}>{t.restore.submodulesSkipped}</p>
          <PathList label={t.restore.submodulesList} paths={preview.submodulesSkipped} />
        </>
      ) : null}
      <p className={styles.warning}>{t.restore.ignoredNotRestored}</p>
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

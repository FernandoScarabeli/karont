import type { RestoreFileChange, ResultOf } from "@karont/contract";
import { X } from "lucide-react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import { t } from "../i18n/pt-BR.ts";
import { DiffFilePanel } from "./ConversationParts.tsx";
import styles from "./RestoreChangesPanel.module.css";
import { useRestorePoint } from "./useRestorePoints.ts";

type Changes = ResultOf<"restore.changes">;
type ChangesState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; changes: Changes };
type DiffState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; patch: string; binary: boolean; truncated: boolean };

/** Limite de arquivos que o serviço devolve; o aviso de corte cita este número. */
const FILES_LIMIT = 2_000;

/**
 * Painel lateral "Mudanças desta resposta". Abre sobre a região de mensagens, como o
 * histórico: Esc fecha e o foco volta ao botão "Ver mudanças" que abriu.
 */
export const RestoreChangesPanel = memo(function RestoreChangesPanel({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string;
  messageId: string;
  onClose: () => void;
}) {
  const view = useRestorePoint(conversationId, messageId);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<ChangesState>({ phase: "loading" });
  // Diffs já carregados ficam aqui enquanto o painel estiver aberto.
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const mountedRef = useRef(true);
  const requestedDiffs = useRef(new Set<string>());
  const titleId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setState({ phase: "error" });
      return;
    }
    let active = true;
    bridge
      .request("restore.changes", { conversationId, messageId })
      .then((changes) => {
        if (active) setState({ phase: "ready", changes });
      })
      .catch(() => {
        if (active) setState({ phase: "error" });
      });
    return () => {
      active = false;
    };
  }, [conversationId, messageId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Com o diálogo de confirmação aberto, o Esc é dele.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const loadDiff = useCallback(
    (path: string) => {
      const bridge = getBridge();
      if (!bridge) return;
      requestedDiffs.current.add(path);
      setDiffs((current) => ({ ...current, [path]: { phase: "loading" } }));
      bridge
        .request("restore.diff", { conversationId, messageId, path })
        .then((result) => {
          if (!mountedRef.current) return;
          setDiffs((current) => ({ ...current, [path]: { phase: "ready", ...result } }));
        })
        .catch(() => {
          if (!mountedRef.current) return;
          // Permite tentar de novo ao reabrir o arquivo.
          requestedDiffs.current.delete(path);
          setDiffs((current) => ({ ...current, [path]: { phase: "error" } }));
        });
    },
    [conversationId, messageId],
  );

  const toggleFile = useCallback(
    (file: RestoreFileChange) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return next;
      });
      if (!file.binary && !requestedDiffs.current.has(file.path)) loadDiff(file.path);
    },
    [loadDiff],
  );

  const changes = state.phase === "ready" ? state.changes : null;

  return (
    <aside aria-labelledby={titleId} className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>
          {t.restore.panelTitle}
        </h2>
        <IconButton
          icon={<X aria-hidden="true" size={16} />}
          label={t.restore.closePanel}
          onClick={onClose}
          size="sm"
        />
      </header>
      <div className={`${styles.body} ${scrollAreaStyles.scrollArea}`}>
        <div className={styles.notices}>
          {view.point?.concurrent ? (
            <p className={styles.warning}>{t.restore.concurrentChanges}</p>
          ) : null}
          {changes?.truncated ? (
            <p className={styles.warning}>{t.restore.truncatedFiles(FILES_LIMIT)}</p>
          ) : null}
          <p className={styles.hint}>{t.restore.ignoredFiles}</p>
        </div>
        {state.phase === "loading" ? (
          <p className={styles.status} role="status">
            {t.restore.loadingChanges}
          </p>
        ) : null}
        {state.phase === "error" ? (
          <p className={styles.error} role="alert">
            {t.restore.changesFailed}
          </p>
        ) : null}
        {changes && changes.files.length === 0 ? (
          <p className={styles.status}>{t.restore.noChanges}</p>
        ) : null}
        {changes && changes.files.length > 0 ? (
          <ul aria-label={t.restore.filesListLabel} className={styles.files}>
            {changes.files.map((file) => (
              <FileRow
                diff={diffs[file.path]}
                expanded={expanded.has(file.path)}
                file={file}
                key={file.path}
                onToggle={toggleFile}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
});

const FileRow = memo(function FileRow({
  file,
  expanded,
  diff,
  onToggle,
}: {
  file: RestoreFileChange;
  expanded: boolean;
  diff: DiffState | undefined;
  onToggle: (file: RestoreFileChange) => void;
}) {
  const diffId = useId();
  const pathLabel = file.oldPath ? t.restore.renamed(file.oldPath, file.path) : file.path;
  return (
    <li className={styles.file}>
      <button
        aria-controls={expanded ? diffId : undefined}
        aria-expanded={expanded}
        className={styles.fileButton}
        onClick={() => onToggle(file)}
        type="button"
      >
        <span className={styles.filePath} title={pathLabel}>
          {pathLabel}
        </span>
        <span className={styles.fileMeta}>
          <span className={styles.fileStatus}>{t.restore.fileStatus[file.status]}</span>
          {file.binary ? (
            <span className={styles.fileStatus}>{t.restore.binary}</span>
          ) : file.additions !== null && file.deletions !== null ? (
            <span className={styles.fileStats}>
              {file.additions > 0 ? (
                <span className={styles.statsAdded}>+{file.additions}</span>
              ) : null}
              {file.deletions > 0 ? (
                <span className={styles.statsRemoved}>−{file.deletions}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className={styles.diff} id={diffId}>
          {file.binary ? <p className={styles.hint}>{t.restore.diffBinary}</p> : null}
          {!file.binary && (diff === undefined || diff.phase === "loading") ? (
            <p className={styles.status} role="status">
              {t.restore.loadingDiff}
            </p>
          ) : null}
          {diff?.phase === "error" ? (
            <p className={styles.error} role="alert">
              {t.restore.diffFailed}
            </p>
          ) : null}
          {diff?.phase === "ready" ? <DiffBody diff={diff} path={file.path} /> : null}
        </div>
      ) : null}
    </li>
  );
});

function DiffBody({ diff, path }: { diff: Extract<DiffState, { phase: "ready" }>; path: string }) {
  if (diff.binary) return <p className={styles.hint}>{t.restore.diffBinary}</p>;
  return (
    <>
      {diff.patch.trim() ? (
        <DiffFilePanel change={{ path, diff: diff.patch }} open showHeader={false} />
      ) : (
        <p className={styles.hint}>{t.restore.diffEmpty}</p>
      )}
      {diff.truncated ? <p className={styles.warning}>{t.restore.diffTruncated}</p> : null}
    </>
  );
}

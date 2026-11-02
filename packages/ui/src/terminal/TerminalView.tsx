import { BridgeError, type TerminalInfo } from "@karont/contract";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Square, SquareTerminal, TriangleAlert } from "lucide-react";
import {
  type DragEventHandler,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { t } from "../i18n/pt-BR.ts";
import { connectXtermCspStyles, createXtermCspDocument } from "./cspStyles.ts";
import { createResizeQueueState, flushResize, queueResize } from "./resizeQueue.ts";
import {
  completeTerminalAttach,
  consumePendingReconnect,
  createTerminalSyncState,
  decideTerminalEvent,
  failTerminalAttach,
} from "./terminalSync.ts";
import "@xterm/xterm/css/xterm.css";
import styles from "./TerminalView.module.css";

const MAX_WRITE_BYTES = 65_536;

export function TerminalView({
  id,
  titleRef,
  dragHandleProps,
  headerActions,
}: {
  id: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  headerActions?: ReactNode;
  dragHandleProps?: {
    draggable: boolean;
    onDragEnd: DragEventHandler<HTMLHeadingElement>;
    onDragStart: DragEventHandler<HTMLHeadingElement>;
    tabIndex: number;
  };
}) {
  const bridge = getBridge();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);
  const [terminalError, setTerminalError] = useState("");
  const titleId = useId();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminalHost: HTMLDivElement = host;
    if (!bridge) {
      setTerminalError(t.conversation.noBridge);
      return;
    }
    const serviceBridge = bridge;

    let mounted = true;
    let replayReady = false;
    let terminalHasExited = false;
    let syncState = createTerminalSyncState();
    let exitBeforeAttach: { exitCode: number | null } | null = null;
    let animationFrame: number | undefined;
    let resizeTimeout: number | undefined;
    let resizeQueueState = createResizeQueueState();
    let inputQueue: string[] = [];
    let outputQueue: Array<{ seq: number; data: string }> = [];
    let writeQueue = Promise.resolve();
    let inputActive = true;
    const disconnectCspStyles = connectXtermCspStyles(terminalHost);

    const computed = getComputedStyle(document.documentElement);
    const token = (name: string) => computed.getPropertyValue(name).trim();
    const terminal = new Terminal({
      allowProposedApi: false,
      documentOverride: createXtermCspDocument(terminalHost),
      fontFamily: token("--k-font-mono"),
      fontSize: Number.parseFloat(token("--k-text-13")) || 13,
      theme: {
        background: token("--k-color-bg-sheet"),
        foreground: token("--k-color-text-primary"),
        cursor: token("--k-color-primary"),
        selectionBackground: token("--k-color-terminal-selection"),
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;

    function applyOutput(event: { seq: number; data: string }): boolean {
      const result = decideTerminalEvent(syncState, { type: "output", id, seq: event.seq }, id);
      syncState = result.state;
      if (result.decision === "apply") {
        terminal.write(event.data);
        return true;
      }
      if (result.decision === "reattach") {
        requestAttach(true);
        return false;
      }
      return true;
    }

    function drainOutput() {
      if (!replayReady) return;
      const pending = outputQueue;
      outputQueue = [];
      for (const event of pending) {
        if (!applyOutput(event)) break;
      }
    }

    function requestAttach(isReattach: boolean) {
      if (isReattach) {
        terminal.reset();
        replayReady = false;
        outputQueue = [];
      }

      void serviceBridge.request("terminals.attach", { id }).then(
        ({ terminal: attachedTerminal, replay, seq }) => {
          if (!mounted) return;
          setTerminalInfo(
            exitBeforeAttach
              ? { ...attachedTerminal, exited: true, exitCode: exitBeforeAttach.exitCode }
              : attachedTerminal,
          );
          inputActive = !attachedTerminal.exited && !exitBeforeAttach;
          terminalHasExited = !inputActive;
          terminal.write(replay, () => {
            if (!mounted) return;
            syncState = completeTerminalAttach(syncState, seq);
            const pendingReconnect = consumePendingReconnect(syncState);
            syncState = pendingReconnect.state;
            if (pendingReconnect.decision === "reattach") {
              requestAttach(true);
              return;
            }
            replayReady = true;
            drainOutput();
            requestResize();
            terminal.focus();
          });
        },
        (error: unknown) => {
          if (!mounted) return;
          syncState = failTerminalAttach(syncState);
          const pendingReconnect = consumePendingReconnect(syncState);
          syncState = pendingReconnect.state;
          if (pendingReconnect.decision === "reattach") {
            requestAttach(true);
            return;
          }
          setTerminalError(
            error instanceof BridgeError && error.message ? error.message : t.terminal.attachFailed,
          );
        },
      );
    }

    function writeInputChunks(data: string) {
      const chunks: string[] = [];
      let chunk = "";
      let chunkBytes = 0;
      const encoder = new TextEncoder();
      for (const character of data) {
        const size = encoder.encode(character).byteLength;
        if (chunkBytes + size > MAX_WRITE_BYTES && chunk) {
          chunks.push(chunk);
          chunk = "";
          chunkBytes = 0;
        }
        chunk += character;
        chunkBytes += size;
      }
      if (chunk) chunks.push(chunk);

      for (const chunkData of chunks) {
        writeQueue = writeQueue
          .then(() => serviceBridge.request("terminals.write", { id, data: chunkData }))
          .then(() => undefined)
          .catch((error: unknown) => {
            if (!mounted) return;
            setTerminalError(
              error instanceof BridgeError && error.message
                ? error.message
                : t.terminal.writeFailed,
            );
          });
      }
    }

    const inputSubscription = terminal.onData((data) => {
      if (!inputActive) return;
      inputQueue.push(data);
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined;
        const queuedInput = inputQueue.join("");
        inputQueue = [];
        if (queuedInput) writeInputChunks(queuedInput);
      });
    });

    function requestResize() {
      if (
        !mounted ||
        terminalHasExited ||
        terminalHost.clientWidth === 0 ||
        terminalHost.clientHeight === 0
      ) {
        return;
      }
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const size = { cols: terminal.cols, rows: terminal.rows };
      if (size.cols < 2 || size.rows < 2) return;
      const update = queueResize(resizeQueueState, size, Date.now());
      resizeQueueState = update.state;
      if (update.cancelTimer && resizeTimeout !== undefined) {
        window.clearTimeout(resizeTimeout);
      }
      resizeTimeout = undefined;
      if (update.scheduleAfter === null) return;
      resizeTimeout = window.setTimeout(() => {
        resizeTimeout = undefined;
        const flushed = flushResize(resizeQueueState, Date.now());
        resizeQueueState = flushed.state;
        if (!flushed.size || !mounted) return;
        void serviceBridge.request("terminals.resize", { id, ...flushed.size }).catch(() => {
          if (mounted) setTerminalError(t.terminal.resizeFailed);
        });
      }, update.scheduleAfter);
    }

    const resizeObserver = new ResizeObserver(requestResize);
    resizeObserver.observe(terminalHost);

    const unsubscribe = serviceBridge.onEvent((event) => {
      if (event.event === "terminals.output" && event.payload.id === id) {
        if (syncState.attached && syncState.attaching) return;
        if (!syncState.attached || !replayReady) {
          outputQueue.push(event.payload);
        } else {
          applyOutput(event.payload);
        }
      } else if (event.event === "terminals.resync" && event.payload.id === id) {
        const result = decideTerminalEvent(syncState, { type: "resync", id: event.payload.id }, id);
        syncState = result.state;
        if (result.decision === "reattach") requestAttach(true);
      } else if (event.event === "bridge.status") {
        const result = decideTerminalEvent(
          syncState,
          { type: "bridge.status", state: event.payload.state },
          id,
        );
        syncState = result.state;
        if (result.decision === "reattach") requestAttach(true);
      } else if (event.event === "terminals.exit" && event.payload.id === id) {
        exitBeforeAttach = { exitCode: event.payload.exitCode };
        terminalHasExited = true;
        inputActive = false;
        setTerminalInfo((current) =>
          current ? { ...current, exited: true, exitCode: event.payload.exitCode } : current,
        );
      }
    });

    requestAttach(false);

    return () => {
      mounted = false;
      inputActive = false;
      unsubscribe();
      inputSubscription.dispose();
      resizeObserver.disconnect();
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (resizeTimeout !== undefined) window.clearTimeout(resizeTimeout);
      terminal.dispose();
      disconnectCspStyles();
      terminalRef.current = null;
    };
  }, [bridge, id]);

  const title = terminalInfo
    ? terminalInfo.title
    : terminalError
      ? t.terminal.unknownTitle
      : t.terminal.loadingTitle;
  const exited = terminalInfo?.exited ?? false;
  const exitedLabel = exited ? t.terminal.exited(terminalInfo?.exitCode ?? null) : "";
  const shellName = terminalInfo
    ? (terminalInfo.shell.split(/[\\/]/).filter(Boolean).at(-1) ?? terminalInfo.shell)
    : "";
  const separatorIndex = terminalInfo?.title.indexOf(" · ") ?? -1;
  const folderTitle =
    terminalInfo && separatorIndex >= 0
      ? terminalInfo.title.slice(separatorIndex + 3)
      : (terminalInfo?.cwd ?? "");

  return (
    <div className={`${styles.page} k-terminal-pane`}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <SquareTerminal
            aria-hidden="true"
            className={styles.headerIcon}
            size={18}
            strokeWidth={1.8}
          />
          <h1
            className={styles.title}
            data-pane-title=""
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            {...dragHandleProps}
          >
            {terminalInfo ? (
              <>
                <span className={styles.visuallyHidden}>{t.terminal.namePrefix}</span>
                <span className={styles.shellName}>{shellName}</span>
                <span aria-hidden="true" className={styles.titleSeparator}>
                  ·
                </span>
                <span className={styles.folderTitle} data-k-terminal-folder="">
                  {folderTitle}
                </span>
              </>
            ) : null}
            {!terminalInfo ? title : null}
          </h1>
          {exited ? (
            <p className={`${styles.state} ${styles.exited}`} title={exitedLabel}>
              <Square aria-hidden="true" size={14} strokeWidth={1.75} />
              <span>{exitedLabel}</span>
            </p>
          ) : null}
        </div>
        {headerActions ? <div className={styles.actions}>{headerActions}</div> : null}
      </header>

      {terminalError ? (
        <p className={styles.error} role="alert">
          <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{terminalError}</span>
        </p>
      ) : null}
      <section
        aria-labelledby={titleId}
        aria-label={t.terminal.inaccessibleName(title)}
        className={styles.terminalRegion}
      >
        <div className={styles.terminalHost} ref={hostRef} />
      </section>
    </div>
  );
}

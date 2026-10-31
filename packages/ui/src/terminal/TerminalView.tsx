import { BridgeError, type TerminalInfo } from "@karont/contract";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { CircleCheck, CircleDashed, CircleX, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { connectXtermCspStyles, createXtermCspDocument } from "./cspStyles.ts";
import "@xterm/xterm/css/xterm.css";
import styles from "./TerminalView.module.css";

const MAX_WRITE_BYTES = 65_536;

export function TerminalView({ id }: { id: string }) {
  const bridge = getBridge();
  const { navigate } = useNavigation();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const cancelCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);
  const [terminalError, setTerminalError] = useState("");
  const [closeError, setCloseError] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
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
    let attached = false;
    let replayReady = false;
    let terminalHasExited = false;
    let lastSeq = -1;
    let exitBeforeAttach: { exitCode: number | null } | null = null;
    let animationFrame: number | undefined;
    let resizeTimeout: number | undefined;
    let lastResizeAt = 0;
    let queuedSize: { cols: number; rows: number } | null = null;
    let lastSentSize: { cols: number; rows: number } | null = null;
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

    function applyOutput(event: { seq: number; data: string }) {
      if (event.seq <= lastSeq) return;
      lastSeq = event.seq;
      terminal.write(event.data);
    }

    function drainOutput() {
      if (!replayReady) return;
      const pending = outputQueue;
      outputQueue = [];
      for (const event of pending) applyOutput(event);
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
      if (lastSentSize?.cols === size.cols && lastSentSize.rows === size.rows) return;
      queuedSize = size;
      if (resizeTimeout !== undefined) window.clearTimeout(resizeTimeout);
      const wait = Math.max(0, 100 - (Date.now() - lastResizeAt));
      resizeTimeout = window.setTimeout(() => {
        resizeTimeout = undefined;
        const next = queuedSize;
        queuedSize = null;
        if (!next || !mounted) return;
        lastResizeAt = Date.now();
        lastSentSize = next;
        void serviceBridge.request("terminals.resize", { id, ...next }).catch(() => {
          if (mounted) setTerminalError(t.terminal.resizeFailed);
        });
      }, wait);
    }

    const resizeObserver = new ResizeObserver(requestResize);
    resizeObserver.observe(terminalHost);

    const unsubscribe = serviceBridge.onEvent((event) => {
      if (event.event === "terminals.output" && event.payload.id === id) {
        if (!attached || !replayReady) {
          outputQueue.push(event.payload);
        } else {
          applyOutput(event.payload);
        }
      } else if (event.event === "terminals.exit" && event.payload.id === id) {
        exitBeforeAttach = { exitCode: event.payload.exitCode };
        terminalHasExited = true;
        inputActive = false;
        setTerminalInfo((current) =>
          current ? { ...current, exited: true, exitCode: event.payload.exitCode } : current,
        );
      }
    });

    void serviceBridge.request("terminals.attach", { id }).then(
      ({ terminal: attachedTerminal, replay, seq }) => {
        if (!mounted) return;
        attached = true;
        lastSeq = seq;
        setTerminalInfo(
          exitBeforeAttach
            ? { ...attachedTerminal, exited: true, exitCode: exitBeforeAttach.exitCode }
            : attachedTerminal,
        );
        inputActive = !attachedTerminal.exited && !exitBeforeAttach;
        terminalHasExited = !inputActive;
        terminal.write(replay, () => {
          if (!mounted) return;
          replayReady = true;
          drainOutput();
          requestResize();
          terminal.focus();
        });
      },
      (error: unknown) => {
        if (!mounted) return;
        setTerminalError(
          error instanceof BridgeError && error.message ? error.message : t.terminal.attachFailed,
        );
      },
    );

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

  const title =
    terminalInfo?.title ?? (terminalError ? t.terminal.unknownTitle : t.terminal.loadingTitle);
  const exited = terminalInfo?.exited ?? false;
  const stateLabel = terminalInfo
    ? exited
      ? t.terminal.exited(terminalInfo.exitCode ?? null)
      : t.terminal.running
    : terminalError
      ? t.terminal.statusUnavailable
      : t.terminal.connecting;

  async function closeTerminal() {
    if (!bridge || isClosing) return;
    setCloseError("");
    setIsClosing(true);
    try {
      await bridge.request("terminals.close", { id });
      setIsConfirmOpen(false);
      navigate({ name: "new-conversation" });
    } catch (error) {
      setCloseError(
        error instanceof BridgeError && error.message ? error.message : t.terminal.closeFailed,
      );
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <h1 className={styles.title} id={titleId}>
            {terminalInfo ? (
              <span className={styles.visuallyHidden}>{t.terminal.namePrefix}</span>
            ) : null}
            {title}
          </h1>
          <p
            className={`${styles.state} ${exited ? styles.exited : terminalInfo ? styles.running : ""}`}
          >
            {terminalInfo ? (
              exited ? (
                <CircleX aria-hidden="true" size={15} strokeWidth={1.8} />
              ) : (
                <CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />
              )
            ) : (
              <CircleDashed aria-hidden="true" size={15} strokeWidth={1.8} />
            )}
            <span>{stateLabel}</span>
          </p>
        </div>
        <IconButton
          icon={<X aria-hidden="true" size={16} strokeWidth={1.8} />}
          label={t.terminal.close}
          onClick={() => {
            setCloseError("");
            if (exited) void closeTerminal();
            else setIsConfirmOpen(true);
          }}
          size="md"
        />
      </header>

      {terminalError ? (
        <p className={styles.error} role="alert">
          <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{terminalError}</span>
        </p>
      ) : null}
      {closeError && !isConfirmOpen ? (
        <p className={styles.error} role="alert">
          {closeError}
        </p>
      ) : null}

      <section
        aria-labelledby={titleId}
        aria-label={t.terminal.inaccessibleName(title)}
        className={styles.terminalRegion}
      >
        <div className={styles.terminalHost} ref={hostRef} />
      </section>

      <Dialog
        description={t.terminal.closeDescription}
        initialFocusRef={cancelCloseRef as RefObject<HTMLElement | null>}
        onClose={() => setIsConfirmOpen(false)}
        open={isConfirmOpen}
        title={t.terminal.closeTitle}
        footer={
          <>
            <Button
              disabled={isClosing}
              onClick={() => setIsConfirmOpen(false)}
              ref={cancelCloseRef}
              variant="secondary"
            >
              {t.terminal.cancel}
            </Button>
            <Button disabled={isClosing} onClick={() => void closeTerminal()} variant="danger">
              <SquareTerminal aria-hidden="true" size={15} strokeWidth={1.8} />
              {isClosing ? t.terminal.closing : t.terminal.close}
            </Button>
          </>
        }
      >
        {closeError ? (
          <p className={styles.error} role="alert">
            {closeError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

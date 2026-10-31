import { BridgeError } from "@karont/contract";
import { SquareTerminal, X } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./TerminalCloseButton.module.css";

export function TerminalCloseButton({
  className,
  exited,
  label,
  onClosed,
  terminalId,
}: {
  className?: string;
  exited: boolean;
  label: string;
  onClosed: () => void;
  terminalId: string;
}) {
  const bridge = getBridge();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

  async function closeTerminal() {
    if (!bridge || isClosing) return;
    setCloseError("");
    setIsClosing(true);
    try {
      await bridge.request("terminals.close", { id: terminalId });
      setIsConfirmOpen(false);
      onClosed();
    } catch (error) {
      setCloseError(
        error instanceof BridgeError && error.message ? error.message : t.terminal.closeFailed,
      );
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <>
      <IconButton
        className={className}
        disabled={!bridge}
        icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
        label={t.terminal.endTerminal(label)}
        onClick={() => {
          setCloseError("");
          setIsConfirmOpen(true);
        }}
        size="sm"
      />
      <Dialog
        description={exited ? t.terminal.closeExitedDescription : t.terminal.closeDescription}
        initialFocusRef={cancelRef as RefObject<HTMLElement | null>}
        onClose={() => setIsConfirmOpen(false)}
        open={isConfirmOpen}
        title={t.terminal.closeTitle}
        footer={
          <>
            <Button
              disabled={isClosing}
              onClick={() => setIsConfirmOpen(false)}
              ref={cancelRef}
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
    </>
  );
}

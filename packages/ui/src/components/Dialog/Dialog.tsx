import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef } from "react";
import styles from "./Dialog.module.css";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  returnFocusRef,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openingFocusRef = useRef<HTMLElement | null>(null);
  const preferredFocusRef = useRef(returnFocusRef);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    preferredFocusRef.current = returnFocusRef;
  }, [returnFocusRef]);

  const restoreFocus = useCallback(() => {
    const preferred = preferredFocusRef.current?.current;
    const opening = openingFocusRef.current;
    const target = preferred?.isConnected ? preferred : opening?.isConnected ? opening : null;
    target?.focus();
    openingFocusRef.current = null;
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        openingFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      const initialFocus =
        initialFocusRef?.current ?? dialog.querySelector<HTMLElement>("[autofocus]");
      initialFocus?.focus();
      return;
    }

    if (dialog.open) dialog.close();
    restoreFocus();
  }, [initialFocusRef, open, restoreFocus]);

  useEffect(
    () => () => {
      const dialog = dialogRef.current;
      if (!dialog?.open) return;
      dialog.close();
      restoreFocus();
    },
    [restoreFocus],
  );

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      ref={dialogRef}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className={styles.description} id={descriptionId}>
              {description}
            </p>
          ) : null}
        </header>
        <div className={styles.body}>{children}</div>
        <footer className={styles.footer}>{footer}</footer>
      </div>
    </dialog>
  );
}

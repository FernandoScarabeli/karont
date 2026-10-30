import React, { useEffect, useRef } from 'react';

export function FormDialog(props: {
  open: boolean;
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog"
      aria-label={props.title}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) props.onClose();
      }}
    >
      <div className="workspace-dialog-heading">
        <h2>{props.title}</h2>
        <button className="icon-button" aria-label="Fechar" onClick={props.onClose}>
          ×
        </button>
      </div>
      {props.children}
    </dialog>
  );
}

import { BridgeError, type Workspace } from "@karont/contract";
import { TriangleAlert } from "lucide-react";
import { type FormEvent, type RefObject, useId, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ProjectDialog.module.css";
import { ProjectIconPicker } from "./ProjectIconPicker.tsx";
import { DEFAULT_PROJECT_ICON } from "./projectIcons.ts";

const MAX_NAME_LENGTH = 80;

export type WorkspaceDialogProps = {
  open: boolean;
  /** `null` cria um workspace novo; um existente abre a edição de nome e ícone. */
  workspace: Workspace | null;
  onClose: () => void;
  onSaved: (workspace: Workspace, mode: "create" | "edit") => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/** Mesmo estilo do `ProjectDialog`: ícone ao lado do nome. Fica sempre montado, com `open` controlado. */
export function WorkspaceDialog({
  open,
  workspace,
  onClose,
  onSaved,
  returnFocusRef,
}: WorkspaceDialogProps) {
  const bridge = getBridge();
  const editing = workspace !== null;
  const [wasOpen, setWasOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_PROJECT_ICON);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  // Começa o formulário do zero cada vez que o diálogo abre.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(workspace?.name ?? "");
      setIcon(workspace?.icon ?? DEFAULT_PROJECT_ICON);
      setError("");
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setError(t.workspaces.nameRequired);
      nameRef.current?.focus();
      return;
    }
    if (cleanName.length > MAX_NAME_LENGTH) {
      setError(t.workspaces.nameTooLong);
      nameRef.current?.focus();
      return;
    }
    if (!bridge) {
      setError(t.workspaces.noBridge);
      return;
    }

    let pending: Promise<{ workspace: Workspace }>;
    if (workspace) {
      const changes = {
        ...(cleanName !== workspace.name ? { name: cleanName } : {}),
        ...(icon !== workspace.icon ? { icon } : {}),
      };
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      pending = bridge.request("workspaces.update", { id: workspace.id, ...changes });
    } else {
      pending = bridge.request("workspaces.create", { name: cleanName, icon });
    }

    setError("");
    setSubmitting(true);
    try {
      const result = await pending;
      setSubmitting(false);
      onSaved(result.workspace, editing ? "edit" : "create");
    } catch (saveError) {
      setSubmitting(false);
      setError(
        saveError instanceof BridgeError && saveError.message
          ? saveError.message
          : t.workspaces.saveFailed,
      );
    }
  }

  function close() {
    if (!submitting) onClose();
  }

  return (
    <Dialog
      description={editing ? undefined : t.workspaces.createDescription}
      footer={
        <>
          <Button disabled={submitting} onClick={close} variant="secondary">
            {t.workspaces.cancel}
          </Button>
          <Button disabled={submitting} form={formId} type="submit" variant="primary">
            {editing
              ? submitting
                ? t.workspaces.saving
                : t.workspaces.save
              : submitting
                ? t.workspaces.creating
                : t.workspaces.create}
          </Button>
        </>
      }
      initialFocusRef={nameRef as RefObject<HTMLElement | null>}
      onClose={close}
      open={open}
      returnFocusRef={returnFocusRef}
      title={editing ? t.workspaces.editTitle : t.workspaces.createTitle}
    >
      <form className={styles.form} id={formId} onSubmit={(event) => void submit(event)}>
        <div className={styles.identityRow}>
          <ProjectIconPicker onChange={setIcon} value={icon} />
          <TextField
            autoComplete="off"
            label={t.workspaces.nameLabel}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError("");
            }}
            ref={nameRef}
            value={name}
          />
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{error}</span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

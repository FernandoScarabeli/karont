import { FormDialog } from '../../components/FormDialog';
import type { useWorkspaceForm } from './useWorkspaceForm';
import type { useWorkspaceData } from './useWorkspaceData';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  form: ReturnType<typeof useWorkspaceForm>;
};

export function WorkspaceDialog({ data, form }: Props) {
  const { formError, busy, setFormError } = data;
  const { workspaceDialog, setWorkspaceDialog, workspaceName, setWorkspaceName, saveWorkspace } =
    form;
  return (
    <FormDialog
      open={Boolean(workspaceDialog)}
      title={workspaceDialog === 'rename' ? 'Renomear workspace' : 'Criar workspace'}
      onClose={() => {
        if (!busy) setWorkspaceDialog(undefined);
      }}
    >
      <form onSubmit={(e) => void saveWorkspace(e)}>
        <label>
          Nome do workspace
          <input
            autoFocus
            required
            maxLength={120}
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>
        {formError && (
          <p role="alert" className="k-form-error">
            {formError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setWorkspaceDialog(undefined)}
          >
            Cancelar
          </button>
          <button className="primary" disabled={busy || !workspaceName.trim()}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

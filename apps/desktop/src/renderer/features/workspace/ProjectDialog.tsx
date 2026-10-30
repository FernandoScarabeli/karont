import { FormDialog } from '../../components/FormDialog';
import type { useProjectForm } from './useProjectForm';
import type { useWorkspaceData } from './useWorkspaceData';
import type { UiWorkspaceProject } from '../../lib/api';
import { iconLabels, projectIcons } from './workspaceShared';

type Props = {
  data: ReturnType<typeof useWorkspaceData>;
  form: ReturnType<typeof useProjectForm>;
};

export function ProjectDialog({ data, form }: Props) {
  const { formError, busy, setFormError } = data;
  const {
    projectDialog,
    setProjectDialog,
    editingProject,
    projectName,
    setProjectName,
    projectRoot,
    setProjectRoot,
    projectIcon,
    setProjectIcon,
    saveProject,
  } = form;
  return (
    <FormDialog
      open={projectDialog}
      title={editingProject ? 'Configurações do projeto' : 'Criar projeto'}
      onClose={() => {
        if (!busy) setProjectDialog(false);
      }}
    >
      <form onSubmit={(e) => void saveProject(e)}>
        <label>
          Nome
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="Nome do projeto"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        <fieldset className="k-icon-options">
          <legend>Ícone</legend>
          {Object.entries(projectIcons).map(([name, Icon], i) => (
            <button
              type="button"
              key={name}
              aria-pressed={projectIcon === name}
              title={iconLabels[i]}
              aria-label={iconLabels[i]}
              onClick={() => setProjectIcon(name as UiWorkspaceProject['icon'])}
            >
              <Icon size={18} />
            </button>
          ))}
        </fieldset>
        <label>
          Pasta raiz
          <div className="k-folder-field">
            <span title={projectRoot}>{projectRoot || 'Selecione uma pasta'}</span>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                void window.karont
                  .chooseProjectFolder()
                  .then((root) => {
                    if (root) setProjectRoot(root);
                  })
                  .catch(() =>
                    setFormError('Não foi possível abrir o seletor de pasta. Tente novamente.'),
                  );
              }}
            >
              Escolher…
            </button>
          </div>
        </label>
        {formError && (
          <p className="k-form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setProjectDialog(false)}
          >
            Cancelar
          </button>
          <button className="primary" disabled={busy || !projectName.trim() || !projectRoot}>
            {busy
              ? editingProject
                ? 'Salvando…'
                : 'Criando…'
              : editingProject
                ? 'Salvar alterações'
                : 'Criar projeto'}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

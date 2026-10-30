import { useState } from 'react';
import type { FormEvent } from 'react';
import type { useWorkspaceData } from './useWorkspaceData';

type WorkspaceData = ReturnType<typeof useWorkspaceData>;

export function useWorkspaceForm(data: WorkspaceData) {
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<'create' | 'rename'>();
  const [workspaceName, setWorkspaceName] = useState('');

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (data.busy) return;
    data.setBusy(true);
    data.setFormError('');
    try {
      const result =
        workspaceDialog === 'rename' && data.navigation.workspaceId
          ? await window.karont.renameWorkspace(data.navigation.workspaceId, workspaceName)
          : await window.karont.createWorkspace(workspaceName);
      data.setWorkspaces((old) => [...old.filter((w) => w.id !== result.id), result]);
      setWorkspaceDialog(undefined);
      await data.home(result.id);
    } catch {
      data.setFormError('Não foi possível salvar o workspace. Confira o nome e tente novamente.');
    } finally {
      data.setBusy(false);
    }
  }

  return {
    workspaceMenu,
    setWorkspaceMenu,
    workspaceDialog,
    setWorkspaceDialog,
    workspaceName,
    setWorkspaceName,
    saveWorkspace,
  };
}

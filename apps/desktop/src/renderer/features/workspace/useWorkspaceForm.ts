import { useState } from 'react';
import type { FormEvent } from 'react';
import type { useWorkspaceData } from './useWorkspaceData';

type WorkspaceData = ReturnType<typeof useWorkspaceData>;

export function useWorkspaceForm(data: WorkspaceData) {
  const [workspaceDialog, setWorkspaceDialog] = useState<'create' | 'rename'>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceTargetId, setWorkspaceTargetId] = useState<string>();

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (data.busy) return;
    data.setBusy(true);
    data.setFormError('');
    try {
      const targetId = workspaceTargetId ?? data.navigation.workspaceId;
      const result =
        workspaceDialog === 'rename' && targetId
          ? await window.karont.renameWorkspace(targetId, workspaceName)
          : await window.karont.createWorkspace(workspaceName);
      data.setWorkspaces((old) =>
        old.some((workspace) => workspace.id === result.id)
          ? old.map((workspace) => (workspace.id === result.id ? result : workspace))
          : [...old, result],
      );
      setWorkspaceDialog(undefined);
      setWorkspaceTargetId(undefined);
      await data.home(result.id);
    } catch {
      data.setFormError('Não foi possível salvar o workspace. Confira o nome e tente novamente.');
    } finally {
      data.setBusy(false);
    }
  }

  return {
    workspaceDialog,
    setWorkspaceDialog,
    workspaceName,
    setWorkspaceName,
    setWorkspaceTargetId,
    saveWorkspace,
  };
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { UiWorkspaceProject } from '../../lib/api';
import type { useWorkspaceData } from './useWorkspaceData';

type WorkspaceData = ReturnType<typeof useWorkspaceData>;

export function useProjectForm(data: WorkspaceData) {
  const [projectDialog, setProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<UiWorkspaceProject>();
  const [projectName, setProjectName] = useState('');
  const [projectRoot, setProjectRoot] = useState('');
  const [projectIcon, setProjectIcon] = useState<UiWorkspaceProject['icon']>('folder');

  async function saveProject(event: FormEvent) {
    event.preventDefault();
    if (data.busy || !data.navigation.workspaceId) return;
    data.setBusy(true);
    data.setFormError('');
    try {
      if (editingProject) {
        await window.karont.updateProject({
          projectId: editingProject.id,
          name: projectName,
          root: projectRoot,
          icon: projectIcon,
        });
        setProjectDialog(false);
        setEditingProject(undefined);
        setProjectName('');
        setProjectRoot('');
        setProjectIcon('folder');
        data.setRefresh((n) => n + 1);
        data.setNotice('Projeto atualizado.');
        return;
      }
      const result = await window.karont.addProject({
        workspaceId: data.navigation.workspaceId,
        name: projectName,
        icon: projectIcon,
        root: projectRoot,
        dotIds: [],
      });
      if ('cancelled' in result) return;
      setProjectDialog(false);
      setProjectName('');
      setProjectRoot('');
      setProjectIcon('folder');
      data.setRefresh((n) => n + 1);
      data.setExpanded((old) => ({ ...old, [result.project.id]: true }));
      if (result.project.workspaceId !== data.navigation.workspaceId)
        await data.home(result.project.workspaceId);
      data.setNotice(
        result.duplicate
          ? `Pasta já vinculada ao projeto “${result.project.name}”.`
          : `Projeto “${result.project.name}” criado.`,
      );
    } catch {
      data.setFormError(
        'Não foi possível criar o projeto. Confira se a pasta é a raiz de um repositório Git acessível com um commit e tente novamente.',
      );
    } finally {
      data.setBusy(false);
    }
  }

  return {
    projectDialog,
    setProjectDialog,
    editingProject,
    setEditingProject,
    projectName,
    setProjectName,
    projectRoot,
    setProjectRoot,
    projectIcon,
    setProjectIcon,
    saveProject,
  };
}

import { useEffect, useState } from 'react';
import type { UiDot, UiRun, UiWorkspace, UiWorkspaceProject } from '../../lib/api';

export function useTaskCatalog() {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [projects, setProjects] = useState<UiWorkspaceProject[]>([]);
  const [dots, setDots] = useState<UiDot[]>([]);
  const [runs, setRuns] = useState<UiRun[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      window.karont.workspaces(),
      window.karont.projectIndex(),
      window.karont.dots(),
      window.karont.runs(100),
    ])
      .then(([workspacePage, projectPage, configuredDots, runList]) => {
        if (!mounted) return;
        setWorkspaces(workspacePage.items);
        setProjects(projectPage.items);
        setDots(configuredDots);
        setRuns(runList);
      })
      .catch(() => {
        if (mounted) setError('Não foi possível carregar projetos e responsáveis disponíveis.');
      });
    const dispose = window.karont.onEvent((event) => {
      if (event.type === 'task.updated') setRefresh((value) => value + 1);
    });
    return () => {
      mounted = false;
      dispose();
    };
  }, []);

  return {
    workspaces,
    projects,
    dots,
    runs,
    error,
    setError,
    refresh,
    setRefresh,
  };
}

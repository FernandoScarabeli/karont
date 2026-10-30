import React from 'react';
import { createRoot } from 'react-dom/client';
// A ordem importa: o LegacyWorkbench traz o RunDesk, que importa o xterm.css antes dos estilos do app.
import { LegacyWorkbench } from './app/LegacyWorkbench';
import { WorkspaceDesk } from './features/workspace/WorkspaceDesk';
import './styles/tokens.css';
import './styles/style.css';
import './styles/karont.css';
createRoot(document.getElementById('root')!).render(
  <WorkspaceDesk view="workspaces" tools={<LegacyWorkbench />} />,
);

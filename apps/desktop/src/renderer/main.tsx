import React from 'react';
import { createRoot } from 'react-dom/client';
import { LegacyWorkbench } from './app/LegacyWorkbench';
import { WorkspaceDesk } from './features/workspace/WorkspaceDesk';
// Todos os estilos globais entram aqui, nesta ordem: a cascata depende dela. O xterm.css vem
// primeiro para os estilos do app poderem sobrescrever o terminal.
import '@xterm/xterm/css/xterm.css';
import './styles/tokens.css';
import './styles/style.css';
import './styles/karont.css';
import './styles/shell.css';
createRoot(document.getElementById('root')!).render(
  <WorkspaceDesk view="workspaces" tools={<LegacyWorkbench />} />,
);

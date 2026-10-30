import type { ReactNode } from 'react';
import type { UiDot } from '../../lib/api';
import { Bot, Workflow } from 'lucide-react';
import { RunDesk } from '../runs/RunDesk';

type Props = {
  page: string;
  dots: UiDot[];
  setPage: (page: 'home' | 'chat' | 'tasks' | 'agents' | 'automations' | 'settings') => void;
  tools?: ReactNode;
};

export function WorkspacePages({ page, dots, setPage, tools }: Props) {
  return (
    <>
      {page === 'agents' && (
        <div className="k-page">
          <header className="k-page-title">
            <h1>Agentes</h1>
            <p>Dots configurados no ambiente local.</p>
          </header>
          {dots.length ? (
            dots.map((dot) => (
              <article className="k-agent" key={dot.id}>
                <span className="k-dot-identity">{dot.name.slice(0, 1)}</span>
                <div>
                  <h2>{dot.name}</h2>
                  <p>{dot.role}</p>
                  <small>
                    {dot.projectIds.length} projetos configurados · {dot.capabilities.length} modos
                    de permissão
                  </small>
                </div>
              </article>
            ))
          ) : (
            <div className="k-page-empty">
              <Bot size={28} />
              <h2>Nenhum Dot configurado</h2>
              <p>Configure seus Dots nas ferramentas locais para iniciar execuções.</p>
            </div>
          )}
          <button className="quiet" onClick={() => setPage('settings')}>
            Abrir ferramentas locais
          </button>
        </div>
      )}
      {page === 'automations' && (
        <div className="k-page">
          <header className="k-page-title">
            <h1>Automações</h1>
          </header>
          <div className="k-page-empty">
            <Workflow size={28} />
            <h2>Um espaço para os próximos fluxos</h2>
            <p>Automações agendadas ainda estão em planejamento.</p>
          </div>
        </div>
      )}
      {page === 'settings' && (
        <div className="k-page k-settings">
          <header className="k-page-title">
            <h1>Configurações e ferramentas</h1>
            <p>Diagnóstico, execuções anteriores e laboratório local.</p>
          </header>
          {tools ?? <RunDesk />}
        </div>
      )}
    </>
  );
}

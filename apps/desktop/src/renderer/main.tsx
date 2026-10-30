import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Layout, Snapshot } from '../../../../packages/contracts/src';
import './lib/api';
import { Attention } from './features/attention/Attention';
import { RunDesk } from './features/runs/RunDesk';
import { WorkspaceDesk, type WorkspaceView } from './features/workspace/WorkspaceDesk';
import { TaskDesk } from './features/tasks/TaskDesk';
import './styles/tokens.css';
import './styles/style.css';
import './styles/karont.css';
const Editor = lazy(() => import('./features/editor/Editor'));
type AppRoute = WorkspaceView | 'tasks' | 'previous' | 'lab';
const routeLabels: Record<AppRoute, string> = {
  workspaces: 'Workspaces',
  tasks: 'Tarefas',
  favorites: 'Favoritos',
  recent: 'Recentes',
  free: 'Conversas livres',
  previous: 'Execuções anteriores',
  lab: 'Laboratório',
};
function LegacyWorkbench() {
  const [route, setRoute] = useState<AppRoute>('lab');
  const [data, setData] = useState<Snapshot>();
  const [layout, setLayout] = useState<Layout>();
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [latency, setLatency] = useState(0);
  const queue = useRef(Promise.resolve());
  const current = useRef<Layout | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let streaming = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const t = performance.now();
      try {
        const result = await window.karont.snapshot();
        streaming = result.streaming;
        if (active) {
          setData(result);
          setLatency(performance.now() - t);
          setError('');
          if (!current.current) {
            current.current = result.layout;
            setLayout(result.layout);
          }
        }
      } catch {
        if (active) setError('Conexão interrompida');
      }
      if (active) timer = setTimeout(poll, document.hidden ? 2000 : streaming ? 250 : 1000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  function save(next: Layout) {
    current.current = next;
    setLayout(next);
    setSaving(true);
    setSaveError('');
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await window.karont.layout(next);
          setError('');
        } catch {
          setSaveError('Falha ao salvar. Tente novamente antes de fechar.');
          throw Error('save');
        } finally {
          setSaving(false);
        }
      });
    void queue.current.catch(() => {});
  }
  async function close() {
    try {
      await queue.current;
      await window.karont.close();
    } catch {
      setError('Não foi possível salvar o layout.');
    }
  }
  return (
    <div className="shell">
      <aside className="rail" aria-label="Navegação principal">
        <div className="brand">
          k<span>karont</span>
        </div>
        <div className="rail-section">TRABALHO</div>
        <nav className="rail-nav" aria-label="Áreas de trabalho">
          {(['workspaces', 'tasks', 'favorites', 'recent', 'free'] as AppRoute[]).map((item) => (
            <button
              key={item}
              className={route === item ? 'nav-active' : 'nav-link'}
              aria-current={route === item ? 'page' : undefined}
              onClick={() => setRoute(item)}
            >
              <span aria-hidden="true">
                {item === 'workspaces'
                  ? '▦'
                  : item === 'tasks'
                    ? '▤'
                    : item === 'favorites'
                      ? '☆'
                      : item === 'recent'
                        ? '◷'
                        : '☰'}
              </span>
              {routeLabels[item]}
            </button>
          ))}
        </nav>
        <div className="rail-section rail-section-secondary">SISTEMA</div>
        <nav className="rail-nav" aria-label="Ferramentas do sistema">
          {(['previous', 'lab'] as AppRoute[]).map((item) => (
            <button
              key={item}
              className={route === item ? 'nav-active' : 'nav-link'}
              aria-current={route === item ? 'page' : undefined}
              onClick={() => setRoute(item)}
            >
              <span aria-hidden="true">{item === 'previous' ? '↺' : '◫'}</span>
              {routeLabels[item]}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <span className="phase">FASE 4A</span>
          <p>
            Organização do trabalho
            <br />
            Linux · local primeiro
          </p>
        </div>
      </aside>
      <main className="app-main">
        <header className="app-header">
          <div>
            <div className="eyebrow">KARONT / AMBIENTE LOCAL</div>
            <h1>{routeLabels[route]}</h1>
            <p>
              {route === 'workspaces'
                ? 'Organize projetos e retome conversas persistentes.'
                : route === 'tasks'
                  ? 'Acompanhe trabalho por projeto, com vínculos explícitos a conversas e Runs.'
                  : route === 'favorites'
                    ? 'Conversas marcadas para voltar com rapidez.'
                    : route === 'recent'
                      ? 'Conversas ordenadas pela última abertura.'
                      : route === 'free'
                        ? 'Histórico local sem execução de agente nesta fase.'
                        : route === 'previous'
                          ? 'Runs antigas sem conversa vinculada.'
                          : 'Terminais, revisão por execução e laboratório de regressão.'}
            </p>
          </div>
          <button className="quiet" onClick={() => void close()} disabled={saving}>
            Fechar janela ↗
          </button>
        </header>
        <nav className="k-tools-nav" aria-label="Ferramentas locais">
          <button className="quiet" onClick={() => setRoute('lab')}>
            Diagnóstico e laboratório
          </button>
          <button className="quiet" onClick={() => setRoute('previous')}>
            Execuções anteriores
          </button>
        </nav>
        <Attention />
        <section className="health" aria-label="Diagnóstico do daemon">
          <div>
            <span className={'dot ' + (error ? 'bad' : '')} />
            <strong>{error ? 'Desconectado' : data ? 'Daemon conectado' : 'Conectando…'}</strong>
            <small>PID {data?.pid ?? '—'}</small>
          </div>
          <div>
            <span>Heartbeat</span>
            <strong data-testid="heartbeat">{data?.heartbeat ?? '—'}</strong>
          </div>
          <div>
            <span>RAM daemon</span>
            <strong>
              {data ? (data.rss / 1048576).toFixed(1) : '—'} <small>MiB RSS</small>
            </strong>
          </div>
          <div>
            <span>Ida e volta IPC</span>
            <strong>
              {latency.toFixed(1)} <small>ms</small>
            </strong>
          </div>
          <div>
            <span>Persistência</span>
            <strong>
              SQLite <small>WAL / FTS5</small>
            </strong>
          </div>
        </section>
        {(error || saveError) && (
          <p className="error" role="alert">
            {error === 'Conexão interrompida'
              ? 'Conexão interrompida. Tentando reconectar ao daemon…'
              : saveError || error}
          </p>
        )}
        {(['workspaces', 'favorites', 'recent', 'free'] as string[]).includes(route) && (
          <WorkspaceDesk view={route as WorkspaceView} />
        )}
        {route === 'tasks' && (
          <TaskDesk
            onOpenConversation={(chatId) => {
              void window.karont.openChat(chatId).then(() => setRoute('workspaces'));
            }}
          />
        )}
        {route === 'previous' && <RunDesk previousOnly />}
        {route === 'lab' && (
          <>
            <RunDesk />
            <section className="workload">
              <div>
                <h2>
                  Laboratório Fase 0 <span>8 painéis</span>
                </h2>
                <p>Carga sintética preservada para comparar o protótipo da Fase 0</p>
              </div>
              <div className="toolbar">
                <label>
                  Colunas{' '}
                  <select
                    aria-label="Colunas"
                    disabled={!layout}
                    value={layout?.columns ?? 4}
                    onChange={(e) =>
                      layout && save({ ...layout, columns: Number(e.target.value) as 2 | 4 })
                    }
                  >
                    <option value={4}>4</option>
                    <option value={2}>2</option>
                  </select>
                </label>
                <button
                  disabled={!data}
                  className={data?.streaming ? 'quiet' : 'primary'}
                  onClick={() =>
                    void window.karont
                      .stream(!data?.streaming)
                      .then(setData)
                      .catch(() => setError('Falha ao alterar streaming.'))
                  }
                >
                  {data?.streaming ? 'Pausar streaming' : 'Iniciar streaming'}
                </button>
              </div>
            </section>
            <section
              className="panels"
              aria-label="Oito painéis simulados"
              style={{ '--columns': layout?.columns ?? 4 } as React.CSSProperties}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <article key={i} className="panel">
                  <div className="panel-head">
                    <h3>
                      <span>{String(i + 1).padStart(2, '0')}</span> Fluxo simulado
                    </h3>
                    <small>{data?.streaming ? 'TRANSMITINDO' : 'EM ESPERA'}</small>
                  </div>
                  <div className="terminal" aria-label={`Saída simulada ${i + 1}`}>
                    {Array.from({ length: 5 }, (_, line) => {
                      const seq = Math.max(0, (data?.sequence ?? 0) - 4 + line);
                      return (
                        <div key={line}>
                          <span>{String(seq).padStart(5, '0')}</span>{' '}
                          {seq === 0
                            ? 'Pronto para o teste.'
                            : `painel ${i + 1} · lote ${seq} recebido`}
                        </div>
                      );
                    })}
                  </div>
                  <footer>
                    <span>{data?.streaming ? '● stream local' : '○ stream pausado'}</span>
                    <span>buffer limitado</span>
                  </footer>
                </article>
              ))}
            </section>
            <section className="editor">
              <div className="editor-heading">
                <div>
                  <h2>Editor de teste</h2>
                  <p>Conteúdo e layout salvos no daemon.</p>
                </div>
                <button
                  disabled={!layout}
                  className="quiet"
                  onClick={() => layout && save({ ...layout, editorOpen: !layout.editorOpen })}
                >
                  {layout?.editorOpen ? 'Recolher editor' : 'Abrir editor'}
                </button>
              </div>
              {layout?.editorOpen && (
                <Suspense fallback={<p>Carregando CodeMirror…</p>}>
                  <Editor
                    value={layout.editor}
                    onChange={(editor) => save({ ...current.current!, editor })}
                  />
                </Suspense>
              )}
            </section>
            <footer className="status">
              <span role="status">
                {saveError
                  ? 'Alterações não salvas'
                  : saving
                    ? 'Salvando…'
                    : layout
                      ? 'Layout sincronizado'
                      : 'Aguardando estado…'}
              </span>
              <span>
                Fechar a janela mantém o daemon ativo. Reabra pelo tray ou execute npm start.
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <WorkspaceDesk view="workspaces" tools={<LegacyWorkbench />} />,
);

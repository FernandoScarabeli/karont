import { useEffect, useRef, useState } from 'react';
import type { Approval, DiagnosticItem } from '../../../../../../packages/contracts/src';
import { decidePendingApproval } from './approvalActions';

export function Attention() {
  const [panel, setPanel] = useState<'approvals' | 'diagnostics' | 'report'>();
  const [approvals, setApprovals] = useState<Approval[]>([]),
    [items, setItems] = useState<DiagnosticItem[]>([]),
    [report, setReport] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(''),
    [enabled, setEnabled] = useState(true),
    [delivery, setDelivery] = useState('Nenhum envio registrado'),
    [busy, setBusy] = useState(false);
  const region = useRef<HTMLElement>(null);
  async function load(next: typeof panel) {
    setPanel(next);
    setError('');
    setNotice('');
    try {
      if (next === 'approvals') setApprovals(await window.karont.approvals());
      if (next === 'diagnostics') {
        setItems(await window.karont.diagnostics());
        const n = await window.karont.notifications();
        setEnabled(n.enabled);
        setDelivery(
          n.history
            .map(
              (item) =>
                `${new Date(item.at).toLocaleTimeString()} · ${item.event} · ${item.status}`,
            )
            .join('\n') || 'Nenhum envio registrado',
        );
      }
      if (next === 'report') setReport(await window.karont.report());
    } catch {
      setError('Não foi possível carregar. Verifique a conexão e tente novamente.');
    }
  }
  useEffect(() => {
    if (panel) region.current?.focus();
    const dispose = window.karont.onEvent((event) => {
      if (event.type === 'approval.updated')
        setApprovals((current) =>
          [event.approval, ...current.filter((a) => a.id !== event.approval.id)].slice(0, 100),
        );
    });
    return dispose;
  }, [panel]);
  async function decide(a: Approval, allow: boolean) {
    setBusy(true);
    setError('');
    try {
      if (!(await decidePendingApproval(a.id, allow))) return;
      setApprovals(await window.karont.approvals());
    } catch {
      setError(
        'A decisão não pôde ser aplicada. Atualize a prévia: pode haver conflito ou decisão anterior.',
      );
      void window.karont
        .approvals()
        .then(setApprovals)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attention">
      <nav aria-label="Mission Control">
        <button
          type="button"
          className="quiet"
          aria-expanded={panel === 'approvals'}
          onClick={() => void load('approvals')}
        >
          Central de Aprovações
        </button>
        <button
          type="button"
          className="quiet"
          aria-expanded={panel === 'diagnostics'}
          onClick={() => void load('diagnostics')}
        >
          Diagnóstico
        </button>
        <button
          type="button"
          className="quiet"
          aria-expanded={panel === 'report'}
          onClick={() => void load('report')}
        >
          Reportar problema
        </button>
      </nav>
      {panel && (
        <section
          ref={region}
          tabIndex={-1}
          className="attention-panel"
          aria-label={
            panel === 'approvals'
              ? 'Central de Aprovações'
              : panel === 'diagnostics'
                ? 'Diagnóstico'
                : 'Reportar problema'
          }
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPanel(undefined);
          }}
        >
          <div className="history-heading">
            <h2>
              {panel === 'approvals'
                ? 'Central de Aprovações'
                : panel === 'diagnostics'
                  ? 'Diagnóstico'
                  : 'Reportar problema'}
            </h2>
            <div>
              <button type="button" className="quiet" onClick={() => void load(panel)}>
                Atualizar
              </button>
              <button type="button" className="quiet" onClick={() => setPanel(undefined)}>
                Fechar painel
              </button>
            </div>
          </div>
          {notice && (
            <p className="desk-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="desk-alert">
              {error}
            </p>
          )}
          {panel === 'approvals' && (
            <>
              <p>
                Operações do Karont com confirmação auditável. Aprovações internas dos agentes
                continuam na CLI. Não há detecção confiável de interação pendente no PTY genérico.
              </p>
              {!approvals.length ? (
                <p className="desk-empty">
                  Nenhum pedido registrado. Solicite uma prévia de rollback no diff de uma execução
                  concluída.
                </p>
              ) : (
                <div className="approval-list">
                  {approvals.map((a) => (
                    <article key={a.id}>
                      <strong>Rollback · {a.status}</strong>
                      <p>
                        Dot {a.dotId} · Projeto {a.projectId} · Run {a.runId.slice(0, 8)}
                      </p>
                      <small>
                        Pedido: {new Date(a.createdAt).toLocaleString()}
                        {a.decidedAt ? ` · Decisão: ${new Date(a.decidedAt).toLocaleString()}` : ''}
                      </small>
                      <div>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('karont-open-run', { detail: a.runId }),
                            );
                            setPanel(undefined);
                          }}
                        >
                          Abrir terminal
                        </button>
                        {a.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              className="quiet"
                              disabled={busy}
                              onClick={() => void decide(a, false)}
                            >
                              Negar
                            </button>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={() => void decide(a, true)}
                            >
                              Confirmar rollback
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {panel === 'diagnostics' && (
            <>
              <p>Coleta sob demanda. “Não verificado” não significa disponível.</p>
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    const value = e.target.checked;
                    setEnabled(value);
                    void window.karont.notifications(value).catch(() => {
                      setEnabled(!value);
                      setError('Preferência não salva.');
                    });
                  }}
                />{' '}
                Notificações nativas
              </label>
              <dl className="diagnostic-list">
                {items.map((item, i) => (
                  <div key={i}>
                    <dt>
                      {item.category} · {item.label}{' '}
                      <small>
                        {
                          {
                            available: 'disponível',
                            unavailable: 'indisponível',
                            error: 'erro',
                            unverified: 'não verificado',
                          }[item.status]
                        }
                      </small>
                    </dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
              <h3>Entregas ao serviço</h3>
              <pre>{delivery}</pre>
              <p>
                submitted = envio solicitado; failed = falha; unavailable = indisponível; disabled =
                desativado. Nenhum estado comprova visualização.
              </p>
            </>
          )}
          {panel === 'report' && (
            <>
              <p>
                Relatório local sanitizado. Revise antes de compartilhar. Nenhum envio automático.
              </p>
              <textarea aria-label="Prévia do relatório" readOnly value={report} rows={18} />
              <div className="dialog-actions">
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    void window.karont
                      .copyReport()
                      .then(() => setNotice('Relatório copiado.'))
                      .catch(() => setError('Não foi possível copiar.'))
                  }
                >
                  Copiar relatório
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    void window.karont
                      .saveReport()
                      .then((ok) => {
                        if (ok) setNotice('Relatório salvo localmente.');
                      })
                      .catch(() => setError('Não foi possível salvar.'))
                  }
                >
                  Salvar Markdown
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

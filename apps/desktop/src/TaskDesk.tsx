import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UiDot, UiRun, UiTask, UiTaskAssignee, UiTaskEvent, UiTaskState, UiTaskSummary, UiWorkspace, UiWorkspaceProject } from './api';

const states: { value: UiTaskState; label: string }[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'review', label: 'Em revisão' },
  { value: 'done', label: 'Concluída' },
];
const stateLabel = (state: UiTaskState) => states.find((item) => item.value === state)?.label ?? state;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export type TaskSeed = {
  nonce: string;
  projectId: string | null;
  title: string;
  description: string;
  originChatId: string | null;
  originMessageId: string | null;
  sourceLabel: string;
};

export function TaskCreationDialog(props: {
  open: boolean;
  projects: UiWorkspaceProject[];
  dots: UiDot[];
  fixedProjectId?: string;
  seed?: TaskSeed;
  onClose(): void;
  onCreated(task: UiTask): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef(props.seed?.description ?? '');
  const operationId = useRef(crypto.randomUUID());
  const [projectId, setProjectId] = useState(props.fixedProjectId ?? props.seed?.projectId ?? '');
  const [title, setTitle] = useState(props.seed?.title ?? '');
  const [description, setDescription] = useState(props.seed?.description ?? '');
  const [state, setState] = useState<UiTaskState>('todo');
  const [assignees, setAssignees] = useState<UiTaskAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal();
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open]);

  const project = props.projects.find((item) => item.id === projectId);
  const availableDots = project ? props.dots.filter((dot) => project.dotIds.includes(dot.id)) : [];

  function toggleAssignee(next: UiTaskAssignee) {
    const key = `${next.kind}:${next.id}`;
    setAssignees((current) => current.some((item) => `${item.kind}:${item.id}` === key)
      ? current.filter((item) => `${item.kind}:${item.id}` !== key)
      : [...current, next]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const descriptionValue = descriptionInput.current?.value ?? descriptionRef.current;
    if (saving || !projectId || !title.trim() || byteLength(descriptionValue) > 16000) return;
    setSaving(true);
    setError('');
    try {
      const created = await window.eros.createTask({
        projectId,
        title: title.trim(),
        description: descriptionValue,
        state,
        assignees,
        originChatId: props.seed?.originChatId ?? null,
        originMessageId: props.seed?.originMessageId ?? null,
      }, operationId.current);
      props.onCreated(created);
    } catch {
      setError('Não foi possível criar a tarefa. Confira o projeto, os responsáveis e tente revisar os campos.');
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="workspace-dialog task-dialog" aria-label={props.seed ? 'Prévia da nova tarefa' : 'Nova tarefa'} onCancel={(event) => { event.preventDefault(); props.onClose(); }} onClick={(event) => { if (event.target === dialog.current) props.onClose(); }}>
    <div className="workspace-dialog-heading"><h2>{props.seed ? 'Revisar nova tarefa' : 'Nova tarefa'}</h2><button type="button" className="icon-button" aria-label="Fechar" onClick={props.onClose}>×</button></div>
    <form onSubmit={(event) => void submit(event)}>
      {props.fixedProjectId ? <p className="task-project-context"><strong>Projeto:</strong> {project?.name ?? 'Projeto não disponível'}</p> : <label>Projeto<select autoFocus value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Selecione o projeto</option>{props.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {props.seed?.sourceLabel && <p className="task-project-context"><strong>Origem:</strong> {props.seed.sourceLabel}</p>}
      <label>Título<input autoFocus={!props.fixedProjectId} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Descrição<textarea ref={descriptionInput} maxLength={16000} defaultValue={props.seed?.description ?? ''} onChange={(event) => { descriptionRef.current = event.target.value; setDescription(event.target.value); }} /></label>
      <small className="task-byte-count">{byteLength(description)}/16.000 bytes UTF-8</small>
      <label>Estado inicial<select value={state} onChange={(event) => setState(event.target.value as UiTaskState)}>{states.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <fieldset className="grant-list"><legend>Responsáveis (opcional)</legend>
        <label><input type="checkbox" checked={assignees.some((item) => item.kind === 'local')} onChange={() => toggleAssignee({ kind: 'local', id: 'local-user' })} />Você</label>
        {availableDots.map((dot) => <label key={dot.id}><input type="checkbox" checked={assignees.some((item) => item.kind === 'dot' && item.id === dot.id)} onChange={() => toggleAssignee({ kind: 'dot', id: dot.id })} />{dot.name}</label>)}
        {project && !availableDots.length && <small>Nenhum Dot está autorizado para este projeto. Isso não afeta a criação da tarefa.</small>}
      </fieldset>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet" onClick={props.onClose}>Cancelar</button><button className="primary" disabled={saving || !projectId || !title.trim() || byteLength(description) > 16000}>{saving ? 'Criando…' : props.seed ? 'Confirmar e criar tarefa' : 'Criar tarefa'}</button></div>
    </form>
  </dialog>;
}

export function TaskDesk(props: { onOpenConversation(chatId: string): void }) {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [projects, setProjects] = useState<UiWorkspaceProject[]>([]);
  const [dots, setDots] = useState<UiDot[]>([]);
  const [runs, setRuns] = useState<UiRun[]>([]);
  const [tasks, setTasks] = useState<UiTaskSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [stateFilter, setStateFilter] = useState<UiTaskState | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [mode, setMode] = useState<'aggregate' | 'project'>('aggregate');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<UiTask>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createNonce, setCreateNonce] = useState('closed');
  const [events, setEvents] = useState<UiTaskEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState<string | null>(null);
  const [eventMore, setEventMore] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [stateDraft, setStateDraft] = useState<UiTaskState>('todo');
  const [assigneeKeys, setAssigneeKeys] = useState<string[]>([]);
  const [runCandidateId, setRunCandidateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let mounted = true;
    void Promise.all([window.eros.workspaces(), window.eros.projectIndex(), window.eros.dots(), window.eros.runs(100)])
      .then(([workspacePage, projectPage, configuredDots, runList]) => {
        if (!mounted) return;
        setWorkspaces(workspacePage.items);
        setProjects(projectPage.items);
        setDots(configuredDots);
        setRuns(runList);
      })
      .catch(() => { if (mounted) setError('Não foi possível carregar projetos e responsáveis disponíveis.'); });
    const dispose = window.eros.onEvent((event) => {
      if (event.type === 'task.updated') setRefresh((value) => value + 1);
    });
    return () => { mounted = false; dispose(); };
  }, []);

  const selectedAssignee = useMemo(() => {
    if (!assigneeFilter) return undefined;
    const [kind, id] = assigneeFilter.split(':', 2);
    if ((kind !== 'local' && kind !== 'dot') || !id) return undefined;
    return { kind, id } as UiTaskAssignee;
  }, [assigneeFilter]);

  async function loadTasks(cursor?: string, append = false) {
    setLoading(true);
    setError('');
    try {
      const page = await window.eros.tasks({
        ...(workspaceId ? { workspaceId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(mode === 'aggregate' && stateFilter ? { state: stateFilter } : {}),
        ...(mode === 'aggregate' && selectedAssignee ? { assignee: selectedAssignee } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      setTasks((current) => append ? [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))] : page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError('Não foi possível carregar as tarefas. Atualize os filtros e tente novamente.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadTasks(); }, [workspaceId, projectId, stateFilter, selectedAssignee, mode, refresh]);

  const boardProject = projects.find((project) => project.id === projectId);
  const visibleTasks = mode === 'project' && projectId
    ? tasks.filter((task) => task.projectId === projectId)
    : tasks;
  const orderedTasks = [...visibleTasks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  async function openTask(taskId: string) {
    setError('');
    try {
      const detail = await window.eros.task(taskId);
      setSelected(detail);
      setTitleDraft(detail.title);
      setDescriptionDraft(detail.description);
      setStateDraft(detail.state);
      setAssigneeKeys(detail.assignees.map((item) => `${item.kind}:${item.id}`));
      setEvents([]);
      setEventsCursor(null);
      setEventMore(true);
      const page = await window.eros.taskEvents(taskId);
      setEvents(page.items);
      setEventsCursor(page.nextCursor);
      setEventMore(page.nextCursor !== null);
    } catch { setError('Não foi possível abrir os detalhes e o histórico desta tarefa.'); }
  }

  async function moveTask(task: UiTaskSummary, nextState: UiTaskState) {
    if (task.state === nextState) return;
    setError('');
    try {
      const updated = await window.eros.updateTask({ taskId: task.id, state: nextState, expectedRevision: task.revision });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, state: updated.state, revision: updated.revision, updatedAt: updated.updatedAt } : item));
    } catch { setError(`A tarefa “${task.title}” mudou em outro cliente. O texto local foi preservado; reabra os detalhes para revisar.`); }
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving || byteLength(descriptionDraft) > 16000) return;
    setSaving(true);
    setError('');
    try {
      const updated = await window.eros.updateTask({
        taskId: selected.id,
        title: titleDraft,
        description: descriptionDraft,
        state: stateDraft,
        expectedRevision: selected.revision,
      });
      setSelected(updated);
      setTasks((current) => current.map((item) => item.id === updated.id ? { ...item, title: updated.title, state: updated.state, revision: updated.revision, updatedAt: updated.updatedAt } : item));
      const wanted = new Set(assigneeKeys);
      const assigned = new Set(updated.assignees.map((item) => `${item.kind}:${item.id}`));
      if ([...wanted].sort().join('|') !== [...assigned].sort().join('|')) {
        const nextAssignees: UiTaskAssignee[] = [...wanted].map((key) => {
          const split = key.indexOf(':');
          return { kind: key.slice(0, split) as 'local' | 'dot', id: key.slice(split + 1) };
        });
        const withAssignees = await window.eros.setTaskAssignees({ taskId: updated.id, assignees: nextAssignees, expectedRevision: updated.revision });
        setSelected(withAssignees);
        setTasks((current) => current.map((item) => item.id === withAssignees.id ? { ...item, assignees: withAssignees.assignees, revision: withAssignees.revision, updatedAt: withAssignees.updatedAt } : item));
      }
      const history = await window.eros.taskEvents(selected.id);
      setEvents(history.items);
      setEventsCursor(history.nextCursor);
      setEventMore(history.nextCursor !== null);
    } catch {
      setError('Conflito ao salvar. Seus campos locais foram mantidos; atualize somente depois de revisar a versão atual.');
    } finally { setSaving(false); }
  }

  async function changeRunLink(runId: string, link: boolean) {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = link
        ? await window.eros.linkTaskRun({ taskId: selected.id, runId, expectedRevision: selected.revision })
        : await window.eros.unlinkTaskRun({ taskId: selected.id, runId, expectedRevision: selected.revision });
      setSelected(updated);
      setTasks((current) => current.map((item) => item.id === updated.id ? { ...item, runCount: updated.runCount, revision: updated.revision, updatedAt: updated.updatedAt } : item));
      const history = await window.eros.taskEvents(selected.id);
      setEvents(history.items);
      setEventsCursor(history.nextCursor);
      setEventMore(history.nextCursor !== null);
    } catch { setError('O vínculo não foi alterado. Verifique projeto e revisão da tarefa.'); }
    finally { setSaving(false); }
  }

  async function loadNextEvents() {
    if (!selected || !eventsCursor) return;
    try {
      const page = await window.eros.taskEvents(selected.id, eventsCursor);
      setEvents((current) => [...current, ...page.items]);
      setEventsCursor(page.nextCursor);
      setEventMore(page.nextCursor !== null);
    } catch { setError('Não foi possível carregar a próxima página do histórico.'); }
  }

  const assigneeOptions = useMemo(() => {
    const values = new Map<string, { label: string; disabled?: boolean }>();
    values.set('local:local-user', { label: 'Você' });
    const project = projects.find((item) => item.id === selected?.projectId);
    for (const id of project?.dotIds ?? []) {
      const dot = dots.find((item) => item.id === id);
      values.set(`dot:${id}`, { label: dot?.name ?? id });
    }
    if (selected) for (const item of selected.assignees) {
      const key = `${item.kind}:${item.id}`;
      if (!values.has(key)) values.set(key, { label: `${item.name} · indisponível` });
    }
    return [...values.entries()];
  }, [projects, dots, selected]);

  const candidates = selected ? runs.filter((run) => run.projectId === selected.projectId && !selected.runs.some((item) => item.id === run.id)) : [];
  const projectsForFilter = projects.filter((project) => !workspaceId || project.workspaceId === workspaceId);

  return <section className="task-desk" aria-label="Tarefas Kanban">
    <header className="task-desk-heading">
      <div><div className="eyebrow">EROS / ORGANIZAÇÃO DO TRABALHO</div><h2>Tarefas</h2><p>Tarefas são acompanhamentos explícitos. Atribuir ou mover uma tarefa não inicia uma execução.</p></div>
      <div className="task-mode-actions">
        <button className={mode === 'aggregate' ? 'primary' : 'quiet'} aria-pressed={mode === 'aggregate'} onClick={() => setMode('aggregate')}>Visão agregada</button>
        <button className={mode === 'project' ? 'primary' : 'quiet'} aria-pressed={mode === 'project'} disabled={!projectId} onClick={() => setMode('project')}>Quadro do projeto</button>
        <button className="primary" onClick={() => { setCreateNonce(crypto.randomUUID()); setCreateOpen(true); }}>Nova tarefa</button>
      </div>
    </header>
    <div className="task-filters">
      <label>Workspace<select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setProjectId(''); setMode('aggregate'); }}><option value="">Todos</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      <label>Projeto<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Todos os projetos</option>{projectsForFilter.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Estado<select disabled={mode === 'project'} value={stateFilter} onChange={(event) => setStateFilter(event.target.value as UiTaskState | '')}><option value="">Todos</option>{states.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Responsável<select disabled={mode === 'project'} value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="">Todos</option><option value="local:local-user">Você</option>{dots.map((dot) => <option key={dot.id} value={`dot:${dot.id}`}>{dot.name}</option>)}</select></label>
    </div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {mode === 'project' && !projectId && <p className="task-empty">Selecione um projeto para abrir o quadro.</p>}
    {mode === 'project' && projectId && <div className="task-board" aria-label={`Quadro do projeto ${boardProject?.name ?? ''}`}>
      {states.map((status) => {
        const column = orderedTasks.filter((task) => task.state === status.value);
        return <section className="task-column" key={status.value} aria-label={`${status.label}, ${column.length} tarefas`}>
          <header><h3>{status.label}</h3><span>{column.length}{nextCursor ? '+' : ''}</span></header>
          {column.map((task) => <TaskCard key={task.id} task={task} onOpen={() => void openTask(task.id)} onMove={(state) => void moveTask(task, state)} />)}
          {!column.length && <p className="task-column-empty">Sem tarefas</p>}
        </section>;
      })}
    </div>}
    {mode === 'aggregate' && <section className="task-list" aria-label="Lista agregada de tarefas">
      <div className="task-list-heading"><strong>{tasks.length}{nextCursor ? '+' : ''} tarefas carregadas</strong>{loading && <span>Carregando…</span>}</div>
      {tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={() => void openTask(task.id)} onMove={(state) => void moveTask(task, state)} />)}
      {!loading && !tasks.length && <p className="task-empty">Nenhuma tarefa corresponde aos filtros.</p>}
      {nextCursor && <button className="quiet load-more" disabled={loading} onClick={() => void loadTasks(nextCursor, true)}>Carregar próxima página</button>}
    </section>}
    {mode === 'project' && nextCursor && <button className="quiet load-more" disabled={loading} onClick={() => void loadTasks(nextCursor, true)}>Carregar próxima página do quadro</button>}
    {mode === 'project' && loading && <p aria-live="polite">Carregando tarefas…</p>}

    <TaskCreationDialog key={createNonce} open={createOpen} projects={projects} dots={dots} fixedProjectId={mode === 'project' ? projectId || undefined : undefined} onClose={() => setCreateOpen(false)} onCreated={(task) => { setCreateOpen(false); setProjectId((value) => value || task.projectId); setMode('project'); setRefresh((value) => value + 1); }} />

    <TaskDetailsDialog
      task={selected}
      onOpenConversation={props.onOpenConversation}
      projects={projects}
      runs={runs}
      title={titleDraft}
      description={descriptionDraft}
      state={stateDraft}
      assigneeKeys={assigneeKeys}
      assigneeOptions={assigneeOptions}
      candidates={candidates}
      runCandidateId={runCandidateId}
      events={events}
      eventMore={eventMore}
      saving={saving}
      error={error}
      onClose={() => setSelected(undefined)}
      onTitle={setTitleDraft}
      onDescription={setDescriptionDraft}
      onState={setStateDraft}
      onAssignees={setAssigneeKeys}
      onRunCandidate={setRunCandidateId}
      onSave={(event) => void saveTask(event)}
      onLinkRun={() => { if (runCandidateId) void changeRunLink(runCandidateId, true); }}
      onUnlinkRun={(runId) => void changeRunLink(runId, false)}
      onLoadEvents={() => void loadNextEvents()}
    />
  </section>;
}

function TaskCard(props: { task: UiTaskSummary; onOpen(): void; onMove(state: UiTaskState): void }) {
  return <article className="task-card">
    <button className="task-card-open" onClick={props.onOpen} aria-label={`Abrir tarefa ${props.task.title}`}>
      <strong>{props.task.title}</strong>
      <span className="task-card-assignees">{props.task.assignees.length ? props.task.assignees.map((item) => `${item.name}${item.available ? '' : ' · indisponível'}`).join(', ') : 'Sem responsável'}</span>
      <span className="task-card-origin">{props.task.origin.workspaceName} / {props.task.origin.projectName}{props.task.origin.chatTitle ? ` · ${props.task.origin.chatTitle}` : ''}</span>
      <span className="task-card-links">{props.task.origin.chatId ? 'Conversa vinculada' : 'Sem conversa'} · {props.task.runCount} {props.task.runCount === 1 ? 'Run' : 'Runs'}</span>
    </button>
    <label className="task-state-control">Estado<select aria-label={`Mover ${props.task.title}`} value={props.task.state} onChange={(event) => props.onMove(event.target.value as UiTaskState)}>{states.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
  </article>;
}

function TaskDetailsDialog(props: {
  task?: UiTask; projects: UiWorkspaceProject[]; runs: UiRun[]; title: string; description: string; state: UiTaskState;
  assigneeKeys: string[]; assigneeOptions: [string, { label: string; disabled?: boolean }][]; candidates: UiRun[];
  runCandidateId: string; events: UiTaskEvent[]; eventMore: boolean; saving: boolean; error: string;
  onClose(): void; onOpenConversation(chatId: string): void; onTitle(value: string): void; onDescription(value: string): void; onState(value: UiTaskState): void;
  onAssignees(value: string[]): void; onRunCandidate(value: string): void; onSave(event: React.FormEvent): void;
  onLinkRun(): void; onUnlinkRun(id: string): void; onLoadEvents(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (props.task && !dialog.current?.open) dialog.current?.showModal();
    if (!props.task && dialog.current?.open) dialog.current?.close();
  }, [props.task?.id]);
  const project = props.projects.find((item) => item.id === props.task?.projectId);
  return <dialog ref={dialog} className="workspace-dialog task-details-dialog" aria-label="Detalhes da tarefa" onCancel={(event) => { event.preventDefault(); props.onClose(); }} onClick={(event) => { if (event.target === dialog.current) props.onClose(); }}>
    {props.task && <>
      <div className="workspace-dialog-heading"><h2>Detalhes da tarefa</h2><button type="button" className="icon-button" aria-label="Fechar" onClick={props.onClose}>×</button></div>
      <p className="task-project-context"><strong>Projeto:</strong> {props.task.origin.workspaceName} / {props.task.origin.projectName} · tarefa e projeto permanecem vinculados.</p>
      <form className="task-detail-form" onSubmit={props.onSave}>
          <label>Título<input maxLength={120} value={props.title} onChange={(event) => props.onTitle(event.target.value)} /></label>
        <label>Descrição<textarea maxLength={16000} value={props.description} onChange={(event) => props.onDescription(event.target.value)} /></label>
        <small className="task-byte-count">{byteLength(props.description)}/16.000 bytes UTF-8</small>
        <label>Estado da tarefa<select value={props.state} onChange={(event) => props.onState(event.target.value as UiTaskState)}>{states.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <fieldset className="grant-list"><legend>Responsáveis</legend>
          {props.assigneeOptions.map(([key, item]) => <label key={key}><input type="checkbox" disabled={item.disabled} checked={props.assigneeKeys.includes(key)} onChange={(event) => props.onAssignees(event.target.checked ? [...props.assigneeKeys, key] : props.assigneeKeys.filter((value) => value !== key))} />{item.label}</label>)}
          {!props.assigneeOptions.length && <small>Nenhum responsável está disponível.</small>}
        </fieldset>
        <p className="task-run-note">Estado da tarefa é independente do estado das Runs. Nenhuma alteração inicia ou modifica uma Run.</p>
        {props.error && <p className="workspace-error" role="alert">{props.error}</p>}
        <div className="dialog-actions"><button type="button" className="quiet" onClick={props.onClose}>Fechar</button><button className="primary" disabled={props.saving || !props.title.trim() || byteLength(props.description) > 16000}>{props.saving ? 'Salvando…' : 'Salvar alterações'}</button></div>
      </form>
      {props.task.origin.chatId && <div className="task-origin-actions"><p><strong>Conversa de origem:</strong> {props.task.origin.chatTitle ?? 'Conversa'}</p><button className="quiet" onClick={() => { const chatId = props.task?.origin.chatId; if (chatId) props.onOpenConversation(chatId); props.onClose(); }}>Abrir conversa</button></div>}
      {props.task.runs.length > 0 && <section className="task-related-runs"><h3>Runs relacionadas</h3>{props.task.runs.map((run) => <div key={run.id} className="task-run-row"><span><strong>{run.dotName ?? run.dotId}</strong> · estado da Run: {run.state} · {new Date(run.createdAt).toLocaleString()}</span><button className="quiet" disabled={props.saving} onClick={() => props.onUnlinkRun(run.id)}>Remover vínculo</button></div>)}</section>}
      <div className="task-run-link"><label>Associar Run existente deste projeto<select value={props.runCandidateId} onChange={(event) => props.onRunCandidate(event.target.value)}><option value="">Selecione uma Run</option>{props.candidates.map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.state} · {run.dotId}</option>)}</select></label><button className="quiet" disabled={!props.runCandidateId || props.saving} onClick={props.onLinkRun}>Associar Run</button>{props.runs.filter((run) => run.projectId !== props.task!.projectId).length > 0 && <small>Runs de outros projetos não podem ser vinculadas.</small>}</div>
      <section className="task-history"><h3>Histórico</h3>{props.events.map((event) => <article key={event.id}><time>{new Date(event.createdAt).toLocaleString()}</time><span>{eventLabel(event)}</span></article>)}{!props.events.length && <p>Sem alterações registradas.</p>}{props.eventMore && <button className="quiet" onClick={props.onLoadEvents}>Carregar próximo trecho do histórico</button>}</section>
    </>}
  </dialog>;
}

function eventLabel(event: UiTaskEvent) {
  switch (event.kind) {
    case 'task.created': return `Tarefa criada · estado ${stateLabel(event.metadata.state as UiTaskState)}`;
    case 'task.state_changed': return `Estado alterado de ${stateLabel(event.metadata.from as UiTaskState)} para ${stateLabel(event.metadata.to as UiTaskState)}`;
    case 'task.updated': return `Campos atualizados: ${event.metadata.fields ?? 'detalhes'}`;
    case 'task.assignees_changed': return `Responsáveis alterados${event.metadata.added ? ` · adicionados ${event.metadata.added}` : ''}${event.metadata.removed ? ` · removidos ${event.metadata.removed}` : ''}`;
    case 'task.run_linked': return `Run associada · ${event.metadata.runId ?? ''}`;
    case 'task.run_unlinked': return `Vínculo de Run removido · ${event.metadata.runId ?? ''}`;
  }
}

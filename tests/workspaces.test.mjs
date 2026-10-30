import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openDatabase, syncConfig } = require('../dist/daemon/database.cjs');
const { WorkspaceManager } = require('../dist/daemon/workspaces.cjs');

function makeRepo(parent, name) {
  const root = path.join(parent, name);
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('config', 'user.email', 'spec005@local.invalid');
  git('config', 'user.name', 'eros SPEC-005');
  fs.writeFileSync(path.join(root, 'initial.txt'), 'fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
  return root;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karont-spec005-'));
  const repo = makeRepo(root, 'config repo with spaces');
  const dbFile = path.join(root, 'eros.sqlite');
  let db = openDatabase(dbFile);
  fs.chmodSync(dbFile, 0o600);
  const workspaceId = db.prepare("SELECT value FROM settings WHERE key='default_workspace_id'").get().value;
  const configuredDots = [
    { id: 'allowed', name: 'Allowed', role: 'fixture', executable: process.execPath, args: [], projectIds: ['config-repo'], adapter: 'generic', autoResume: true },
    { id: 'ungranted', name: 'Ungrant', role: 'fixture', executable: process.execPath, args: [], projectIds: [], adapter: 'generic', autoResume: true },
  ];
  for (const dot of configuredDots)
    db.prepare('INSERT INTO dots(id,name,role,executable,args_json,project_ids_json,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(dot.id, dot.name, dot.role, dot.executable, '[]', JSON.stringify(dot.projectIds), Date.now());
  db.prepare("INSERT INTO projects(id,name,root,git_root,created_at,workspace_id,origin) VALUES('config-repo','Config repo',?,?,? ,?,'config')")
    .run(repo, repo, Date.now(), workspaceId);
  const manager = new WorkspaceManager(db, configuredDots);
  return {
    root, repo, workspaceId, dbFile, db, manager, configuredDots,
    close() {
      try { this.db.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  };
}

test('v4→v6 mantém dados de continuidade e cria workspace padrão com integridade referencial', () => {
  const f = fixture();
  try {
    const runId = randomUUID();
    f.db.prepare("INSERT INTO runs(id,dot_id,project_id,state,created_at,permission_mode) VALUES(?,?,?,'recovery_needed',?,'ask')")
      .run(runId, 'allowed', 'config-repo', Date.now());
    f.db.prepare('INSERT INTO run_events(run_id,type,created_at,metadata_json) VALUES(?,?,?,?)')
      .run(runId, 'run.recovery_needed', Date.now(), '{}');
    f.db.prepare("INSERT INTO sessions(id,run_id,pid,cols,rows,state,started_at,identity_json) VALUES(?,?,123,100,30,'recovery_needed',?,'{}')")
      .run(randomUUID(), runId, Date.now());
    f.db.prepare("INSERT INTO checkpoints(id,run_id,created_at,origin,state,snapshot_json) VALUES(?,?,?,'manual','recovery_needed','{}')")
      .run(randomUUID(), runId, Date.now());
    f.db.prepare("INSERT INTO approvals(id,run_id,status,created_at) VALUES(?,?,'pending',?)")
      .run(randomUUID(), runId, Date.now());
    f.db.prepare('INSERT INTO worktrees(run_id,path,branch,base_ref,created_at) VALUES(?,?,?,?,?)')
      .run(runId, path.join(f.root, 'existing-worktree'), 'eros/run-fixture', 'HEAD', Date.now());

    // Reconstruct the v4 table shape while keeping its established data.
    f.db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TRIGGER task_run_same_project_insert;
      DROP TRIGGER task_events_no_update;
      DROP TRIGGER task_events_no_delete;
      DROP TRIGGER task_origin_context_insert;
      DROP TRIGGER task_origin_context_update;
      DROP TABLE task_events;
      DROP TABLE task_run_links;
      DROP TABLE task_assignees;
      DROP TABLE tasks;
      DROP TRIGGER projects_require_workspace_insert;
      DROP TRIGGER projects_require_workspace_update;
      DROP TRIGGER runs_chat_context_insert;
      DROP TRIGGER runs_chat_context_update;
      DROP INDEX runs_chat_created;
      DROP INDEX projects_workspace_id;
      DROP INDEX projects_workspace_created;
      DROP TABLE message_deliveries;
      DROP TABLE messages;
      DROP TABLE chat_events;
      DROP TABLE chats;
      DROP TABLE project_dot_grants;
      DROP TABLE product_operations;
      DELETE FROM settings WHERE key='default_workspace_id';
      ALTER TABLE runs DROP COLUMN chat_id;
      ALTER TABLE projects DROP COLUMN icon;
      ALTER TABLE projects DROP COLUMN origin;
      ALTER TABLE projects DROP COLUMN workspace_id;
      DROP TABLE workspaces;
      PRAGMA user_version=4;
      COMMIT; PRAGMA foreign_keys=ON;`);
    f.db.close();
    const migrated = openDatabase(f.dbFile);
    f.db = migrated;
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(migrated.prepare('SELECT state FROM runs WHERE id=?').get(runId).state, 'recovery_needed');
    assert.equal(migrated.prepare('SELECT count(*) n FROM run_events WHERE run_id=?').get(runId).n, 1);
    assert.equal(migrated.prepare('SELECT count(*) n FROM sessions WHERE run_id=?').get(runId).n, 1);
    assert.equal(migrated.prepare('SELECT count(*) n FROM checkpoints WHERE run_id=?').get(runId).n, 1);
    assert.equal(migrated.prepare('SELECT count(*) n FROM approvals WHERE run_id=?').get(runId).n, 1);
    assert.equal(migrated.prepare('SELECT count(*) n FROM worktrees WHERE run_id=?').get(runId).n, 1);
    assert.equal(migrated.prepare('SELECT chat_id FROM runs WHERE id=?').get(runId).chat_id, null);
    assert.ok(migrated.prepare('SELECT workspace_id FROM projects WHERE id=?').get('config-repo').workspace_id);
    assert.equal(migrated.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='tasks'").get().n, 1);
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    try { f.db.close(); } catch {}
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('migração v5→v6 preserva workspaces, projetos, chats, mensagens e Runs existentes', () => {
  const f = fixture();
  try {
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: 'config-repo', dotId: 'allowed', title: 'Chat anterior', operationId: randomUUID() });
    const saved = f.manager.saveMessage(chat.chat.id, 'mensagem anterior preservada', chat.chat.revision, randomUUID());
    const runId = randomUUID();
    f.db.prepare("INSERT INTO runs(id,dot_id,project_id,state,created_at,permission_mode,chat_id) VALUES(?,?,?,'completed',?,'ask',?)")
      .run(runId, 'allowed', 'config-repo', Date.now(), chat.chat.id);
    f.db.exec(`
      DROP TRIGGER task_run_same_project_insert;
      DROP TRIGGER task_events_no_update;
      DROP TRIGGER task_events_no_delete;
      DROP TRIGGER task_origin_context_insert;
      DROP TRIGGER task_origin_context_update;
      DROP TABLE task_events;
      DROP TABLE task_run_links;
      DROP TABLE task_assignees;
      DROP TABLE tasks;
      ALTER TABLE projects DROP COLUMN icon;
      PRAGMA user_version=5;
    `);
    f.db.close();
    f.db = openDatabase(f.dbFile);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(f.db.prepare('SELECT name FROM workspaces WHERE id=?').get(f.workspaceId).name, 'Meus projetos');
    assert.equal(f.db.prepare('SELECT project_id FROM chats WHERE id=?').get(chat.chat.id).project_id, 'config-repo');
    assert.equal(f.db.prepare('SELECT body FROM messages WHERE id=?').get(saved.message.id).body, 'mensagem anterior preservada');
    assert.equal(f.db.prepare('SELECT chat_id FROM runs WHERE id=?').get(runId).chat_id, chat.chat.id);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('workspace, projeto UI e grants persistem sem ampliar acesso; raiz duplicada não é reassociada', () => {
  const f = fixture();
  try {
    const workspace = f.manager.createWorkspace('Pessoal', randomUUID());
    assert.equal(f.manager.renameWorkspace(workspace.id, 'Produto', randomUUID()).name, 'Produto');
    const uiRoot = makeRepo(f.root, 'ui repo with spaces');
    const input = { workspaceId: workspace.id, name: 'UI repo', root: uiRoot, dotIds: ['allowed'], operationId: randomUUID() };
    const added = f.manager.addProject(input);
    assert.equal(added.duplicate, false);
    assert.deepEqual(added.project.dotIds, ['allowed']);
    assert.equal(f.manager.addProject(input).project.id, added.project.id);
    assert.equal(f.manager.projectSummary(f.manager.projectRow(added.project.id)).origin, 'ui');
    assert.throws(() => f.manager.createChat({ workspaceId: workspace.id, projectId: added.project.id, dotId: 'ungranted', title: 'No grant', operationId: randomUUID() }), /Dot não autorizado/);

    const otherWorkspace = f.manager.createWorkspace('Outro', randomUUID());
    const duplicate = f.manager.addProject({ ...input, workspaceId: otherWorkspace.id, name: 'Outra raiz', operationId: randomUUID() });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.project.id, added.project.id);
    assert.equal(duplicate.project.workspaceId, workspace.id);
    assert.deepEqual(duplicate.project.dotIds, ['allowed']);
    const hidden = path.join(f.root, 'temporarily-missing');
    fs.renameSync(uiRoot, hidden);
    assert.equal(f.manager.projectSummary(f.manager.projectRow(added.project.id)).available, false);
    fs.renameSync(hidden, uiRoot);
    const configProjects = [{ id: 'config-repo', name: 'Config repo', root: f.repo, gitRoot: f.repo }];
    assert.throws(() => syncConfig(f.db, f.configuredDots, [...configProjects, { id: 'duplicate-root', name: 'Duplicado', root: uiRoot, gitRoot: uiRoot }]), /Repositório já cadastrado com ID diferente/);
    syncConfig(f.db, f.configuredDots, configProjects);
    f.db.close();
    f.db = openDatabase(f.dbFile);
    syncConfig(f.db, f.configuredDots, configProjects);
    f.manager = new WorkspaceManager(f.db, f.configuredDots);
    const afterRestart = f.manager.listProjects(workspace.id).items.find((item) => item.id === added.project.id);
    assert.equal(afterRestart.origin, 'ui');
    assert.equal(afterRestart.workspaceId, workspace.id);
    assert.deepEqual(afterRestart.dotIds, ['allowed']);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('conversas isolam rascunhos/mensagens, paginação é estável e replay não duplica', () => {
  const f = fixture();
  try {
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: 'config-repo', dotId: 'allowed', title: 'Primeira', operationId: randomUUID() });
    assert.equal(f.db.prepare('SELECT count(*) n FROM runs WHERE chat_id=?').get(chat.chat.id).n, 0);
    const draft = f.manager.setDraft(chat.chat.id, 'rascunho persistente', chat.chat.revision, randomUUID());
    assert.equal(draft.chat.draft, 'rascunho persistente');
    const operationId = randomUUID();
    let saved = f.manager.saveMessage(chat.chat.id, 'mensagem um', draft.chat.revision, operationId);
    assert.equal(saved.message.role, 'user');
    assert.equal(saved.chat.chat.draft, '');
    assert.deepEqual(f.manager.saveMessage(chat.chat.id, 'mensagem um', draft.chat.revision, operationId), saved);
    for (let index = 2; index <= 5; index++) {
      const current = f.manager.getChat(chat.chat.id);
      saved = f.manager.saveMessage(chat.chat.id, `mensagem ${index}`, current.chat.revision, randomUUID());
    }
    const first = f.manager.listMessages(chat.chat.id, undefined, 3);
    const second = f.manager.listMessages(chat.chat.id, first.nextCursor, 3);
    assert.deepEqual(first.items.map((item) => item.sequence), [1, 2, 3]);
    assert.deepEqual(second.items.map((item) => item.sequence), [4, 5]);
    assert.equal(second.nextCursor, null);
    assert.equal(f.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(chat.chat.id).n, 5);
    assert.throws(() => f.manager.saveMessage(chat.chat.id, 'é'.repeat(4001), saved.chat.chat.revision, randomUUID()), /8.000 bytes/);
    const other = f.manager.createChat({ workspaceId: f.workspaceId, title: 'Segunda', operationId: randomUUID() });
    f.manager.setDraft(other.chat.id, 'rascunho isolado', other.chat.revision, randomUUID());
    assert.equal(f.manager.getChat(chat.chat.id).chat.draft, '');
    assert.equal(f.manager.getChat(other.chat.id).chat.draft, 'rascunho isolado');
    const revision = f.manager.getChat(chat.chat.id).chat.revision;
    const favoriteOp = randomUUID();
    assert.equal(f.manager.favoriteChat(chat.chat.id, true, revision, favoriteOp).chat.favorite, true);
    assert.equal(f.manager.favoriteChat(chat.chat.id, true, revision, favoriteOp).chat.favorite, true);
    assert.equal(f.manager.listChats({ scope: 'favorites' }).items[0].id, chat.chat.id);
    const before = f.manager.getChat(chat.chat.id).chat.lastOpenedAt;
    f.manager.listChats({ scope: 'recent' });
    assert.equal(f.manager.getChat(chat.chat.id).chat.lastOpenedAt, before);
    f.manager.openChat(chat.chat.id, randomUUID());
    assert.ok(f.manager.getChat(chat.chat.id).chat.lastOpenedAt >= before);
    assert.equal(f.manager.getNavigation().chatId, chat.chat.id);
    f.db.close();
    f.db = openDatabase(f.dbFile);
    f.manager = new WorkspaceManager(f.db, f.configuredDots);
    assert.equal(f.manager.getChat(chat.chat.id).chat.favorite, true);
    assert.equal(f.manager.listMessages(chat.chat.id).items.length, 5);
    assert.equal(f.manager.getChat(other.chat.id).chat.draft, 'rascunho isolado');
    assert.equal(f.manager.getNavigation().chatId, chat.chat.id);
  } finally { f.close(); }
});

test('navegação restaura chats globais e de projeto e normaliza contextos removidos', () => {
  const f = fixture();
  try {
    const globalChat = f.manager.createChat({ workspaceId: null, projectId: null, title: 'Global', operationId: randomUUID() });
    const globalNavigation = { workspaceId: null, projectId: null, chatId: globalChat.chat.id };
    f.manager.setNavigation({ ...globalNavigation, operationId: randomUUID() });
    assert.deepEqual(f.manager.getNavigation(), globalNavigation);

    f.db.close();
    f.db = openDatabase(f.dbFile);
    f.manager = new WorkspaceManager(f.db, f.configuredDots);
    assert.deepEqual(f.manager.getNavigation(), globalNavigation);

    const projectChat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: 'config-repo', dotId: 'allowed', title: 'Projeto', operationId: randomUUID() });
    const projectNavigation = { workspaceId: f.workspaceId, projectId: 'config-repo', chatId: projectChat.chat.id };
    f.manager.setNavigation({ ...projectNavigation, operationId: randomUUID() });
    assert.deepEqual(f.manager.getNavigation(), projectNavigation);

    const fallback = { workspaceId: f.workspaceId, projectId: null, chatId: null };
    const invalidNavigations = [
      { workspaceId: 'removed-workspace', projectId: null, chatId: null },
      { workspaceId: f.workspaceId, projectId: 'removed-project', chatId: null },
      { workspaceId: null, projectId: null, chatId: randomUUID() },
    ];
    for (const invalidNavigation of invalidNavigations) {
      f.db.prepare("UPDATE settings SET value=? WHERE key='navigation'").run(JSON.stringify(invalidNavigation));
      assert.deepEqual(f.manager.getNavigation(), fallback);
    }
  } finally { f.close(); }
});

test('mensagens grandes paginam dentro do orçamento de frame sem omitir sequência', () => {
  const f = fixture();
  try {
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, title: 'Mensagens grandes', operationId: randomUUID() });
    let current = chat;
    for (let index = 0; index < 8; index++) {
      const saved = f.manager.saveMessage(chat.chat.id, `${index}:` + 'x'.repeat(7988), current.chat.revision, randomUUID());
      current = saved.chat;
    }
    const first = f.manager.listMessages(chat.chat.id, undefined, 100);
    const second = f.manager.listMessages(chat.chat.id, first.nextCursor, 100);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 60 * 1024);
    assert.equal(first.items.length + second.items.length, 8);
    assert.deepEqual([...first.items, ...second.items].map((message) => message.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(second.nextCursor, null);
  } finally { f.close(); }
});

test('tarefas validam origem e grants, registram histórico, preservam independência de Runs e paginam', () => {
  const f = fixture();
  try {
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: 'config-repo', dotId: 'allowed', title: 'Origem da tarefa', operationId: randomUUID() });
    const saved = f.manager.saveMessage(chat.chat.id, 'descrição inicial proveniente de mensagem', chat.chat.revision, randomUUID());
    assert.throws(() => f.manager.createTask({ projectId: 'config-repo', title: 'Sem permissão', assignees: [{ kind: 'dot', id: 'ungranted' }], operationId: randomUUID() }), /Dot não autorizado/);
    assert.throws(() => f.manager.createTask({ projectId: 'config-repo', title: 'Origem errada', originChatId: randomUUID(), operationId: randomUUID() }), /Conversa de origem/);
    assert.throws(() => f.manager.createTask({ projectId: 'config-repo', title: 'Mensagem sem chat', originMessageId: saved.message.id, operationId: randomUUID() }), /exige uma conversa/);
    assert.throws(() => f.manager.createTask({ projectId: 'config-repo', title: 'Descrição longa', description: 'é'.repeat(8001), operationId: randomUUID() }), /16.000 bytes/);

    const createOp = randomUUID();
    const input = {
      projectId: 'config-repo', title: 'Tarefa SPEC-006', description: saved.message.body, state: 'todo',
      assignees: [{ kind: 'local', id: 'local-user' }, { kind: 'dot', id: 'allowed' }],
      originChatId: chat.chat.id, originMessageId: saved.message.id, operationId: createOp,
    };
    const created = f.manager.createTask(input);
    assert.equal(created.description, saved.message.body);
    assert.equal(created.origin.chatId, chat.chat.id);
    assert.equal(created.origin.messageId, saved.message.id);
    assert.deepEqual(created.assignees.map((item) => item.id), ['allowed', 'local-user']);
    assert.deepEqual(f.manager.createTask(input), created);
    assert.equal(f.db.prepare('SELECT count(*) n FROM tasks WHERE id=?').get(created.id).n, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM task_events WHERE task_id=?').get(created.id).n, 1);
    assert.throws(() => f.manager.createTask({ ...input, title: 'Outro título' }), /reutilizada com conteúdo diferente/);

    const otherRepo = makeRepo(f.root, 'second task project');
    const other = f.manager.addProject({ workspaceId: f.workspaceId, name: 'Outro projeto', root: otherRepo, dotIds: ['allowed'], operationId: randomUUID() }).project;
    const secondWorkspace = f.manager.createWorkspace('Workspace isolado', randomUUID());
    const isolatedRepo = makeRepo(f.root, 'isolated workspace project');
    const isolatedProject = f.manager.addProject({ workspaceId: secondWorkspace.id, name: 'Projeto isolado', root: isolatedRepo, dotIds: ['allowed'], operationId: randomUUID() }).project;
    const isolatedTask = f.manager.createTask({ projectId: isolatedProject.id, title: 'Tarefa isolada', operationId: randomUUID() });
    const primaryWorkspaceTasks = f.manager.listTasks({ workspaceId: f.workspaceId, limit: 100 });
    const isolatedWorkspaceTasks = f.manager.listTasks({ workspaceId: secondWorkspace.id, limit: 100 });
    assert.ok(primaryWorkspaceTasks.items.some((item) => item.id === created.id));
    assert.ok(!primaryWorkspaceTasks.items.some((item) => item.id === isolatedTask.id));
    assert.deepEqual(isolatedWorkspaceTasks.items.map((item) => item.id), [isolatedTask.id]);
    const sameRunId = randomUUID();
    const otherRunId = randomUUID();
    const insertRun = f.db.prepare("INSERT INTO runs(id,dot_id,project_id,state,created_at,permission_mode) VALUES(?,?,?,'completed',?,'ask')");
    insertRun.run(sameRunId, 'allowed', 'config-repo', Date.now());
    insertRun.run(otherRunId, 'allowed', other.id, Date.now());
    assert.throws(() => f.manager.linkTaskRun({ taskId: created.id, runId: otherRunId, expectedRevision: created.revision, operationId: randomUUID() }, true), /mesmo projeto/);
    const linked = f.manager.linkTaskRun({ taskId: created.id, runId: sameRunId, expectedRevision: created.revision, operationId: randomUUID() }, true);
    assert.equal(linked.runs[0].state, 'completed');
    assert.equal(linked.state, 'todo');
    assert.equal(f.db.prepare('SELECT count(*) n FROM task_run_links WHERE task_id=? AND run_id=?').get(created.id, sameRunId).n, 1);

    const moved = f.manager.updateTask({ taskId: created.id, state: 'done', expectedRevision: linked.revision, operationId: randomUUID() });
    assert.equal(moved.state, 'done');
    const reopened = f.manager.updateTask({ taskId: created.id, state: 'todo', expectedRevision: moved.revision, operationId: randomUUID() });
    assert.equal(reopened.state, 'todo');
    assert.throws(() => f.manager.updateTask({ taskId: created.id, title: 'Stale', expectedRevision: created.revision, operationId: randomUUID() }), /mudou em outro cliente/);
    assert.deepEqual(f.manager.linkTaskRun({ taskId: created.id, runId: sameRunId, expectedRevision: reopened.revision, operationId: randomUUID() }, true).runs.length, 1);
    const unlinked = f.manager.linkTaskRun({ taskId: created.id, runId: sameRunId, expectedRevision: f.manager.getTask(created.id).revision, operationId: randomUUID() }, false);
    assert.equal(unlinked.runs.length, 0);
    assert.equal(f.db.prepare('SELECT state FROM runs WHERE id=?').get(sameRunId).state, 'completed');

    f.manager = new WorkspaceManager(f.db, [f.configuredDots[1]]);
    const unavailable = f.manager.getTask(created.id);
    assert.equal(unavailable.assignees.find((item) => item.id === 'allowed').available, false);
    const cleared = f.manager.setTaskAssignees({ taskId: created.id, assignees: [{ kind: 'local', id: 'local-user' }], expectedRevision: unavailable.revision, operationId: randomUUID() });
    assert.deepEqual(cleared.assignees.map((item) => item.id), ['local-user']);
    assert.throws(() => f.db.prepare('UPDATE task_events SET metadata_json=? WHERE task_id=?').run('{}', created.id), /append-only/);

    for (let index = 0; index < 105; index++)
      f.manager.createTask({ projectId: 'config-repo', title: `Página ${String(index).padStart(3, '0')}`, operationId: randomUUID() });
    const first = f.manager.listTasks({ projectId: 'config-repo', limit: 100 });
    const secondPage = f.manager.listTasks({ projectId: 'config-repo', cursor: first.nextCursor, limit: 100 });
    assert.equal(first.items.length, 100);
    assert.equal(secondPage.items.length, 6);
    assert.equal(secondPage.nextCursor, null);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 60 * 1024);
    const history = f.manager.listTaskEvents(created.id, undefined, 100);
    assert.ok(history.items.some((event) => event.kind === 'task.state_changed' && event.metadata.from === 'done' && event.metadata.to === 'todo'));
    assert.ok(history.items.some((event) => event.kind === 'task.run_linked'));
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('mover conversa livre exige preview/autorização/revisão e preserva identidade e histórico', () => {
  const f = fixture();
  try {
    const uiRoot = makeRepo(f.root, 'destination');
    const project = f.manager.addProject({ workspaceId: f.workspaceId, name: 'Destino', root: uiRoot, dotIds: ['allowed'], operationId: randomUUID() }).project;
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, title: 'Livre', dotId: null, operationId: randomUUID() });
    const withDraft = f.manager.setDraft(chat.chat.id, 'texto local', chat.chat.revision, randomUUID());
    const saved = f.manager.saveMessage(chat.chat.id, 'mensagem antiga', withDraft.chat.revision, randomUUID());
    const preview = f.manager.previewMove(chat.chat.id, project.id, 'allowed');
    assert.equal(preview.canMove, true);
    assert.equal(preview.dotId, 'allowed');
    assert.throws(() => f.manager.moveChat({ chatId: chat.chat.id, projectId: project.id, dotId: 'allowed', expectedRevision: preview.revision - 1, confirmed: true, operationId: randomUUID() }), /mudou em outro cliente/);
    const moveOperationId = randomUUID();
    const moved = f.manager.moveChat({ chatId: chat.chat.id, projectId: project.id, dotId: 'allowed', expectedRevision: preview.revision, confirmed: true, operationId: moveOperationId });
    assert.equal(moved.chat.id, chat.chat.id);
    assert.equal(moved.chat.projectId, project.id);
    assert.equal(moved.chat.dotId, 'allowed');
    assert.equal(f.manager.listMessages(chat.chat.id).items[0].id, saved.message.id);
    assert.equal(f.manager.listDeliveries(chat.chat.id, saved.message.id).length, 0);
    assert.equal(f.db.prepare("SELECT kind FROM chat_events WHERE chat_id=?").get(chat.chat.id).kind, 'chat.moved');
    assert.equal(f.manager.moveChat({ chatId: chat.chat.id, projectId: project.id, dotId: 'allowed', expectedRevision: preview.revision, confirmed: true, operationId: moveOperationId }).chat.projectId, project.id);
    const free = f.manager.createChat({ workspaceId: f.workspaceId, title: 'Bloqueada', operationId: randomUUID() });
    // Seed an impossible legacy row to exercise the move guard against corrupted history.
    f.db.exec('DROP TRIGGER runs_chat_context_insert');
    f.db.prepare("INSERT INTO runs(id,dot_id,project_id,chat_id,state,created_at,permission_mode) VALUES(?,'allowed',?,?,'running',?,'ask')")
      .run(randomUUID(), project.id, free.chat.id, Date.now());
    f.db.exec(`CREATE TRIGGER runs_chat_context_insert BEFORE INSERT ON runs
      WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.project_id=NEW.project_id AND c.dot_id=NEW.dot_id
      ) BEGIN SELECT RAISE(ABORT,'Execução diverge do contexto da conversa'); END`);
    assert.equal(f.manager.previewMove(free.chat.id, project.id, 'allowed').hasNonterminalRun, true);
  } finally { f.close(); }
});

test('entrega exige Run da conversa, não repete a mesma chave e retry incerto é explícito', () => {
  const f = fixture();
  try {
    const uiRoot = makeRepo(f.root, 'send-project');
    const project = f.manager.addProject({ workspaceId: f.workspaceId, name: 'Envio', root: uiRoot, dotIds: ['allowed'], operationId: randomUUID() }).project;
    const chat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: project.id, dotId: 'allowed', title: 'Envio', operationId: randomUUID() });
    const saved = f.manager.saveMessage(chat.chat.id, 'olá terminal', chat.chat.revision, randomUUID());
    const runId = randomUUID();
    f.db.prepare("INSERT INTO runs(id,dot_id,project_id,chat_id,state,created_at,permission_mode) VALUES(?,'allowed',?,?,'running',?,'ask')")
      .run(runId, project.id, chat.chat.id, Date.now());
    const writes = [];
    const send = { chatId: chat.chat.id, messageId: saved.message.id, runId, reviewedUncertain: false, operationId: randomUUID() };
    const sent = f.manager.sendMessage(send, () => true, (_id, data) => writes.push(data));
    assert.equal(sent.status, 'sent');
    assert.equal(f.manager.listMessages(chat.chat.id).deliveries.find((delivery) => delivery.messageId === saved.message.id).status, 'sent');
    f.manager.sendMessage(send, () => true, (_id, data) => writes.push(data));
    assert.equal(writes.length, 1);
    assert.match(writes[0], /\x1b\[200~olá terminal\x1b\[201~\r/);
    const otherChat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: project.id, dotId: 'allowed', title: 'Outra', operationId: randomUUID() });
    const otherMessage = f.manager.saveMessage(otherChat.chat.id, 'não enviar', otherChat.chat.revision, randomUUID());
    assert.throws(() => f.manager.sendMessage({ ...send, chatId: otherChat.chat.id, messageId: otherMessage.message.id, operationId: randomUUID() }, () => true, () => {}), /Execução não pertence a esta conversa/);

    const secondMessage = f.manager.saveMessage(chat.chat.id, 'revisão explícita', saved.chat.chat.revision, randomUUID());
    const failed = { chatId: chat.chat.id, messageId: secondMessage.message.id, runId, reviewedUncertain: false, operationId: randomUUID() };
    assert.equal(f.manager.sendMessage(failed, () => true, () => { throw Error('terminal closed'); }).status, 'uncertain');
    assert.throws(() => f.manager.sendMessage({ ...failed, operationId: randomUUID() }, () => true, () => {}), /Entrega incerta/);
    const retry = { ...failed, reviewedUncertain: true, operationId: randomUUID() };
    assert.equal(f.manager.sendMessage(retry, () => true, (_id, data) => writes.push(data)).status, 'sent');
    assert.equal(f.manager.sendMessage(retry, () => true, (_id, data) => writes.push(data)).status, 'sent');
    assert.equal(f.manager.listMessages(chat.chat.id).deliveries.find((delivery) => delivery.messageId === secondMessage.message.id).status, 'sent');
    assert.equal(writes.length, 2);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});


function deliveryFixture() {
  const f = fixture();
  const chat = f.manager.createChat({ workspaceId: f.workspaceId, projectId: 'config-repo', dotId: 'allowed', title: 'Delivery fixture', operationId: randomUUID() });
  const saved = f.manager.saveMessage(chat.chat.id, 'synthetic input', chat.chat.revision, randomUUID());
  const runId = randomUUID();
  f.db.prepare("INSERT INTO runs(id,dot_id,project_id,chat_id,state,created_at,permission_mode) VALUES(?,'allowed','config-repo',?,'running',?,'ask')")
    .run(runId, chat.chat.id, Date.now());
  return Object.assign(f, { send: { chatId: chat.chat.id, messageId: saved.message.id, runId, reviewedUncertain: false, operationId: randomUUID() } });
}

for (const clockChange of [0, -1000]) {
  test(`entrega: ordem das tentativas independe de UUID e relógio (${clockChange})`, (t) => {
    const f = deliveryFixture();
    try {
      let clock = 1800000000000;
      t.mock.method(Date, 'now', () => clock);
      const first = { ...f.send, operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
      const retry = { ...f.send, reviewedUncertain: true, operationId: '00000000-0000-4000-8000-000000000000' };
      let writes = 0;
      const states = [];
      let intentStatus;
      f.manager.onEvent((event) => {
        if (event.type === 'message.delivery.updated') states.push(event.status);
      });
      assert.equal(f.manager.sendMessage(first, () => true, () => {
        writes++;
        intentStatus = f.db.prepare('SELECT status FROM message_deliveries WHERE operation_id=?').get(first.operationId).status;
        throw Error('synthetic write exception');
      }).status, 'uncertain');
      assert.equal(intentStatus, 'pending');
      clock += clockChange;
      assert.equal(f.manager.sendMessage(retry, () => true, () => { writes++; }).status, 'sent');
      assert.equal(f.manager.listMessages(f.send.chatId).deliveries[0].status, 'sent');
      assert.deepEqual(f.manager.listDeliveries(f.send.chatId, f.send.messageId).map((d) => d.operationId), [first.operationId, retry.operationId]);
      assert.equal(f.manager.sendMessage(retry, () => false, () => { writes++; }).status, 'sent');
      assert.equal(f.manager.sendMessage(first, () => true, () => { writes++; }).status, 'uncertain');
      assert.throws(() => f.manager.sendMessage({ ...retry, operationId: randomUUID() }, () => true, () => { writes++; }), /já foi enviada/);
      assert.equal(writes, 2);
      assert.deepEqual(states, ['pending', 'uncertain', 'pending', 'sent']);
      f.db.exec('VACUUM');
      f.db.close();
      f.db = openDatabase(f.dbFile);
      f.manager = new WorkspaceManager(f.db, f.configuredDots);
      assert.equal(f.manager.listMessages(f.send.chatId).deliveries[0].status, 'sent');
      assert.throws(() => f.manager.sendMessage({ ...retry, operationId: randomUUID() }, () => true, () => { writes++; }), /já foi enviada/);
      assert.equal(writes, 2);
    } finally { f.close(); }
  });
}

test('entrega: exceção e queda após intenção sobrevivem à reabertura sem reenvio', () => {
  for (const crash of [false, true]) {
    const f = deliveryFixture();
    try {
      if (crash) {
        // A separate process exits inside the write callback, after the durable intent.
        // No terminal or provider is involved and no production failure flag is needed.
        f.db.close();
        const child = spawnSync(process.execPath, ['-e', `
          const {openDatabase}=require('./dist/daemon/database.cjs');
          const {WorkspaceManager}=require('./dist/daemon/workspaces.cjs');
          const db=openDatabase(process.argv[1]);
          new WorkspaceManager(db,[]).sendMessage(JSON.parse(process.argv[2]),()=>true,()=>process.exit(23));
        `, f.dbFile, JSON.stringify(f.send)], { stdio: 'ignore', timeout: 5000 });
        assert.equal(child.status, 23);
        f.db = openDatabase(f.dbFile);
        assert.equal(f.db.prepare('SELECT status FROM message_deliveries').get().status, 'pending');
      } else {
        assert.equal(f.manager.sendMessage(f.send, () => true, () => { throw Error('synthetic ambiguous write'); }).status, 'uncertain');
        f.db.close();
        f.db = openDatabase(f.dbFile);
      }
      f.manager = new WorkspaceManager(f.db, f.configuredDots);
      assert.equal(f.manager.listMessages(f.send.chatId).deliveries[0].status, 'uncertain');
      let writes = 0;
      assert.equal(f.manager.sendMessage(f.send, () => true, () => { writes++; }).status, 'uncertain');
      assert.throws(() => f.manager.sendMessage({ ...f.send, operationId: randomUUID() }, () => true, () => { writes++; }), /Entrega incerta/);
      assert.equal(writes, 0);
      f.db.close();
      f.db = openDatabase(f.dbFile);
      f.manager = new WorkspaceManager(f.db, f.configuredDots);
      assert.equal(f.manager.sendMessage(f.send, () => true, () => { writes++; }).status, 'uncertain');
      assert.equal(writes, 0);
    } finally { f.close(); }
  }
});

test('entrega: Run encerrada antes da validação não escreve; encerramento durante escrita é incerto', () => {
  const f = deliveryFixture();
  try {
    let writes = 0;
    assert.throws(() => f.manager.sendMessage(f.send, () => false, () => { writes++; }), /não está ativo/);
    f.db.prepare("UPDATE runs SET state='cancelled' WHERE id=?").run(f.send.runId);
    assert.throws(() => f.manager.sendMessage(f.send, () => true, () => { writes++; }), /não está ativo/);
    assert.equal(f.manager.listDeliveries(f.send.chatId, f.send.messageId).length, 0);
    assert.equal(writes, 0);
    f.db.prepare("UPDATE runs SET state='running' WHERE id=?").run(f.send.runId);
    assert.equal(f.manager.sendMessage(f.send, () => true, () => {
      writes++;
      f.db.prepare("UPDATE runs SET state='cancelled' WHERE id=?").run(f.send.runId);
      throw Error('synthetic closed terminal');
    }).status, 'uncertain');
    assert.equal(f.manager.sendMessage(f.send, () => false, () => { writes++; }).status, 'uncertain');
    assert.equal(writes, 1);
  } finally { f.close(); }
});

test('entrega: limpar uma fixture preserva a outra e remove ambos os diretórios', () => {
  const first = deliveryFixture();
  const second = deliveryFixture();
  try {
    assert.notEqual(first.root, second.root);
    first.close();
    assert.equal(fs.existsSync(first.root), false);
    let writes = 0;
    assert.equal(second.manager.sendMessage(second.send, () => true, () => { writes++; }).status, 'sent');
    assert.equal(writes, 1);
  } finally {
    if (fs.existsSync(first.root)) first.close();
    second.close();
  }
  assert.equal(fs.existsSync(second.root), false);
});

test('redesign: projeto mantém ícone e chat abre sem Dot ou concessão implícita', () => {
  const f = fixture();
  try {
    const root = makeRepo(f.root, 'novo projeto');
    const operationId = randomUUID();
    const input = { workspaceId: f.workspaceId, name: 'Novo', root, icon: 'rocket', dotIds: [], operationId };
    const created = f.manager.addProject(input);
    assert.equal(created.project.icon, 'rocket');
    assert.deepEqual(created.project.dotIds, []);
    assert.equal(f.manager.addProject(input).project.id, created.project.id);
    const chat = f.manager.createChat({ projectId: created.project.id, title: 'Nova conversa', operationId: randomUUID() });
    assert.equal(chat.chat.dotId, null);
    assert.equal(chat.chat.workspaceId, f.workspaceId);
    assert.equal(f.manager.listChatRuns(chat.chat.id).items.length, 0);
    const updated = f.manager.updateProject({ projectId: created.project.id, name: 'Renomeado', root, icon: 'code-xml', operationId: randomUUID() });
    assert.equal(updated.name, 'Renomeado');
    assert.equal(updated.icon, 'code-xml');
    assert.deepEqual(updated.dotIds, []);
    f.db.close(); f.db = openDatabase(f.dbFile);
    const manager = new WorkspaceManager(f.db, f.configuredDots);
    assert.equal(manager.listProjects(f.workspaceId).items.find((p) => p.id === updated.id).icon, 'code-xml');
    assert.equal(manager.getChat(chat.chat.id).chat.dotId, null);
  } finally { f.close(); }
});

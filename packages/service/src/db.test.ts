import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  addCustomAgent,
  addMessage,
  busyConversationCwds,
  createConversation,
  createProject,
  createRestorePoint,
  createWorktreeRecord,
  deleteRestorePoints,
  getAgentSession,
  getConversation,
  getErrorDismissedMessageId,
  getRestorePoint,
  getSetting,
  getWorktree,
  listConversations,
  listCustomAgents,
  listExcessRestorePoints,
  listMessages,
  listMessagesPage,
  listProjects,
  listRecentFolderRecords,
  listRestorePoints,
  listWorkspaces,
  markRestorePointsConcurrent,
  markWorktreeMerged,
  migrations,
  openDatabase,
  recordRecentFolder,
  removeCustomAgent,
  removeProject,
  setAgentSession,
  setConversationTitle,
  setErrorDismissedMessageId,
  setRestorePointAfter,
  setRestorePointUndoCommit,
  setRestorePointUndone,
  setSetting,
  updateProject,
} from "./db.ts";

test("listMessagesPage retorna as mensagens recentes e caminha para trás sem pular empates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-message-pages-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const conversation = createConversation(db, {
    agent: "claude",
    title: "Histórico paginado",
    cwd: root,
    mode: "edit",
  });
  const sameTimestamp = new Date(Date.UTC(2026, 0, 1)).toISOString();
  const messages = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({
    id,
    conversationId: conversation.id,
    author: "user" as const,
    status: "done" as const,
    parts: [],
    createdAt: sameTimestamp,
    updatedAt: sameTimestamp,
  }));
  for (const message of messages) addMessage(db, message);

  try {
    const latest = listMessagesPage(db, conversation.id, { limit: 3 });
    assert.deepEqual(
      latest.messages.map((message) => message.id),
      ["m3", "m4", "m5"],
    );
    assert.equal(latest.hasOlderMessages, true);

    const older = listMessagesPage(db, conversation.id, {
      limit: 3,
      before: latest.messages[0]?.id,
    });
    assert.deepEqual(
      older.messages.map((message) => message.id),
      ["m1", "m2"],
    );
    assert.equal(older.hasOlderMessages, false);
  } finally {
    db.close();
  }
});

test("migra settings e pastas recentes, persiste user_version e permite reabrir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  let db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    21,
  );
  assert.equal(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("recent_folders") as { name: string } | undefined
    )?.name,
    "recent_folders",
  );
  const messageColumns = new Set(
    (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  assert.ok(messageColumns.has("started_at_ms"));
  assert.ok(messageColumns.has("ended_at_ms"));
  assert.ok(messageColumns.has("attachments_json"));
  assert.ok(messageColumns.has("agent_turn_id"));
  const conversationColumns = new Set(
    (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  assert.ok(conversationColumns.has("pinned_at"));
  assert.ok(conversationColumns.has("archived_at"));
  assert.ok(conversationColumns.has("unread_at"));
  assert.ok(conversationColumns.has("branched_from_id"));
  assert.ok(conversationColumns.has("branched_from_message_id"));
  assert.ok(conversationColumns.has("branch_context_pending"));
  assert.ok(conversationColumns.has("fast"));
  assert.equal(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("conversation_context_usage") as { name: string } | undefined
    )?.name,
    "conversation_context_usage",
  );
  setSetting(db, "appearance.theme", { mode: "dark", enabled: true });
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  db.close();

  db = openDatabase(dbPath);
  assert.deepEqual(getSetting(db, "appearance.theme"), { mode: "dark", enabled: true });
  db.close();
});

test("migrações 2 e 3 aplicam sobre a versão 1", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  const versionOneDb = new DatabaseSync(dbPath);
  versionOneDb.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT; PRAGMA user_version = 1;",
  );
  versionOneDb.close();

  const db = openDatabase(dbPath);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    21,
  );
  assert.deepEqual(listCustomAgents(db), []);
  db.close();
});

test("migra conversas antigas sem perder preferências existentes nem mensagens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-legacy-conversations-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 6)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,model,effort,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "legacy-1",
      "claude",
      "Conversa antiga",
      "/tmp/projeto",
      "read-only",
      "haiku",
      "low",
      "idle",
      "2026-10-31T10:00:00.000Z",
      "2026-10-31T10:01:00.000Z",
    );
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "message-1",
      "legacy-1",
      "user",
      "done",
      JSON.stringify([{ id: "part-1", type: "text", markdown: "Mensagem preservada" }]),
      "2026-10-31T10:00:30.000Z",
      "2026-10-31T10:00:30.000Z",
    );
  legacyDb.close();

  const db = openDatabase(dbPath);
  const conversation = getConversation(db, "legacy-1");
  assert.deepEqual(
    {
      agent: conversation?.agent,
      title: conversation?.title,
      cwd: conversation?.cwd,
      mode: conversation?.mode,
      model: conversation?.model,
      effort: conversation?.effort,
      plan: conversation?.plan,
      fast: conversation?.fast,
      pinnedAt: conversation?.pinnedAt,
      archivedAt: conversation?.archivedAt,
      unreadAt: conversation?.unreadAt,
    },
    {
      agent: "claude",
      title: "Conversa antiga",
      cwd: "/tmp/projeto",
      mode: "read-only",
      model: "haiku",
      effort: "low",
      plan: false,
      fast: false,
      pinnedAt: null,
      archivedAt: null,
      unreadAt: null,
    },
  );
  const legacyMessages = listMessages(db, "legacy-1");
  const legacyPart = legacyMessages[0]?.parts[0];
  assert.equal(legacyPart?.type, "text");
  assert.equal(
    legacyPart?.type === "text" ? legacyPart.markdown : undefined,
    "Mensagem preservada",
  );

  const planned = createConversation(db, {
    agent: "codex",
    title: "Nova planejada",
    cwd: "/tmp",
    mode: "edit",
    plan: true,
    fast: true,
  });
  const defaulted = createConversation(db, {
    agent: "claude",
    title: "Nova padrão",
    cwd: "/tmp",
    mode: "edit",
  });
  assert.equal(getConversation(db, planned.id)?.plan, true);
  assert.equal(getConversation(db, planned.id)?.fast, true);
  assert.equal(defaulted.plan, false);
  assert.equal(defaulted.fast, false);
  const untitled = createConversation(db, {
    agent: "claude",
    title: "Nova conversa",
    cwd: "/tmp",
    mode: "edit",
  });
  const generated = setConversationTitle(
    db,
    untitled.id,
    "Título criado pelo agente",
    "2026-10-31T10:02:00.000Z",
    false,
  );
  assert.equal(generated?.title, "Título criado pelo agente");
  setConversationTitle(
    db,
    untitled.id,
    "Título escolhido pela pessoa",
    "2026-10-31T10:03:00.000Z",
    true,
  );
  assert.equal(
    setConversationTitle(
      db,
      untitled.id,
      "Outro título automático",
      "2026-10-31T10:04:00.000Z",
      false,
    ),
    null,
  );
  assert.equal(getConversation(db, untitled.id)?.title, "Título escolhido pela pessoa");
  db.close();
});

test("conversas arquivadas e fixadas filtram e ordenam sem mudar a ordem recente", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-conversation-list-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const create = (title: string) =>
    createConversation(db, { agent: "claude", title, cwd: root, mode: "edit" });
  const recent = create("Recente");
  const older = create("Antiga");
  const pinnedOlder = create("Fixada antiga");
  const pinnedNewer = create("Fixada nova");
  const archived = create("Arquivada");
  const earlier = "2026-10-01T10:00:00.000Z";
  const later = "2026-10-02T10:00:00.000Z";
  db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(
    "2026-10-31T10:00:00.000Z",
    recent.id,
  );
  db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(
    "2026-10-31T09:00:00.000Z",
    older.id,
  );
  db.prepare("UPDATE conversations SET pinned_at=? WHERE id=?").run(earlier, pinnedOlder.id);
  db.prepare("UPDATE conversations SET pinned_at=? WHERE id=?").run(later, pinnedNewer.id);
  db.prepare("UPDATE conversations SET archived_at=? WHERE id=?").run(later, archived.id);

  const active = listConversations(db, { limit: 20 });
  assert.deepEqual(
    active.map((conversation) => conversation.id),
    [pinnedNewer.id, pinnedOlder.id, recent.id, older.id],
  );
  assert.equal(active[0]?.pinnedAt, later);
  assert.equal(active[0]?.archivedAt, null);
  assert.deepEqual(
    listConversations(db, { archived: true, limit: 20 }).map((conversation) => conversation.id),
    [archived.id],
  );
  db.close();
});

test("CLIs personalizadas são armazenadas, listadas e removidas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const first = addCustomAgent(db, { name: "Primeira", command: "first-cli" });
  const second = addCustomAgent(db, { name: "Segunda", command: "/opt/second-cli" });
  assert.match(first.id, /^custom-[0-9a-f-]{36}$/);
  assert.deepEqual(listCustomAgents(db), [first, second]);
  assert.equal(removeCustomAgent(db, first.id), true);
  assert.equal(removeCustomAgent(db, first.id), false);
  assert.deepEqual(listCustomAgents(db), [second]);
  db.close();
});

test("pastas recentes mantêm somente as 50 mais novas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const db = openDatabase(path.join(root, "karont.db"));
  for (let index = 0; index < 55; index += 1) {
    recordRecentFolder(db, {
      path: path.join(root, `projeto-${index}`),
      usedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
  }
  const folders = listRecentFolderRecords(db);
  assert.equal(folders.length, 50);
  assert.equal(folders[0]?.path.endsWith("projeto-54"), true);
  assert.equal(folders.at(-1)?.path.endsWith("projeto-5"), true);
  assert.equal(
    folders.some((folder) => folder.path.endsWith("projeto-4")),
    false,
  );
  db.close();
});

test("recusa banco criado por versão mais nova", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-"));
  const dbPath = path.join(root, "karont.db");
  const db = openDatabase(dbPath);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => openDatabase(dbPath), /versão mais nova do Karont/);
});

test("migra um banco na versão 13 mantendo a conversa solta, sem projectId", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v13-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 13)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "v13-1",
      "claude",
      "Antes dos projetos",
      "/tmp/projeto",
      "edit",
      "idle",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
    );
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    const conversation = getConversation(db, "v13-1");
    assert.equal(conversation?.title, "Antes dos projetos");
    assert.equal("projectId" in (conversation ?? {}), false);
    assert.deepEqual(listProjectsForTest(db), []);
  } finally {
    db.close();
  }
});

function listProjectsForTest(db: DatabaseSync): unknown[] {
  return db.prepare("SELECT * FROM projects").all();
}

test("CRUD de projetos: path único, atualização sem mudar a pasta e remoção solta as conversas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-projects-db-"));
  const db = openDatabase(path.join(root, "karont.db"));
  try {
    const beta = createProject(db, { name: "beta", icon: "folder", path: "/tmp/beta" });
    const alpha = createProject(db, {
      name: "Alfa",
      icon: "code",
      path: "/tmp/alfa",
      defaultAgent: "codex",
    });
    assert.equal(beta.defaultAgent, null);
    assert.throws(() => createProject(db, { name: "x", icon: "x", path: "/tmp/beta" }));
    assert.deepEqual(
      listProjects(db).map((project) => project.name),
      ["Alfa", "beta"],
    );

    const updated = updateProject(db, alpha.id, { name: "Alfa 2", defaultAgent: null });
    assert.equal(updated?.name, "Alfa 2");
    assert.equal(updated?.icon, "code");
    assert.equal(updated?.defaultAgent, null);
    assert.equal(updated?.path, "/tmp/alfa");
    assert.equal(updateProject(db, "nao-existe", { name: "x" }), null);

    const conversation = createConversation(db, {
      agent: "claude",
      title: "Dentro",
      cwd: "/tmp/alfa",
      mode: "edit",
      projectId: alpha.id,
    });
    assert.equal(getConversation(db, conversation.id)?.projectId, alpha.id);
    addMessage(db, {
      id: "m1",
      conversationId: conversation.id,
      author: "user",
      status: "done",
      parts: [],
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
    });
    setAgentSession(db, conversation.id, "sessao-1");

    assert.equal(removeProject(db, alpha.id), true);
    assert.equal(removeProject(db, alpha.id), false);
    const loose = getConversation(db, conversation.id);
    assert.ok(loose);
    assert.equal("projectId" in loose, false);
    assert.equal(listMessages(db, conversation.id).length, 1);
    assert.equal(getAgentSession(db, conversation.id), "sessao-1");
  } finally {
    db.close();
  }
});

test("migra um banco na versão 14 sem perder dados e cria restore_points", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v14-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 14)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "v14-1",
      "claude",
      "Antes",
      "/tmp/p",
      "edit",
      "idle",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
    );
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "m-1",
      "v14-1",
      "user",
      "done",
      "[]",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
    );
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    assert.equal(getConversation(db, "v14-1")?.title, "Antes");
    assert.equal(listMessages(db, "v14-1").length, 1);
    assert.deepEqual(listRestorePoints(db, "v14-1"), []);
  } finally {
    db.close();
  }
});

test("migra um banco na versão 15 sem perder dados e acrescenta as colunas do desfazer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v15-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 15)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  const stamp = "2026-11-01T10:00:00.000Z";
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("v15-1", "claude", "Antes", "/tmp/p", "edit", "idle", stamp, stamp);
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("m-15", "v15-1", "agent", "done", "[]", stamp, stamp);
  legacyDb
    .prepare(
      `INSERT INTO restore_points
        (message_id,conversation_id,repo_root,before_commit,after_commit,head_before,head_after,concurrent,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run("m-15", "v15-1", "/repo", "antes", "depois", "h1", "h2", 1, stamp, stamp);
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    const point = getRestorePoint(db, "m-15");
    assert.equal(point?.beforeCommit, "antes");
    assert.equal(point?.afterCommit, "depois");
    assert.equal(point?.concurrent, true);
    assert.equal(point?.changedFiles, 0);
    assert.equal(point?.undoneAt, null);
    assert.equal(point?.undoCommit, null);
  } finally {
    db.close();
  }
});

test("migra um banco na versão 16 sem perder dados e cria worktrees e conversations.worktree_id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v16-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 16)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  const stamp = "2026-11-01T10:00:00.000Z";
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("v16-1", "claude", "Antes", "/tmp/p", "edit", "idle", stamp, stamp);
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("m-16", "v16-1", "agent", "done", "[]", stamp, stamp);
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    const before = getConversation(db, "v16-1");
    assert.equal(before?.title, "Antes");
    assert.equal(before?.worktreeId, undefined);
    assert.equal(listMessages(db, "v16-1").length, 1);

    const project = createProject(db, {
      name: "P",
      icon: "folder",
      path: "/tmp/p",
      defaultAgent: null,
    });
    const worktree = createWorktreeRecord(db, {
      projectId: project.id,
      repoRoot: "/tmp/p",
      path: "/tmp/data/worktrees/p-abcdef",
      branch: "karont/p-abcdef",
      baseCommit: "abc",
    });
    const linked = createConversation(db, {
      agent: "claude",
      title: "Na cópia",
      cwd: worktree.path,
      mode: "edit",
      worktreeId: worktree.id,
    });
    assert.equal(getConversation(db, linked.id)?.worktreeId, worktree.id);
    // Remover a cópia deixa a conversa sem vínculo; remover o projeto deixa a cópia sem projeto.
    db.prepare("DELETE FROM worktrees WHERE id=?").run(worktree.id);
    assert.equal(getConversation(db, linked.id)?.worktreeId, undefined);
    assert.equal(getWorktree(db, worktree.id), null);
    const second = createWorktreeRecord(db, {
      projectId: project.id,
      repoRoot: "/tmp/p",
      path: "/tmp/data/worktrees/p-123456",
      branch: "karont/p-123456",
      baseCommit: "abc",
    });
    // Trazer: grava merged_at; conversas ocupadas aparecem por pasta.
    assert.equal(second.mergedAt, null);
    const merged = markWorktreeMerged(db, second.id);
    assert.notEqual(merged?.mergedAt, null);
    assert.equal(getWorktree(db, second.id)?.mergedAt, merged?.mergedAt);
    assert.equal(markWorktreeMerged(db, "nao-existe"), null);
    const busy = createConversation(db, {
      agent: "claude",
      title: "o",
      cwd: "/tmp/p/sub",
      mode: "edit",
    });
    assert.deepEqual(busyConversationCwds(db), []);
    db.prepare("UPDATE conversations SET state='waiting' WHERE id=?").run(busy.id);
    assert.deepEqual(busyConversationCwds(db), ["/tmp/p/sub"]);
    db.prepare("UPDATE conversations SET state='idle' WHERE id=?").run(busy.id);
    removeProject(db, project.id);
    assert.equal(getWorktree(db, second.id)?.projectId, null);
    assert.throws(() =>
      createWorktreeRecord(db, {
        projectId: null,
        repoRoot: "/tmp/p",
        path: second.path,
        branch: "x",
        baseCommit: "abc",
      }),
    );
  } finally {
    db.close();
  }
});

test("restore_points: cria, atualiza o depois, marca concorrência, lista excedentes e apaga em cascata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-rp-"));
  const db = openDatabase(path.join(root, "karont.db"));
  try {
    const conversation = createConversation(db, {
      agent: "claude",
      title: "Pontos",
      cwd: "/tmp/p",
      mode: "edit",
    });
    const ids = ["m1", "m2", "m3"];
    for (const [index, id] of ids.entries()) {
      const now = `2026-11-01T10:00:0${index}.000Z`;
      addMessage(db, {
        id,
        conversationId: conversation.id,
        author: "agent",
        status: "done",
        parts: [],
        createdAt: now,
        updatedAt: now,
      });
      createRestorePoint(db, {
        messageId: id,
        conversationId: conversation.id,
        repoRoot: id === "m3" ? null : "/repo",
        beforeCommit: id === "m3" ? null : `before-${id}`,
        headBefore: null,
        unavailableReason: id === "m3" ? "no-git" : null,
        now,
      });
    }
    assert.equal(getRestorePoint(db, "m1")?.concurrent, false);
    assert.equal(getRestorePoint(db, "m3")?.unavailableReason, "no-git");
    assert.equal(
      setRestorePointAfter(db, "m1", "after-m1", "head", "2026-11-01T11:00:00.000Z"),
      true,
    );
    assert.equal(setRestorePointAfter(db, "nada", "x", null, "2026-11-01T11:00:00.000Z"), false);
    assert.equal(getRestorePoint(db, "m1")?.afterCommit, "after-m1");
    assert.equal(getRestorePoint(db, "m1")?.changedFiles, 0);
    assert.equal(getRestorePoint(db, "m1")?.undoneAt, null);
    assert.equal(
      setRestorePointAfter(db, "m2", "after-m2", null, "2026-11-01T11:00:00.000Z", 7),
      true,
    );
    assert.equal(getRestorePoint(db, "m2")?.changedFiles, 7);
    assert.equal(setRestorePointUndoCommit(db, "m2", "undo-m2", "2026-11-01T12:00:00.000Z"), true);
    assert.equal(setRestorePointUndone(db, "m2", "2026-11-01T12:01:00.000Z"), true);
    assert.equal(setRestorePointUndone(db, "nada", "2026-11-01T12:01:00.000Z"), false);
    assert.equal(getRestorePoint(db, "m2")?.undoCommit, "undo-m2");
    assert.equal(getRestorePoint(db, "m2")?.undoneAt, "2026-11-01T12:01:00.000Z");
    markRestorePointsConcurrent(db, ["m1", "m2"], "2026-11-01T11:00:00.000Z");
    assert.deepEqual(
      listRestorePoints(db, conversation.id).map((point) => [point.messageId, point.concurrent]),
      [
        ["m1", true],
        ["m2", true],
        ["m3", false],
      ],
    );
    assert.deepEqual(
      listExcessRestorePoints(db, conversation.id, 1).map((point) => point.messageId),
      ["m1", "m2"],
    );
    assert.deepEqual(listExcessRestorePoints(db, conversation.id, 3), []);
    deleteRestorePoints(db, ["m1"]);
    assert.equal(getRestorePoint(db, "m1"), null);
    db.prepare("DELETE FROM conversations WHERE id=?").run(conversation.id);
    assert.deepEqual(listRestorePoints(db, conversation.id), []);
  } finally {
    db.close();
  }
});

test("migra um banco na versão 17 com dados para workspaces, sem perder nada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v17-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 17)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  const stamp = "2026-11-01T10:00:00.000Z";
  legacyDb
    .prepare(
      "INSERT INTO projects (id,name,icon,path,default_agent,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("p17", "App", "folder", "/tmp/p17", null, stamp, stamp);
  const insertConversation = legacyDb.prepare(
    "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at,project_id) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  insertConversation.run(
    "c17-solta",
    "claude",
    "Solta",
    "/tmp",
    "edit",
    "idle",
    stamp,
    stamp,
    null,
  );
  insertConversation.run(
    "c17-proj",
    "codex",
    "No projeto",
    "/tmp/p17",
    "edit",
    "idle",
    stamp,
    stamp,
    "p17",
  );
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("m-17", "c17-solta", "agent", "done", "[]", stamp, stamp);
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    const workspaces = listWorkspaces(db);
    assert.equal(workspaces.length, 1);
    const pessoal = workspaces[0];
    assert.equal(pessoal?.name, "Pessoal");
    assert.equal(pessoal?.icon, "folder");
    assert.equal(pessoal?.position, 0);
    assert.equal(getConversation(db, "c17-solta")?.workspaceId, pessoal?.id);
    assert.equal(getConversation(db, "c17-proj")?.workspaceId, pessoal?.id);
    assert.equal(getConversation(db, "c17-proj")?.projectId, "p17");
    assert.equal(listProjects(db)[0]?.workspaceId, pessoal?.id);
    assert.equal(listMessages(db, "c17-solta").length, 1);
    const nulls = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM projects WHERE workspace_id IS NULL) + (SELECT COUNT(*) FROM conversations WHERE workspace_id IS NULL) AS n",
      )
      .get() as { n: number };
    assert.equal(nulls.n, 0);
    // Coisas novas caem no workspace padrão.
    assert.equal(
      createConversation(db, { agent: "claude", title: "Nova", cwd: "/tmp", mode: "edit" })
        .workspaceId,
      pessoal?.id,
    );
  } finally {
    db.close();
  }
});

test("migra um banco na versão 18 com dados: acrescenta error_dismissed_message_id sem perder nada", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v18-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 18)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  const stamp = "2026-11-01T10:00:00.000Z";
  const workspaceId = (legacyDb.prepare("SELECT id FROM workspaces").get() as { id: string }).id;
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run("c18", "claude", "Com erro", "/tmp", "edit", "error", stamp, stamp, workspaceId);
  legacyDb
    .prepare(
      "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("m18", "c18", "agent", "error", "[]", stamp, stamp);
  legacyDb.close();

  const db = openDatabase(dbPath);
  try {
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      21,
    );
    const conversation = getConversation(db, "c18");
    assert.equal(conversation?.title, "Com erro");
    assert.equal(conversation?.state, "error");
    assert.equal(listMessages(db, "c18").length, 1);
    // Conversa antiga: nenhum erro dispensado ainda.
    assert.equal(getErrorDismissedMessageId(db, "c18"), null);
    setErrorDismissedMessageId(db, "c18", "m18");
    assert.equal(getErrorDismissedMessageId(db, "c18"), "m18");
    // Conversa nova também começa sem erro dispensado.
    const created = createConversation(db, {
      agent: "claude",
      title: "Nova",
      cwd: "/tmp",
      mode: "edit",
    });
    assert.equal(getErrorDismissedMessageId(db, created.id), null);
  } finally {
    db.close();
  }
});

function legacyV20(dbPath: string): DatabaseSync {
  const legacyDb = new DatabaseSync(dbPath);
  for (const migration of migrations.filter((entry) => entry.version <= 20)) {
    legacyDb.exec(migration.up);
    legacyDb.exec(`PRAGMA user_version = ${migration.version}`);
  }
  return legacyDb;
}

function expectCompletedAt(db: DatabaseSync): void {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'onboarding.completedAt'")
    .get() as { value: string };
  const parsed = JSON.parse(row.value) as unknown;
  assert.equal(typeof parsed, "string");
  assert.equal(new Date(parsed as string).toISOString(), parsed);
  assert.equal(getSetting(db, "onboarding.completedAt"), parsed);
}

test("migração 21: banco novo fica sem onboarding.completedAt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v21-"));
  const db = openDatabase(path.join(root, "karont.db"));
  try {
    assert.equal(getSetting(db, "onboarding.completedAt"), null);
  } finally {
    db.close();
  }
});

test("migração 21: banco na versão 20 com conversa ganha onboarding.completedAt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v21-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = legacyV20(dbPath);
  const stamp = "2026-11-01T10:00:00.000Z";
  const workspaceId = (legacyDb.prepare("SELECT id FROM workspaces").get() as { id: string }).id;
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run("c20", "claude", "Antiga", "/tmp", "edit", "idle", stamp, stamp, workspaceId);
  legacyDb.close();
  const db = openDatabase(dbPath);
  try {
    expectCompletedAt(db);
  } finally {
    db.close();
  }
});

test("migração 21: banco na versão 20 com projeto ganha onboarding.completedAt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v21-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = legacyV20(dbPath);
  const workspaceId = (legacyDb.prepare("SELECT id FROM workspaces").get() as { id: string }).id;
  legacyDb
    .prepare(
      "INSERT INTO projects (id,name,icon,path,created_at,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "p20",
      "Projeto",
      "folder",
      "/tmp/p20",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
      workspaceId,
    );
  legacyDb.close();
  const db = openDatabase(dbPath);
  try {
    expectCompletedAt(db);
  } finally {
    db.close();
  }
});

test("migração 21: banco na versão 20 vazio não ganha a chave", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v21-"));
  const dbPath = path.join(root, "karont.db");
  legacyV20(dbPath).close();
  const db = openDatabase(dbPath);
  try {
    assert.equal(getSetting(db, "onboarding.completedAt"), null);
  } finally {
    db.close();
  }
});

test("migração 21: valor já existente não é sobrescrito", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ks-v21-"));
  const dbPath = path.join(root, "karont.db");
  const legacyDb = legacyV20(dbPath);
  const stamp = "2026-11-01T10:00:00.000Z";
  const workspaceId = (legacyDb.prepare("SELECT id FROM workspaces").get() as { id: string }).id;
  legacyDb
    .prepare(
      "INSERT INTO conversations (id,agent,title,cwd,mode,state,created_at,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run("c20", "claude", "Antiga", "/tmp", "edit", "idle", stamp, stamp, workspaceId);
  legacyDb
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)")
    .run("onboarding.completedAt", JSON.stringify("2020-01-01T00:00:00.000Z"), stamp);
  legacyDb.close();
  const db = openDatabase(dbPath);
  try {
    assert.equal(getSetting(db, "onboarding.completedAt"), "2020-01-01T00:00:00.000Z");
  } finally {
    db.close();
  }
});

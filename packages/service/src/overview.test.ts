import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AnyEvent, type OverviewWorkspace, parseRequest } from "@karont/contract";
import { createConversation, createProject, createWorkspace, openDatabase } from "./db.ts";
import { createHandlers } from "./handlers.ts";

const SINCE = "2026-11-09T03:00:00.000Z";

async function setup(context: { after(fn: () => void | Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "karont-overview-"));
  const db = openDatabase(path.join(root, "karont.db"));
  const handlers = createHandlers({
    db,
    startedAt: new Date().toISOString(),
    dev: false,
    emit: async () => undefined,
    broadcast: async (_event: AnyEvent) => undefined,
    env: { PATH: "" },
    homeDir: root,
  });
  context.after(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const chat = (workspaceId: string, projectId?: string) =>
    createConversation(db, {
      agent: "claude",
      title: "Chat",
      cwd: root,
      mode: "edit",
      workspaceId,
      ...(projectId ? { projectId } : {}),
    });
  const set = (
    id: string,
    patch: { state?: string; updated?: string; archived?: string; touched?: string },
  ) => {
    if (patch.state) db.prepare("UPDATE conversations SET state=? WHERE id=?").run(patch.state, id);
    if (patch.updated)
      db.prepare(
        "INSERT INTO messages (id,conversation_id,author,status,parts,created_at,updated_at) VALUES (?,?,'user','done','[]',?,?)",
      ).run(`m-${id}-${patch.updated}`, id, patch.updated, patch.updated);
    if (patch.touched)
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(patch.touched, id);
    if (patch.archived)
      db.prepare("UPDATE conversations SET archived_at=? WHERE id=?").run(patch.archived, id);
  };
  const get = async (since: string = SINCE) => {
    const parsed = parseRequest({
      type: "request",
      id: "1",
      method: "overview.get",
      params: { since },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const out = (await handlers.handle(parsed.request, {
      emit: async () => undefined,
      afterResponse: () => undefined,
      isOpen: () => true,
    })) as { workspaces: OverviewWorkspace[] };
    return out.workspaces;
  };
  return { root, db, chat, set, get };
}

test("overview.get: workspace e projeto vazios aparecem com zeros", async (context) => {
  const { db, get } = await setup(context);
  const extra = createWorkspace(db, { name: "Vazio", icon: "folder" });
  createProject(db, { name: "P", icon: "folder", path: "/tmp/p-vazio", workspaceId: extra.id });
  const all = await get();
  assert.equal(all.length, 2);
  const empty = all.find((item) => item.workspaceId === extra.id);
  assert.ok(empty);
  assert.deepEqual(
    { ...empty, projects: undefined },
    {
      workspaceId: extra.id,
      conversations: 0,
      activeToday: 0,
      working: 0,
      queued: 0,
      waiting: 0,
      error: 0,
      lastActivityAt: null,
      projects: undefined,
    },
  );
  assert.equal(empty.projects.length, 1);
  assert.deepEqual(empty.projects[0], {
    projectId: empty.projects[0]?.projectId,
    conversations: 0,
    working: 0,
    waiting: 0,
    lastActivityAt: null,
  });
});

test("overview.get: soltas e de projeto somam, arquivadas ficam fora, estados e última atividade", async (context) => {
  const { db, chat, set, get } = await setup(context);
  const other = createWorkspace(db, { name: "Outro", icon: "folder" });
  const [first] = await get();
  assert.ok(first);
  const wsId = first.workspaceId;
  const project = createProject(db, {
    name: "A",
    icon: "folder",
    path: "/tmp/p-a",
    workspaceId: wsId,
  });
  const idle = chat(wsId);
  const solta = chat(wsId);
  const working = chat(wsId, project.id);
  const waiting = chat(wsId, project.id);
  const queued = chat(wsId, project.id);
  const failed = chat(wsId, project.id);
  const archived = chat(wsId, project.id);
  const foreign = chat(other.id);
  set(idle.id, { updated: "2026-11-08T10:00:00.000Z" });
  set(solta.id, { state: "error", updated: "2026-11-09T05:00:00.000Z" });
  set(working.id, { state: "working", updated: "2026-11-09T06:00:00.000Z" });
  set(waiting.id, { state: "waiting", updated: "2026-11-08T23:00:00.000Z" });
  set(queued.id, { state: "queued", updated: "2026-11-09T04:00:00.000Z" });
  set(failed.id, { state: "error", updated: "2026-11-08T22:00:00.000Z" });
  set(archived.id, {
    state: "working",
    updated: "2026-11-09T09:00:00.000Z",
    archived: "2026-11-09T09:00:00.000Z",
  });
  // fixada hoje (updated_at novo), mas a última mensagem é antiga: não é ativa
  set(idle.id, { touched: "2026-11-09T07:00:00.000Z" });
  chat(wsId); // sem mensagens: conta, mas não é ativa nem dá lastActivityAt
  set(foreign.id, { updated: "2026-11-09T08:00:00.000Z" });

  const all = await get();
  const w = all.find((item) => item.workspaceId === wsId);
  assert.ok(w);
  assert.equal(w.conversations, 7);
  assert.equal(w.activeToday, 3);
  assert.equal(w.working, 1);
  assert.equal(w.queued, 1);
  assert.equal(w.waiting, 1);
  assert.equal(w.error, 2);
  assert.equal(w.lastActivityAt, "2026-11-09T06:00:00.000Z");
  assert.deepEqual(w.projects, [
    {
      projectId: project.id,
      conversations: 4,
      working: 1,
      waiting: 1,
      lastActivityAt: "2026-11-09T06:00:00.000Z",
    },
  ]);
  const o = all.find((item) => item.workspaceId === other.id);
  assert.equal(o?.conversations, 1);
  assert.equal(o?.lastActivityAt, "2026-11-09T08:00:00.000Z");
});

test("overview.get: activeToday inclui o limite exato de since e exclui o anterior", async (context) => {
  const { db, chat, set, get } = await setup(context);
  const [first] = await get();
  assert.ok(first);
  const wsId = first.workspaceId;
  void db;
  set(chat(wsId).id, { updated: SINCE });
  set(chat(wsId).id, { updated: "2026-11-09T02:59:59.999Z" });
  assert.equal((await get())[0]?.activeToday, 1);
  // since com deslocamento equivale ao mesmo instante
  assert.equal((await get("2026-11-09T00:00:00-03:00"))[0]?.activeToday, 1);
});

test("overview.get: since inválido é recusado", () => {
  for (const since of ["", "ontem", "2026-11-09", undefined]) {
    const parsed = parseRequest({
      type: "request",
      id: "1",
      method: "overview.get",
      params: { since },
    });
    assert.equal(parsed.ok, false);
  }
  assert.equal(
    parseRequest({ type: "request", id: "1", method: "overview.get", params: {} }).ok,
    false,
  );
});

import type { DatabaseSync } from "node:sqlite";
import type { OverviewProject, OverviewWorkspace } from "@karont/contract";
import { listProjects, listWorkspaces } from "./db.ts";

type GroupRow = {
  workspace_id: string;
  project_id: string | null;
  total: number;
  active_today: number;
  working: number;
  queued: number;
  waiting: number;
  error: number;
  last_activity: string | null;
};

function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Números das telas de Início e do workspace. O estado salvo no banco é sempre o atual:
 * o `ConversationManager` grava `state` de forma síncrona em cada mudança.
 * Atividade vem da última mensagem de cada conversa (`messages.created_at`), não de
 * `conversations.updated_at`, que muda ao renomear, fixar, trocar modelo ou recuperar no reinício.
 * Conversa sem mensagem conta em `conversations`, mas não é ativa nem dá `lastActivityAt`.
 * Terminais e conversas arquivadas ficam de fora.
 */
export function getOverview(db: DatabaseSync, since: string): { workspaces: OverviewWorkspace[] } {
  // As datas do banco são `toISOString()` (UTC, com ms); normaliza `since` para comparar texto com texto.
  const sinceUtc = new Date(since).toISOString();
  const rows = db
    .prepare(
      `WITH last AS (
        SELECT c.workspace_id, c.project_id, c.state,
          (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message
        FROM conversations c
        WHERE c.archived_at IS NULL
      )
      SELECT workspace_id, project_id,
        COUNT(*) AS total,
        SUM(CASE WHEN last_message >= ? THEN 1 ELSE 0 END) AS active_today,
        SUM(CASE WHEN state = 'working' THEN 1 ELSE 0 END) AS working,
        SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN state = 'waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN state = 'error' THEN 1 ELSE 0 END) AS error,
        MAX(last_message) AS last_activity
      FROM last
      GROUP BY workspace_id, project_id`,
    )
    .all(sinceUtc) as GroupRow[];

  const workspaces = new Map<string, OverviewWorkspace>();
  const projects = new Map<string, OverviewProject>();
  for (const workspace of listWorkspaces(db)) {
    workspaces.set(workspace.id, {
      workspaceId: workspace.id,
      conversations: 0,
      activeToday: 0,
      working: 0,
      queued: 0,
      waiting: 0,
      error: 0,
      lastActivityAt: null,
      projects: [],
    });
  }
  for (const project of listProjects(db)) {
    const item: OverviewProject = {
      projectId: project.id,
      conversations: 0,
      working: 0,
      waiting: 0,
      lastActivityAt: null,
    };
    projects.set(project.id, item);
    workspaces.get(project.workspaceId)?.projects.push(item);
  }

  for (const row of rows) {
    const workspace = workspaces.get(row.workspace_id);
    if (!workspace) continue;
    workspace.conversations += row.total;
    workspace.activeToday += row.active_today;
    workspace.working += row.working;
    workspace.queued += row.queued;
    workspace.waiting += row.waiting;
    workspace.error += row.error;
    workspace.lastActivityAt = maxIso(workspace.lastActivityAt, row.last_activity);
    const project = row.project_id ? projects.get(row.project_id) : undefined;
    if (project) {
      project.conversations += row.total;
      project.working += row.working;
      project.waiting += row.waiting;
      project.lastActivityAt = maxIso(project.lastActivityAt, row.last_activity);
    }
  }
  return { workspaces: [...workspaces.values()] };
}

import type { DatabaseSync } from "node:sqlite";
import type { Workspace } from "@karont/contract";
import {
  createWorkspace,
  defaultWorkspaceId,
  getProject,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  reorderWorkspaces,
  updateWorkspace,
} from "./db.ts";
import { ServiceError } from "./errors.ts";

export const DEFAULT_WORKSPACE_ICON = "folder";

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ServiceError("invalid_request", "O nome do workspace não pode ficar vazio.");
  }
  if (trimmed.length > 80) {
    throw new ServiceError("invalid_request", "O nome do workspace tem no máximo 80 caracteres.");
  }
  return trimmed;
}

export function createWorkspaceChecked(
  db: DatabaseSync,
  params: { name: string; icon?: string },
): Workspace {
  return createWorkspace(db, {
    name: cleanName(params.name),
    icon: params.icon ?? DEFAULT_WORKSPACE_ICON,
  });
}

export function updateWorkspaceChecked(
  db: DatabaseSync,
  params: { id: string; name?: string; icon?: string },
): Workspace {
  const { id, name, icon } = params;
  const workspace = updateWorkspace(db, id, {
    ...(name !== undefined ? { name: cleanName(name) } : {}),
    ...(icon !== undefined ? { icon } : {}),
  });
  if (!workspace) throw new ServiceError("invalid_request", "O workspace não existe.");
  return workspace;
}

/** Devolve o id do workspace que recebeu o conteúdo. */
export function removeWorkspaceChecked(db: DatabaseSync, id: string): string {
  const result = removeWorkspace(db, id);
  if (result === false) throw new ServiceError("invalid_request", "O workspace não existe.");
  if (result === null) {
    throw new ServiceError("invalid_request", "Não dá para apagar o último workspace.");
  }
  return result;
}

export function reorderWorkspacesChecked(db: DatabaseSync, ids: string[]): Workspace[] {
  const current = listWorkspaces(db);
  const known = new Set(current.map((workspace) => workspace.id));
  if (
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !known.has(id))
  ) {
    throw new ServiceError(
      "invalid_request",
      "A nova ordem precisa conter todos os workspaces, cada um uma vez.",
    );
  }
  reorderWorkspaces(db, ids);
  return listWorkspaces(db);
}

/**
 * Workspace de algo novo (conversa, projeto, terminal): o do projeto, se houver;
 * senão o pedido; senão o de menor `position`. Projeto ou workspace inexistente
 * é `invalid_request`.
 */
export function resolveWorkspaceId(
  db: DatabaseSync,
  params: { projectId?: string | undefined; workspaceId?: string | undefined },
): string {
  if (params.workspaceId && !getWorkspace(db, params.workspaceId)) {
    throw new ServiceError("invalid_request", "O workspace não existe.");
  }
  if (params.projectId) {
    const project = getProject(db, params.projectId);
    if (!project) throw new ServiceError("invalid_request", "O projeto não existe.");
    return project.workspaceId;
  }
  return params.workspaceId ?? defaultWorkspaceId(db);
}

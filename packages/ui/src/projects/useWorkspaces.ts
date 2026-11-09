import type { Workspace } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import {
  ACTIVE_WORKSPACE_SETTING,
  pickActiveWorkspaceId,
  sortWorkspaces,
} from "./workspaceState.ts";

type Snapshot = {
  workspaces: Workspace[];
  /** Sempre existe um ativo depois de carregar, salvo se não houver nenhum workspace. */
  activeId: string | null;
  loading: boolean;
  error: boolean;
};

let workspaces: Workspace[] = [];
let preferredId: string | null = null;
let listLoaded = false;
let settingLoaded = false;
let error = false;
/** O usuário já escolheu um workspace: o valor salvo que chegar depois não vale mais. */
let chosenByUser = false;
let snapshot: Snapshot = { workspaces, activeId: null, loading: true, error: false };
const listeners = new Set<() => void>();
let connected = false;
/** Sobe a cada mudança local ou evento; uma resposta de `workspaces.list` mais velha é descartada. */
let version = 0;

function publish() {
  const ready = listLoaded && settingLoaded;
  snapshot = {
    workspaces,
    activeId: ready ? pickActiveWorkspaceId(workspaces, preferredId) : null,
    loading: !ready,
    error,
  };
  for (const listener of listeners) listener();
}

function replaceWorkspaces(next: Workspace[]) {
  version += 1;
  workspaces = sortWorkspaces(next);
  listLoaded = true;
  error = false;
  publish();
}

function connect() {
  if (connected) return;
  connected = true;
  const bridge = getBridge();
  if (!bridge) {
    listLoaded = true;
    settingLoaded = true;
    publish();
    return;
  }
  bridge.onEvent((event) => {
    if (event.event === "workspaces.changed") replaceWorkspaces(event.payload.workspaces);
  });
  const requestedAt = version;
  void bridge
    .request("workspaces.list", {})
    .then((result) => {
      if (version !== requestedAt) return;
      replaceWorkspaces(result.workspaces);
    })
    .catch(() => {
      if (version !== requestedAt) return;
      listLoaded = true;
      error = true;
      publish();
    });
  void bridge
    .request("settings.get", { key: ACTIVE_WORKSPACE_SETTING })
    .then(({ value }) => {
      if (!chosenByUser && typeof value === "string") preferredId = value;
    })
    .catch(() => {
      // Sem o valor salvo, vale o primeiro workspace.
    })
    .finally(() => {
      settingLoaded = true;
      publish();
    });
}

export function subscribeWorkspaces(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaces(): Snapshot {
  return useSyncExternalStore(
    subscribeWorkspaces,
    () => snapshot,
    () => snapshot,
  );
}

export function getWorkspaces(): Workspace[] {
  return snapshot.workspaces;
}

/** Id do workspace ativo agora, para quem cria algo (conversa, terminal, projeto) sem ser um hook. */
export function getActiveWorkspaceId(): string | null {
  return snapshot.activeId;
}

/** Ativa o workspace e guarda a escolha. Id desconhecido é ignorado. */
export function setActiveWorkspace(id: string) {
  if (!workspaces.some((workspace) => workspace.id === id)) return;
  chosenByUser = true;
  preferredId = id;
  publish();
  void getBridge()
    ?.request("settings.set", { key: ACTIVE_WORKSPACE_SETTING, value: id })
    .catch(() => {
      // A escolha vale nesta sessão; só não volta igual na próxima abertura.
    });
}

/** Usado logo depois de criar ou renomear, para a tela não esperar o evento chegar. */
export function upsertWorkspace(workspace: Workspace) {
  replaceWorkspaces([...workspaces.filter((item) => item.id !== workspace.id), workspace]);
}

/** Usado logo depois de apagar. O ativo apagado cai no primeiro que sobrar: o de destino. */
export function removeWorkspaceFromStore(id: string) {
  replaceWorkspaces(workspaces.filter((workspace) => workspace.id !== id));
}

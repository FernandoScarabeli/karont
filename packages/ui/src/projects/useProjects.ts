import type { Project } from "@karont/contract";
import { useSyncExternalStore } from "react";
import { getBridge } from "../bridge/index.ts";
import { pruneRemovedProjects } from "../conversation/useConversationIndex.ts";

type Snapshot = { projects: Project[]; loading: boolean; error: boolean };

let snapshot: Snapshot = { projects: [], loading: true, error: false };
const listeners = new Set<() => void>();
let connected = false;
/** Sobe a cada mudança local ou evento; uma resposta de `projects.list` mais velha é descartada. */
let version = 0;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function replaceProjects(projects: Project[]) {
  version += 1;
  publish({ projects, loading: false, error: false });
  pruneRemovedProjects(new Set(projects.map((project) => project.id)));
}

function loadProjects() {
  const bridge = getBridge();
  if (!bridge) {
    publish({ projects: [], loading: false, error: false });
    return;
  }
  const requestedAt = version;
  void bridge
    .request("projects.list", {})
    .then((result) => {
      if (version !== requestedAt) return;
      replaceProjects(result.projects);
    })
    .catch(() => {
      if (version !== requestedAt) return;
      publish({ ...snapshot, loading: false, error: true });
    });
}

function connect() {
  if (connected) return;
  connected = true;
  const bridge = getBridge();
  if (!bridge) {
    publish({ projects: [], loading: false, error: false });
    return;
  }
  bridge.onEvent((event) => {
    if (event.event === "projects.changed") replaceProjects(event.payload.projects);
  });
  loadProjects();
}

export function subscribeProjects(listener: () => void) {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

export function useProjects(): Snapshot {
  return useSyncExternalStore(
    subscribeProjects,
    () => snapshot,
    () => snapshot,
  );
}

export function getProject(id: string | undefined): Project | undefined {
  return id ? snapshot.projects.find((project) => project.id === id) : undefined;
}

/** Usado logo depois de criar ou editar, para a tela não esperar o evento chegar. */
export function upsertProject(project: Project) {
  const projects = snapshot.projects.filter((item) => item.id !== project.id);
  projects.push(project);
  projects.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  version += 1;
  publish({ projects, loading: false, error: false });
}

/** Usado logo depois de remover. Tira o `projectId` das conversas locais. */
export function removeProjectFromStore(id: string) {
  replaceProjects(snapshot.projects.filter((project) => project.id !== id));
}

export function useProject(id: string | undefined): {
  project: Project | undefined;
  loading: boolean;
} {
  const state = useProjects();
  return {
    project: id ? state.projects.find((project) => project.id === id) : undefined,
    loading: state.loading,
  };
}

import { useEffect, useRef } from "react";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import { LOCAL_WORKSPACE_KEY } from "../projects/workspaceState.ts";
import { SettingsView } from "../settings/SettingsView.tsx";
import { WorkspacePanels } from "../workspace/WorkspacePanels.tsx";
import styles from "./Sheet.module.css";

export function Sheet() {
  const { view, activeWorkspaceId } = useNavigation();
  const { workspaces, loading } = useWorkspaces();
  /** Workspaces já visitados ficam montados (escondidos) para a troca de aba não piscar nem encerrar nada. */
  const visitedWorkspaces = useRef(new Set<string>());
  if (view.name === "workspace") visitedWorkspaces.current.add(activeWorkspaceId);
  const known = new Set(workspaces.map((workspace) => workspace.id));
  if (!loading && known.size > 0) {
    for (const id of visitedWorkspaces.current)
      if (!known.has(id)) visitedWorkspaces.current.delete(id);
  }
  const mountedWorkspaceIds = [
    ...workspaces.map((workspace) => workspace.id),
    ...(known.size === 0 ? [LOCAL_WORKSPACE_KEY] : []),
  ].filter((id) => visitedWorkspaces.current.has(id));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);

  useEffect(() => {
    const changed =
      previousView.current.name !== view.name ||
      (previousView.current.name === "settings" &&
        view.name === "settings" &&
        previousView.current.section !== view.section);
    if (changed) {
      const focusTarget =
        titleRef.current ??
        (view.name === "workspace"
          ? document.querySelector<HTMLElement>(
              '[data-workspace-visible="true"] [data-active="true"]',
            )
          : null);
      focusTarget?.focus({ preventScroll: true });
    }
    previousView.current = view;
  }, [view]);

  return (
    <main className={`${styles.sheet} ${view.name === "workspace" ? styles.workspaceSheet : ""}`}>
      {mountedWorkspaceIds.map((id) => {
        const visible = view.name === "workspace" && id === activeWorkspaceId;
        return (
          <div
            className={styles.workspaceHost}
            data-workspace-visible={visible ? "true" : "false"}
            hidden={!visible}
            key={id}
          >
            <WorkspacePanels titleRef={titleRef} visible={visible} workspaceId={id} />
          </div>
        );
      })}
      {view.name === "settings" ? (
        <SettingsView titleRef={titleRef} />
      ) : view.name === "workspace" ? null : (
        <>
          <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
            {t.home.title}
          </h1>
          <section aria-labelledby="home-empty-title" className={styles.emptyState}>
            <h2 className={styles.emptyTitle} id="home-empty-title">
              {t.home.emptyTitle}
            </h2>
            <p className={styles.emptyDescription}>{t.home.emptyDescription}</p>
          </section>
        </>
      )}
    </main>
  );
}

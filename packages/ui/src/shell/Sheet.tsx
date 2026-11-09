import { useEffect, useRef } from "react";
import { DotSection } from "../dot/DotSection.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import { LOCAL_WORKSPACE_KEY } from "../projects/workspaceState.ts";
import { SettingsView } from "../settings/SettingsView.tsx";
import { WorkspaceOverview } from "../workspace/WorkspaceOverview.tsx";
import { WorkspacePanels } from "../workspace/WorkspacePanels.tsx";
import { HomeInbox } from "./HomeInbox.tsx";
import { HomeOverview } from "./HomeOverview.tsx";
import { InboxScreen } from "./InboxScreen.tsx";
import styles from "./Sheet.module.css";

export function Sheet() {
  const { view, activeWorkspaceId, workspaceOverviewVisible } = useNavigation();
  const overviewShown = view.name === "workspace" && workspaceOverviewVisible;
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
  const previousOverviewShown = useRef(overviewShown);

  useEffect(() => {
    const changed =
      previousOverviewShown.current !== overviewShown ||
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
    previousOverviewShown.current = overviewShown;
  }, [view, overviewShown]);

  return (
    <main className={`${styles.sheet} ${view.name === "workspace" ? styles.workspaceSheet : ""}`}>
      {mountedWorkspaceIds.map((id) => {
        // Com a tela do workspace por cima, os painéis seguem montados (terminais e conversas vivos).
        const visible = view.name === "workspace" && id === activeWorkspaceId && !overviewShown;
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
      {overviewShown ? (
        <WorkspaceOverview
          key={activeWorkspaceId}
          titleRef={titleRef}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
      {view.name === "settings" ? (
        <SettingsView titleRef={titleRef} />
      ) : view.name === "workspace" ? null : view.name === "inbox" ? (
        <>
          <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
            {t.inbox.title}
          </h1>
          <InboxScreen titleRef={titleRef} />
        </>
      ) : view.name === "dots" ? (
        <>
          <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
            {t.dotSettings.title}
          </h1>
          <DotSection />
        </>
      ) : (
        <>
          <h1 className={styles.pageTitle} ref={titleRef} tabIndex={-1}>
            {t.home.title}
          </h1>
          <HomeInbox titleRef={titleRef} />
          <HomeOverview />
        </>
      )}
    </main>
  );
}

import { OverviewCard } from "../components/OverviewCard/OverviewCard.tsx";
import { formatMessageDateTime } from "../conversation/messageDate.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigationActions } from "../navigation/NavigationContext.tsx";
import { statusItems } from "../projects/overviewSummary.ts";
import { getProjectIcon } from "../projects/projectIcons.ts";
import { useOverview } from "../projects/useOverview.ts";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import styles from "./HomeOverview.module.css";

/** Um cartão por workspace, com números reais do resumo agregado. */
export function HomeOverview() {
  const { workspaces } = useWorkspaces();
  const { workspaces: overview, error } = useOverview();
  const { openWorkspace } = useNavigationActions();
  const byId = new Map(overview?.map((entry) => [entry.workspaceId, entry]));

  if (workspaces.length === 0) return null;
  return (
    <section aria-label={t.overview.workspacesHeading} className={styles.section}>
      {error && !overview ? (
        <p className={styles.error} role="status">
          {t.overview.loadFailed}
        </p>
      ) : null}
      <div className={styles.grid}>
        {workspaces.map((workspace) => {
          const Icon = getProjectIcon(workspace.icon);
          const summary = byId.get(workspace.id);
          return (
            <OverviewCard
              hint={t.overview.openWorkspaceHint}
              icon={<Icon size={16} strokeWidth={1.75} />}
              key={workspace.id}
              lines={
                summary
                  ? [
                      [
                        t.overview.conversations(summary.conversations),
                        summary.activeToday > 0 ? t.overview.today(summary.activeToday) : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      summary.lastActivityAt ? formatMessageDateTime(summary.lastActivityAt) : null,
                    ]
                  : []
              }
              onClick={() => openWorkspace(workspace.id)}
              status={summary ? statusItems(summary) : []}
              title={workspace.name}
            />
          );
        })}
      </div>
    </section>
  );
}

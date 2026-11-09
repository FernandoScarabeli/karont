import { Plus } from "lucide-react";
import { type RefObject, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button/Button.tsx";
import { OverviewCard } from "../components/OverviewCard/OverviewCard.tsx";
import { formatMessageDateTime } from "../conversation/messageDate.ts";
import { NewConversationView } from "../conversation/NewConversationView.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigationActions } from "../navigation/NavigationContext.tsx";
import { buildDayLine, statusItems } from "../projects/overviewSummary.ts";
import { ProjectDialog } from "../projects/ProjectDialog.tsx";
import { ProjectPicker } from "../projects/ProjectPicker.tsx";
import { getProjectIcon } from "../projects/projectIcons.ts";
import { useOverview } from "../projects/useOverview.ts";
import { upsertProject, useProjects } from "../projects/useProjects.ts";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import styles from "./WorkspaceOverview.module.css";

/** Tela do workspace: resumo do dia, campo de mensagem com escolha de projeto e um cartão por projeto. */
export function WorkspaceOverview({
  workspaceId,
  titleRef,
}: {
  workspaceId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { navigate } = useNavigationActions();
  const { workspaces } = useWorkspaces();
  const { projects: allProjects } = useProjects();
  const { workspaces: overview, error } = useOverview();
  const [projectId, setProjectId] = useState<string | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const newProjectRef = useRef<HTMLButtonElement>(null);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const projects = useMemo(
    () => allProjects.filter((project) => project.workspaceId === workspaceId),
    [allProjects, workspaceId],
  );
  const summary = overview?.find((item) => item.workspaceId === workspaceId);
  const projectSummaries = new Map(summary?.projects.map((item) => [item.projectId, item]));
  const name = workspace?.name ?? "";
  // Projeto apagado ou movido de workspace: volta para "Sem projeto".
  const chosenProjectId = projects.some((project) => project.id === projectId)
    ? projectId
    : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title} ref={titleRef} tabIndex={-1}>
            {name}
          </h1>
          {summary ? <p className={styles.dayLine}>{buildDayLine(summary)}</p> : null}
          {error && !overview ? (
            <p className={styles.dayLine} role="status">
              {t.overview.loadFailed}
            </p>
          ) : null}
        </header>

        <div className={styles.composer}>
          <NewConversationView
            composerLabel={t.overview.composerLabel(name)}
            embedded
            projectId={chosenProjectId}
            projectPicker={
              <ProjectPicker
                onChange={setProjectId}
                projectId={chosenProjectId}
                projects={projects}
              />
            }
            workspaceId={workspace?.id}
          />
        </div>

        {projects.length > 0 ? (
          <section aria-label={t.overview.projectsHeading} className={styles.grid}>
            {projects.map((project) => {
              const Icon = getProjectIcon(project.icon);
              const item = projectSummaries.get(project.id);
              return (
                <OverviewCard
                  hint={t.overview.openProjectHint}
                  icon={<Icon size={16} strokeWidth={1.75} />}
                  key={project.id}
                  lines={
                    item
                      ? [
                          t.overview.conversations(item.conversations),
                          item.lastActivityAt ? formatMessageDateTime(item.lastActivityAt) : null,
                        ]
                      : []
                  }
                  onClick={() => navigate({ name: "new-conversation", projectId: project.id })}
                  status={item ? statusItems(item) : []}
                  title={project.name}
                />
              );
            })}
          </section>
        ) : (
          <section aria-label={t.overview.projectsHeading} className={styles.empty}>
            <p className={styles.emptyText}>{t.overview.noProjects}</p>
            <Button
              iconStart={<Plus size={15} strokeWidth={1.75} />}
              onClick={() => setDialogOpen(true)}
              ref={newProjectRef}
            >
              {t.overview.newProject}
            </Button>
          </section>
        )}
      </div>
      <ProjectDialog
        onClose={() => setDialogOpen(false)}
        onSaved={(project) => {
          upsertProject(project);
          setDialogOpen(false);
          setProjectId(project.id);
        }}
        open={dialogOpen}
        project={null}
        returnFocusRef={newProjectRef}
      />
    </div>
  );
}

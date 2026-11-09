import type { Project } from "@karont/contract";
import { Folder } from "lucide-react";
import { useState } from "react";
import { ComposerMenu, type ComposerMenuOption } from "../components/ComposerMenu/ComposerMenu.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ProjectPicker.module.css";
import { getProjectIcon } from "./projectIcons.ts";

/** Escolha do projeto da nova conversa: os projetos do workspace e "Sem projeto". */
export function ProjectPicker({
  projects,
  projectId,
  onChange,
}: {
  projects: Project[];
  projectId: string | undefined;
  onChange: (projectId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((project) => project.id === projectId);
  const name = selected?.name ?? t.overview.noProject;
  const options: ComposerMenuOption[] = [
    {
      id: "none",
      selected: !selected,
      content: (
        <>
          <Folder aria-hidden="true" size={16} strokeWidth={1.8} />
          <span className={styles.name}>{t.overview.noProject}</span>
        </>
      ),
      onSelect: () => onChange(undefined),
    },
    ...projects.map((project) => {
      const Icon = getProjectIcon(project.icon);
      return {
        id: project.id,
        selected: project.id === selected?.id,
        content: (
          <>
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
            <span className={styles.name}>{project.name}</span>
          </>
        ),
        onSelect: () => onChange(project.id),
      };
    }),
  ];
  const SelectedIcon = selected ? getProjectIcon(selected.icon) : Folder;
  return (
    <ComposerMenu
      label={t.overview.projectPickerLabel}
      onOpenChange={setOpen}
      open={open}
      options={options}
      tooltipAlign="start"
      tooltipLabel={t.overview.projectPickerLabel}
      triggerClassName={styles.trigger}
      triggerContent={
        <>
          <SelectedIcon aria-hidden="true" size={16} strokeWidth={1.8} />
          <span className={styles.name}>{name}</span>
        </>
      }
      triggerLabel={t.overview.projectPickerTrigger(name)}
    />
  );
}

import { SEARCH_QUERY_MAX, type SearchSnippetSegment } from "@karont/contract";
import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { formatMessageDateTime } from "../conversation/messageDate.ts";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { getProjectIcon } from "../projects/projectIcons.ts";
import {
  buildSearchGroups,
  flattenSearchGroups,
  moveSearchSelection,
  type SearchEntry,
  type SearchGroupKind,
  type SearchSelectionState,
  selectionAfterResponse,
} from "../projects/searchPanelState.ts";
import { useProjects } from "../projects/useProjects.ts";
import { useWorkspaces } from "../projects/useWorkspaces.ts";
import styles from "./SearchPanel.module.css";
import { useSearchQuery } from "./useSearchQuery.ts";

export type SearchPanelProps = {
  open: boolean;
  onClose: () => void;
};

const GROUP_TITLES: Record<SearchGroupKind, string> = {
  conversation: t.search.conversations,
  project: t.search.projects,
  message: t.search.messages,
};

function agentName(agent: string): string {
  return agent === "claude" ? t.chat.agents.claude : t.chat.agents.codex;
}

function Snippet({ segments }: { segments: readonly SearchSnippetSegment[] }) {
  let offset = 0;
  return (
    <p className={styles.snippet}>
      {segments.map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.match ? (
          <mark className={styles.match} key={key}>
            {segment.text}
          </mark>
        ) : (
          <span key={key}>{segment.text}</span>
        );
      })}
    </p>
  );
}

export function SearchPanel({ open, onClose }: SearchPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openingFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const idPrefix = useId();
  const listId = `${idPrefix}-list`;
  const { navigate } = useNavigation();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();
  const [value, setValue] = useState("");
  const [selection, setSelection] = useState<SearchSelectionState>({
    keys: [],
    selectedKey: null,
    moved: false,
  });
  const { query, result, settled, failed } = useSearchQuery(open, value);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const restoreFocus = useCallback(() => {
    const target = openingFocusRef.current;
    openingFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        openingFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      inputRef.current?.focus();
      return;
    }
    if (dialog.open) {
      dialog.close();
      setValue("");
      restoreFocus();
    }
  }, [open, restoreFocus]);

  useEffect(
    () => () => {
      const dialog = dialogRef.current;
      if (!dialog?.open) return;
      dialog.close();
      restoreFocus();
    },
    [restoreFocus],
  );

  const groups = useMemo(() => buildSearchGroups(result), [result]);
  const entries = useMemo(() => flattenSearchGroups(groups), [groups]);
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);

  useEffect(() => {
    setSelection((previous) => selectionAfterResponse(previous, keys));
  }, [keys]);

  const activeKey =
    selection.selectedKey !== null && keys.includes(selection.selectedKey)
      ? selection.selectedKey
      : (keys[0] ?? null);
  const optionId = useCallback((key: string) => `${idPrefix}-option-${key}`, [idPrefix]);

  // O item ativo fica visível; no primeiro de um grupo, o título dele também.
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeKey === null) return;
    const element = document.getElementById(optionId(activeKey));
    if (!element) return;
    const previous = element.previousElementSibling;
    const first = previous instanceof HTMLElement && previous.dataset.groupTitle !== undefined;
    if (keys[0] === activeKey) list.scrollTop = 0;
    else (first ? previous : element).scrollIntoView({ block: "nearest" });
  }, [activeKey, keys, optionId]);

  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  function choose(entry: SearchEntry) {
    onCloseRef.current();
    if (entry.kind === "project") {
      navigate({
        name: "new-conversation",
        projectId: entry.item.projectId,
        workspaceId: entry.item.workspaceId,
      });
      return;
    }
    navigate({
      name: "conversation",
      id: entry.item.conversationId,
      workspaceId: entry.item.workspaceId,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = moveSearchSelection(
        keys,
        activeKey,
        event.key === "ArrowDown" ? "next" : "previous",
      );
      setSelection({ keys, selectedKey: next, moved: true });
      return;
    }
    if (event.key === "Enter") {
      const entry = entries.find((candidate) => candidate.key === activeKey);
      if (!entry) return;
      event.preventDefault();
      choose(entry);
    }
  }

  const showEmpty = query !== "" && settled && entries.length === 0 && !failed;

  function renderEntry(entry: SearchEntry) {
    const workspaceName = workspaceNames.get(entry.item.workspaceId) ?? "";
    const common = {
      "aria-selected": entry.key === activeKey,
      className: styles.option,
      id: optionId(entry.key),
      onClick: () => choose(entry),
      onMouseMove: () => {
        if (entry.key !== activeKey) {
          setSelection({ keys, selectedKey: entry.key, moved: true });
        }
      },
      role: "option",
    } as const;
    const workspace = workspaceName ? (
      <span className={styles.workspace}>{workspaceName}</span>
    ) : null;

    if (entry.kind === "project") {
      const Icon = getProjectIcon(entry.item.icon);
      return (
        <div {...common} key={entry.key}>
          <Icon aria-hidden="true" className={styles.icon} size={16} strokeWidth={1.75} />
          <span className={styles.main}>
            <span className={styles.title}>{entry.item.name}</span>
          </span>
          {workspace}
        </div>
      );
    }

    if (entry.kind === "conversation") {
      const project = entry.item.projectId ? projectsById.get(entry.item.projectId) : undefined;
      return (
        <div {...common} key={entry.key}>
          <AgentIcon agentId={entry.item.agent} className={styles.icon} />
          <span className={styles.main}>
            <span className={styles.line}>
              <span className={styles.title}>{entry.item.title}</span>
              {project ? <span className={styles.meta}>{project.name}</span> : null}
              {entry.item.archived ? (
                <span className={styles.badge}>{t.search.archived}</span>
              ) : null}
            </span>
          </span>
          {workspace}
        </div>
      );
    }

    const author = entry.item.author === "user" ? t.search.you : agentName(entry.item.agent);
    return (
      <div {...common} key={entry.key}>
        <AgentIcon agentId={entry.item.agent} className={styles.icon} />
        <span className={styles.main}>
          <span className={styles.line}>
            <span className={styles.title}>{entry.item.conversationTitle}</span>
            <span className={styles.meta}>
              {author} · {formatMessageDateTime(entry.item.createdAt)}
            </span>
            {entry.item.archived ? <span className={styles.badge}>{t.search.archived}</span> : null}
          </span>
          <Snippet segments={entry.item.snippet} />
        </span>
        {workspace}
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: o clique no fundo é só atalho; Esc e Ctrl K já fecham.
    <dialog
      aria-label={t.search.title}
      className={styles.panel}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
      ref={dialogRef}
    >
      <div className={styles.inputRow}>
        <Search aria-hidden="true" className={styles.searchIcon} size={16} strokeWidth={1.75} />
        <input
          aria-activedescendant={activeKey !== null ? optionId(activeKey) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={entries.length > 0}
          aria-label={t.search.inputLabel}
          autoComplete="off"
          className={styles.input}
          maxLength={SEARCH_QUERY_MAX}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.search.placeholder}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={value}
        />
      </div>
      {query !== "" ? (
        <div className={styles.results}>
          {failed ? (
            <p className={styles.status} role="status">
              {t.search.error}
            </p>
          ) : null}
          {showEmpty ? (
            <p className={styles.status} role="status">
              {t.search.empty}
            </p>
          ) : null}
          <div
            aria-label={t.search.resultsLabel}
            className={styles.list}
            id={listId}
            onMouseDown={(event) => event.preventDefault()}
            ref={listRef}
            role="listbox"
          >
            {groups.map((group) => {
              const headingId = `${idPrefix}-group-${group.kind}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: grupo dentro de listbox exige role=group num contêiner.
                <div
                  aria-labelledby={headingId}
                  className={styles.group}
                  key={group.kind}
                  role="group"
                >
                  <div
                    className={styles.groupTitle}
                    data-group-title=""
                    id={headingId}
                    role="presentation"
                  >
                    {GROUP_TITLES[group.kind]}
                  </div>
                  {group.entries.map(renderEntry)}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

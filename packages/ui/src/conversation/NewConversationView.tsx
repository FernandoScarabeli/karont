import type { Agent, RecentFolder } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Check, ChevronDown, Folder, SquareTerminal, TriangleAlert } from "lucide-react";
import {
  type DragEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Composer } from "../components/Composer/Composer.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import styles from "./NewConversationView.module.css";

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const LAST_FOLDER_SETTING = "newConversation.lastFolder";
const TERMINAL_CHOICE = "terminal";
const PERSONAL_FOLDER = "~";

type AgentChoice = typeof TERMINAL_CHOICE | string;
type ActiveMenu = "choice" | "folder" | null;
type MenuOption = {
  id: string;
  content: ReactNode;
  selected: boolean;
  onSelect: () => void;
};

export function NewConversationView({
  titleRef,
  headerActions,
  dragHandleProps,
}: {
  titleRef?: RefObject<HTMLHeadingElement | null>;
  headerActions?: ReactNode;
  dragHandleProps?: {
    draggable: boolean;
    onDragEnd: DragEventHandler<HTMLHeadingElement>;
    onDragStart: DragEventHandler<HTMLHeadingElement>;
    tabIndex: number;
  };
}) {
  const bridge = getBridge();
  const { navigate } = useNavigation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [choice, setChoice] = useState<AgentChoice>(TERMINAL_CHOICE);
  const [folderPath, setFolderPath] = useState(PERSONAL_FOLDER);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [command, setCommand] = useState("");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpening, setIsOpening] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogPath, setFolderDialogPath] = useState("");
  const [folderDialogError, setFolderDialogError] = useState("");
  const [error, setError] = useState("");
  const [agentsError, setAgentsError] = useState(false);
  const [foldersError, setFoldersError] = useState(false);
  const choiceTriggerRef = useRef<HTMLButtonElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const folderPathRef = useRef(folderPath);
  const choiceTouchedRef = useRef(false);
  const folderTouchedRef = useRef(false);
  const titleId = useId();
  const choiceListboxId = useId();
  const folderListboxId = useId();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDialogFormId = useId();

  const updateFolderPath = useCallback((path: string) => {
    folderPathRef.current = path;
    setFolderPath(path);
  }, []);

  const saveSetting = useCallback(
    (key: string, value: string, failureMessage: string) => {
      if (!bridge) return;
      void bridge.request("settings.set", { key, value }).catch(() => {
        setError(failureMessage);
      });
    },
    [bridge],
  );

  const setRecentFolderList = useCallback(
    (folders: RecentFolder[]) => {
      setRecentFolders(folders);
      const selectedPath = folderPathRef.current;
      if (
        selectedPath === PERSONAL_FOLDER ||
        folders.some((folder) => folder.path === selectedPath)
      ) {
        return;
      }

      void bridge?.request("folders.validate", { path: selectedPath }).then(
        (result) => {
          if (folderPathRef.current === selectedPath && (!result.exists || !result.isDirectory)) {
            updateFolderPath(PERSONAL_FOLDER);
            saveSetting(
              LAST_FOLDER_SETTING,
              PERSONAL_FOLDER,
              t.conversation.settingsFolderSaveFailed,
            );
          }
        },
        () => undefined,
      );
    },
    [bridge, saveSetting, updateFolderPath],
  );

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    const unsubscribe = bridge.onEvent((event) => {
      if (event.event === "folders.changed" && mounted) {
        setFoldersError(false);
        setRecentFolderList(event.payload.folders);
      }
    });

    void Promise.allSettled([
      bridge.request("agents.list", {}),
      bridge.request("settings.get", { key: LAST_AGENT_SETTING }),
      bridge.request("settings.get", { key: LAST_FOLDER_SETTING }),
      bridge.request("folders.recent", {}),
    ]).then(async ([agentsResult, agentSettingResult, folderSettingResult, foldersResult]) => {
      if (!mounted) return;

      if (agentsResult.status === "fulfilled") {
        const foundAgents = agentsResult.value.agents.filter((agent) => agent.found);
        setAgents(foundAgents);
        if (
          !choiceTouchedRef.current &&
          agentSettingResult.status === "fulfilled" &&
          typeof agentSettingResult.value.value === "string" &&
          (agentSettingResult.value.value === TERMINAL_CHOICE ||
            foundAgents.some((agent) => agent.id === agentSettingResult.value.value))
        ) {
          setChoice(agentSettingResult.value.value);
        }
      } else {
        setAgentsError(true);
      }

      if (foldersResult.status === "fulfilled") {
        setFoldersError(false);
        setRecentFolderList(foldersResult.value.folders);
      } else {
        setFoldersError(true);
      }

      if (folderSettingResult.status !== "fulfilled") return;
      if (folderTouchedRef.current) return;
      const storedFolder = folderSettingResult.value.value;
      if (typeof storedFolder !== "string" || storedFolder === PERSONAL_FOLDER) return;

      try {
        const validation = await bridge.request("folders.validate", { path: storedFolder });
        if (!mounted) return;
        if (folderTouchedRef.current) return;
        if (validation.exists && validation.isDirectory) {
          updateFolderPath(validation.path);
          return;
        }
      } catch {
        return;
      }

      if (mounted) {
        updateFolderPath(PERSONAL_FOLDER);
        saveSetting(LAST_FOLDER_SETTING, PERSONAL_FOLDER, t.conversation.settingsFolderSaveFailed);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge, saveSetting, setRecentFolderList, updateFolderPath]);

  useEffect(() => {
    if (activeMenu === null) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, activeMenu]);

  useEffect(() => {
    if (activeMenu === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setActiveMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [activeMenu]);

  const selectedAgent = agents.find((agent) => agent.id === choice);
  const selectedTitle = selectedAgent?.name ?? t.conversation.terminal;
  const homePath = recentFolders.find((folder) => folder.name === PERSONAL_FOLDER)?.path;
  const isPersonalFolderSelected = folderPath === PERSONAL_FOLDER || folderPath === homePath;
  const selectedRecentFolder = recentFolders.find((folder) => folder.path === folderPath);
  const folderName = isPersonalFolderSelected
    ? PERSONAL_FOLDER
    : (selectedRecentFolder?.name ?? getFolderName(folderPath));
  const accessibleFolderPath = isPersonalFolderSelected
    ? (homePath ?? PERSONAL_FOLDER)
    : folderPath;
  const folderButtonLabel = `${t.conversation.folderAccessibleName(accessibleFolderPath)}`;

  function closeMenu(kind: ActiveMenu = activeMenu, returnFocus = true) {
    setActiveMenu(null);
    if (!returnFocus) return;
    if (kind === "choice") choiceTriggerRef.current?.focus();
    if (kind === "folder") folderTriggerRef.current?.focus();
  }

  function chooseAgent(option: AgentChoice) {
    choiceTouchedRef.current = true;
    setChoice(option);
    setError("");
    closeMenu("choice");
    saveSetting(LAST_AGENT_SETTING, option, t.conversation.settingsSaveFailed);
  }

  function chooseFolder(path: string) {
    folderTouchedRef.current = true;
    const selectedPath = path === homePath ? PERSONAL_FOLDER : path;
    updateFolderPath(selectedPath);
    setError("");
    closeMenu("folder");
    saveSetting(LAST_FOLDER_SETTING, selectedPath, t.conversation.settingsFolderSaveFailed);
  }

  function buildChoiceOptions(): MenuOption[] {
    return [
      ...agents.map((agent) => ({
        id: agent.id,
        selected: agent.id === choice,
        content: (
          <>
            <span>{agent.name}</span>
            <span className={styles.soonMarker}>{t.conversation.soon}</span>
          </>
        ),
        onSelect: () => chooseAgent(agent.id),
      })),
      {
        id: TERMINAL_CHOICE,
        selected: choice === TERMINAL_CHOICE,
        content: (
          <>
            <SquareTerminal aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{t.conversation.terminal}</span>
          </>
        ),
        onSelect: () => chooseAgent(TERMINAL_CHOICE),
      },
      {
        id: "manage-agents",
        selected: false,
        content: <span>{t.conversation.manageAgents}</span>,
        onSelect: () => {
          setActiveMenu(null);
          navigate({ name: "settings", section: "agents" });
        },
      },
    ];
  }

  function buildFolderOptions(): MenuOption[] {
    const selectedFolderIsRecent = recentFolders.some((folder) => folder.path === folderPath);
    const selectedFolderOption: MenuOption[] =
      folderPath !== PERSONAL_FOLDER && !isPersonalFolderSelected && !selectedFolderIsRecent
        ? [
            {
              id: folderPath,
              selected: true,
              content: folderOptionContent(folderName, folderPath, homePath),
              onSelect: () => chooseFolder(folderPath),
            },
          ]
        : [];

    return [
      ...selectedFolderOption,
      ...recentFolders
        .filter((folder) => folder.name !== PERSONAL_FOLDER)
        .map((folder) => ({
          id: folder.path,
          selected: folder.path === folderPath,
          content: folderOptionContent(folder.name, folder.path, homePath),
          onSelect: () => chooseFolder(folder.path),
        })),
      {
        id: PERSONAL_FOLDER,
        selected: isPersonalFolderSelected,
        content: <span>{t.conversation.personalFolder}</span>,
        onSelect: () => chooseFolder(PERSONAL_FOLDER),
      },
      {
        id: "choose-folder",
        selected: false,
        content: <span>{t.conversation.chooseFolder}</span>,
        onSelect: () => void openFolderChooser(),
      },
    ];
  }

  function openMenu(kind: Exclude<ActiveMenu, null>) {
    const options = kind === "choice" ? buildChoiceOptions() : buildFolderOptions();
    const currentIndex = options.findIndex((option) => option.selected);
    setActiveIndex(Math.max(currentIndex, 0));
    setActiveMenu(kind);
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    options: MenuOption[],
    kind: Exclude<ActiveMenu, null>,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      options[index]?.onSelect();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(kind);
    }
  }

  async function openFolderChooser() {
    closeMenu("folder");
    if (!bridge?.pickFolder) {
      setFolderDialogPath(folderPath === PERSONAL_FOLDER ? "" : folderPath);
      setFolderDialogError("");
      setIsFolderDialogOpen(true);
      return;
    }

    setError("");
    try {
      const selected = await bridge.pickFolder({
        defaultPath: folderPath === PERSONAL_FOLDER ? undefined : folderPath,
      });
      if (selected) await validateAndChooseFolder(selected.path, false);
    } catch (pickError) {
      setError(
        pickError instanceof BridgeError && pickError.message
          ? pickError.message
          : t.conversation.folderChooseFailed,
      );
    }
  }

  async function validateAndChooseFolder(path: string, fromDialog: boolean) {
    const setValidationError = (message: string) => {
      if (fromDialog) setFolderDialogError(message);
      else setError(message);
    };
    if (!bridge) {
      setValidationError(t.conversation.noBridge);
      return;
    }
    if (!isAbsolutePath(path)) {
      setValidationError(t.conversation.folderPathMustBeAbsolute);
      return;
    }

    setValidationError("");
    try {
      const result = await bridge.request("folders.validate", { path });
      if (!result.exists) {
        setValidationError(t.conversation.folderDoesNotExist);
        return;
      }
      if (!result.isDirectory) {
        setValidationError(t.conversation.folderIsNotDirectory);
        return;
      }
      chooseFolder(result.path);
      setIsFolderDialogOpen(false);
    } catch (validationError) {
      setValidationError(
        validationError instanceof BridgeError && validationError.message
          ? validationError.message
          : t.conversation.folderValidateFailed,
      );
    }
  }

  async function openTerminal(value: string) {
    if (!bridge || isOpening || choice !== TERMINAL_CHOICE) return;
    setError("");
    setIsOpening(true);
    const cleanCommand = value.trim();
    try {
      const result = await bridge.request("terminals.open", {
        cols: 80,
        rows: 24,
        ...(folderPath === PERSONAL_FOLDER ? {} : { cwd: folderPath }),
        ...(cleanCommand ? { command: cleanCommand } : {}),
      });
      navigate({ name: "terminal", id: result.terminal.id });
    } catch (openError) {
      setError(
        openError instanceof BridgeError && openError.message
          ? openError.message
          : t.conversation.openFailed,
      );
    } finally {
      setIsOpening(false);
    }
  }

  const choiceOptions = buildChoiceOptions();
  const folderOptions = buildFolderOptions();

  function renderListbox(kind: Exclude<ActiveMenu, null>) {
    const options = kind === "choice" ? choiceOptions : folderOptions;
    const listboxId = kind === "choice" ? choiceListboxId : folderListboxId;
    const listboxLabel =
      kind === "choice" ? t.conversation.agentLabel : t.conversation.folderMenuLabel;
    return (
      <div aria-label={listboxLabel} className={styles.listbox} id={listboxId} role="listbox">
        {options.map((option, index) => (
          <div
            aria-selected={option.selected}
            className={[
              styles.option,
              option.id === "manage-agents" ? styles.actionOption : "",
              kind === "folder" && (option.id === PERSONAL_FOLDER || option.id === "choose-folder")
                ? styles.separatorOption
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id={`${listboxId}-${index}`}
            key={option.id}
            onBlur={(event) => {
              if (!menuRootRef.current?.contains(event.relatedTarget as Node | null)) {
                setActiveMenu(null);
              }
            }}
            onClick={option.onSelect}
            onKeyDown={(event) => handleOptionKeyDown(event, index, options, kind)}
            onMouseMove={() => setActiveIndex(index)}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            role="option"
            tabIndex={activeIndex === index ? 0 : -1}
          >
            {option.content}
            {kind === "folder" && option.selected ? (
              <Check
                aria-hidden="true"
                className={styles.selectedCheck}
                size={16}
                strokeWidth={2}
              />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1} {...dragHandleProps}>
          {t.conversation.title}
        </h1>
        {headerActions}
      </header>

      <section aria-labelledby={titleId} className={styles.composerSection}>
        <Composer
          disabled={choice !== TERMINAL_CHOICE}
          hint={
            choice === TERMINAL_CHOICE
              ? t.conversation.terminalComposerHint
              : t.conversation.agentChatSoon
          }
          leading={
            <div className={styles.controls} ref={menuRootRef}>
              <div className={styles.choiceWrap}>
                <button
                  aria-controls={choiceListboxId}
                  aria-expanded={activeMenu === "choice"}
                  aria-haspopup="listbox"
                  aria-label={`${t.conversation.agentLabel}: ${selectedTitle}`}
                  className={styles.selectorButton}
                  onClick={() =>
                    activeMenu === "choice" ? closeMenu("choice", false) : openMenu("choice")
                  }
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      openMenu("choice");
                    }
                  }}
                  ref={choiceTriggerRef}
                  type="button"
                >
                  <span>{selectedTitle}</span>
                  <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
                </button>
                {activeMenu === "choice" ? renderListbox("choice") : null}
              </div>

              <div className={styles.folderWrap}>
                <button
                  aria-controls={folderListboxId}
                  aria-expanded={activeMenu === "folder"}
                  aria-haspopup="listbox"
                  aria-label={folderButtonLabel}
                  className={styles.folderButton}
                  onClick={() =>
                    activeMenu === "folder" ? closeMenu("folder", false) : openMenu("folder")
                  }
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      openMenu("folder");
                    }
                  }}
                  ref={folderTriggerRef}
                  title={accessibleFolderPath}
                  type="button"
                >
                  <Folder aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>{folderName}</span>
                  <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
                {activeMenu === "folder" ? renderListbox("folder") : null}
              </div>
            </div>
          }
          mono={choice === TERMINAL_CHOICE}
          onChange={setCommand}
          onSubmit={() => void openTerminal(command)}
          placeholder={
            choice === TERMINAL_CHOICE
              ? t.conversation.terminalCommandPlaceholder
              : t.conversation.promptPlaceholder
          }
          submitDisabled={!bridge || isOpening || choice !== TERMINAL_CHOICE}
          submitLabel={
            choice === TERMINAL_CHOICE ? t.conversation.openTerminal : t.conversation.sendMessage
          }
          value={command}
        />
      </section>

      {agentsError ? (
        <p className={styles.error} role="alert">
          {t.conversation.agentsLoadFailed}
        </p>
      ) : null}
      {foldersError ? (
        <p className={styles.error} role="alert">
          {t.conversation.foldersLoadFailed}
        </p>
      ) : null}
      {!bridge ? (
        <p className={styles.connectionMessage} role="status">
          {t.conversation.noBridge}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{error}</span>
        </p>
      ) : null}

      <Dialog
        description={t.conversation.folderDialogDescription}
        footer={
          <>
            <Button onClick={() => setIsFolderDialogOpen(false)} variant="secondary">
              {t.conversation.cancel}
            </Button>
            <Button form={folderDialogFormId} type="submit" variant="primary">
              {t.conversation.chooseFolderAction}
            </Button>
          </>
        }
        initialFocusRef={folderInputRef as RefObject<HTMLElement | null>}
        onClose={() => setIsFolderDialogOpen(false)}
        open={isFolderDialogOpen}
        title={t.conversation.folderDialogTitle}
      >
        <form
          id={folderDialogFormId}
          onSubmit={(event) => {
            event.preventDefault();
            void validateAndChooseFolder(folderDialogPath.trim(), true);
          }}
        >
          <TextField
            autoFocus
            error={folderDialogError || undefined}
            label={t.conversation.folderPathLabel}
            mono
            onChange={(event) => {
              setFolderDialogPath(event.currentTarget.value);
              setFolderDialogError("");
            }}
            placeholder="/home/usuario/projeto"
            ref={folderInputRef}
            value={folderDialogPath}
          />
        </form>
      </Dialog>
    </div>
  );
}

function getFolderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function folderOptionContent(name: string, path: string, homePath?: string): ReactNode {
  return (
    <span className={styles.folderOptionContent} title={path}>
      <span className={styles.folderOptionName}>{name}</span>
      <span className={styles.folderOptionPath}>{shortenFolderPath(path, homePath)}</span>
    </span>
  );
}

function shortenFolderPath(path: string, homePath?: string): string {
  if (path === homePath) return PERSONAL_FOLDER;
  if (homePath && path.startsWith(`${homePath}/`)) return `~${path.slice(homePath.length)}`;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

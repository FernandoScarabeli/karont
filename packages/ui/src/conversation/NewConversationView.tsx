import type { Agent, Conversation } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { ChevronDown, Folder, TriangleAlert } from "lucide-react";
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
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Composer } from "../components/Composer/Composer.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import {
  type AgentEffort,
  type AgentModels,
  ComposerPreferences,
  effortsForModel,
} from "./ComposerPreferences.tsx";
import styles from "./NewConversationView.module.css";
import { upsertConversation } from "./useConversationIndex.ts";

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const LAST_FOLDER_SETTING = "newConversation.lastFolder";
const TERMINAL_CHOICE = "terminal";
const PERSONAL_FOLDER = "~";

type AgentChoice = typeof TERMINAL_CHOICE | string;
type ActiveMenu = "choice" | null;
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
  const [homePath, setHomePath] = useState<string>();
  const [command, setCommand] = useState("");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpening, setIsOpening] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogPath, setFolderDialogPath] = useState("");
  const [folderDialogError, setFolderDialogError] = useState("");
  const [error, setError] = useState("");
  const [agentsError, setAgentsError] = useState(false);
  const [models, setModels] = useState<AgentModels | null>(null);
  const [mode, setMode] = useState<Conversation["mode"]>("edit");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<AgentEffort | "">("");
  const choiceTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const choiceTouchedRef = useRef(false);
  const folderTouchedRef = useRef(false);
  const titleId = useId();
  const choiceListboxId = useId();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDialogFormId = useId();

  const updateFolderPath = useCallback((path: string) => {
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

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;

    void Promise.allSettled([
      bridge.request("agents.list", {}),
      bridge.request("settings.get", { key: LAST_AGENT_SETTING }),
      bridge.request("settings.get", { key: LAST_FOLDER_SETTING }),
      bridge.request("system.info", {}),
    ]).then(async ([agentsResult, agentSettingResult, folderSettingResult, systemInfoResult]) => {
      if (!mounted) return;

      if (agentsResult.status === "fulfilled") {
        const foundAgents = agentsResult.value.agents.filter(
          (agent) => agent.found && (agent.id === "claude" || agent.id === "codex"),
        );
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

      if (systemInfoResult.status === "fulfilled") {
        setHomePath(systemInfoResult.value.homeDir);
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
    };
  }, [bridge, saveSetting, updateFolderPath]);

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
  const isPersonalFolderSelected = folderPath === PERSONAL_FOLDER || folderPath === homePath;
  const folderName = isPersonalFolderSelected ? PERSONAL_FOLDER : getFolderName(folderPath);
  const accessibleFolderPath = isPersonalFolderSelected
    ? (homePath ?? PERSONAL_FOLDER)
    : folderPath;
  const folderButtonLabel = `${t.conversation.folderAccessibleName(accessibleFolderPath)}`;

  useEffect(() => {
    if (
      !bridge ||
      !selectedAgent ||
      (selectedAgent.id !== "claude" && selectedAgent.id !== "codex")
    ) {
      setModels(null);
      setModel("");
      setEffort("");
      return;
    }
    const agentId = selectedAgent.id;
    let mounted = true;
    setModels(null);
    void bridge
      .request("agent.models", { agent: agentId })
      .then((result) => {
        if (mounted) setModels(result);
      })
      .catch(() => {
        if (mounted) setModels({ agent: agentId, models: [], efforts: [] });
      });
    return () => {
      mounted = false;
    };
  }, [bridge, selectedAgent]);

  function closeMenu(returnFocus = true) {
    setActiveMenu(null);
    if (returnFocus) choiceTriggerRef.current?.focus();
  }

  function chooseAgent(option: AgentChoice) {
    choiceTouchedRef.current = true;
    setChoice(option);
    setError("");
    closeMenu();
    saveSetting(LAST_AGENT_SETTING, option, t.conversation.settingsSaveFailed);
  }

  function chooseFolder(path: string) {
    folderTouchedRef.current = true;
    const selectedPath = path === homePath ? PERSONAL_FOLDER : path;
    updateFolderPath(selectedPath);
    setError("");
    saveSetting(LAST_FOLDER_SETTING, selectedPath, t.conversation.settingsFolderSaveFailed);
  }

  function buildChoiceOptions(): MenuOption[] {
    return [
      ...agents.map((agent) => ({
        id: agent.id,
        selected: agent.id === choice,
        content: (
          <>
            <AgentIcon agentId={agent.id} />
            <span>{agent.name}</span>
          </>
        ),
        onSelect: () => chooseAgent(agent.id),
      })),
      {
        id: TERMINAL_CHOICE,
        selected: choice === TERMINAL_CHOICE,
        content: (
          <>
            <AgentIcon agentId={TERMINAL_CHOICE} />
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

  function openMenu() {
    const options = buildChoiceOptions();
    const currentIndex = options.findIndex((option) => option.selected);
    setActiveIndex(Math.max(currentIndex, 0));
    setActiveMenu("choice");
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    options: MenuOption[],
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
      closeMenu();
    }
  }

  async function openFolderChooser() {
    setActiveMenu(null);
    if (!bridge?.pickFolder) {
      setFolderDialogPath(folderPath === PERSONAL_FOLDER ? "" : folderPath);
      setFolderDialogError("");
      setIsFolderDialogOpen(true);
      return;
    }

    setError("");
    try {
      const selected = await bridge.pickFolder({
        defaultPath: folderPath === PERSONAL_FOLDER ? homePath : folderPath,
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

  async function openAgentConversation(value: string) {
    if (!bridge || isOpening || !selectedAgent) return;
    if (selectedAgent.id !== "claude" && selectedAgent.id !== "codex") {
      setError(t.chat.agentUnavailable);
      return;
    }
    const text = value.trim();
    if (!text) return;
    setError("");
    setIsOpening(true);
    let created: Conversation | null = null;
    try {
      const cwd =
        folderPath === PERSONAL_FOLDER
          ? (homePath ?? (await bridge.request("system.info", {})).homeDir)
          : folderPath;
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? text;
      const result = await bridge.request("conversation.create", {
        agent: selectedAgent.id,
        cwd,
        mode,
        title: firstLine.slice(0, 240),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      created = result.conversation;
      upsertConversation(created);
      await bridge.request("conversation.send", { id: created.id, text });
      navigate({ name: "conversation", id: created.id });
    } catch (openError) {
      setError(
        openError instanceof BridgeError && openError.message
          ? openError.message
          : t.chat.createFailed,
      );
    } finally {
      setIsOpening(false);
    }
  }

  function submitComposer() {
    if (choice === TERMINAL_CHOICE) void openTerminal(command);
    else void openAgentConversation(command);
  }

  const choiceOptions = buildChoiceOptions();

  function renderListbox() {
    const options = choiceOptions;
    const listboxId = choiceListboxId;
    const listboxLabel = t.conversation.agentLabel;
    return (
      <div aria-label={listboxLabel} className={styles.listbox} id={listboxId} role="listbox">
        {options.map((option, index) => (
          <div
            aria-selected={option.selected}
            className={[styles.option, option.id === "manage-agents" ? styles.actionOption : ""]
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
            onKeyDown={(event) => handleOptionKeyDown(event, index, options)}
            onMouseMove={() => setActiveIndex(index)}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            role="option"
            tabIndex={activeIndex === index ? 0 : -1}
          >
            {option.content}
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
        <p className={styles.welcome} data-k-new-conversation-title>
          {t.conversation.welcomeTitle}
        </p>
        <Composer
          disabled={choice !== TERMINAL_CHOICE && !selectedAgent}
          ariaDescription={t.conversation.composerKeyboardDescription}
          leading={
            <div className={styles.controls} ref={menuRootRef}>
              <div className={styles.choiceWrap}>
                <button
                  aria-controls={choiceListboxId}
                  aria-expanded={activeMenu === "choice"}
                  aria-haspopup="listbox"
                  aria-label={`${t.conversation.agentLabel}: ${selectedTitle}`}
                  className={styles.selectorButton}
                  onClick={() => (activeMenu === "choice" ? closeMenu(false) : openMenu())}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      openMenu();
                    }
                  }}
                  ref={choiceTriggerRef}
                  type="button"
                >
                  <AgentIcon agentId={choice} />
                  <span>{selectedTitle}</span>
                  <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
                </button>
                {activeMenu === "choice" ? renderListbox() : null}
              </div>
              {selectedAgent && (selectedAgent.id === "claude" || selectedAgent.id === "codex") ? (
                <ComposerPreferences
                  effort={effort}
                  mode={mode}
                  model={model}
                  models={models}
                  onEffortChange={setEffort}
                  onModeChange={setMode}
                  onModelChange={(value) => {
                    setModel(value);
                    if (effort && !effortsForModel(models, value).includes(effort)) {
                      setEffort("");
                    }
                  }}
                />
              ) : null}
            </div>
          }
          below={
            <div className={styles.folderStrip}>
              <button
                aria-label={folderButtonLabel}
                className={styles.folderButton}
                onClick={() => void openFolderChooser()}
                title={folderButtonLabel}
                type="button"
              >
                <Folder aria-hidden="true" size={16} strokeWidth={1.8} />
                <span>{folderName}</span>
              </button>
            </div>
          }
          mono={choice === TERMINAL_CHOICE}
          onChange={setCommand}
          onSubmit={submitComposer}
          placeholder={
            choice === TERMINAL_CHOICE
              ? t.conversation.terminalCommandPlaceholder
              : t.conversation.promptPlaceholder
          }
          submitDisabled={
            !bridge ||
            isOpening ||
            (choice !== TERMINAL_CHOICE && (!selectedAgent || !command.trim()))
          }
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

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

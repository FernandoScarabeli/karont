import type { Agent, Conversation, ConversationAttachment } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Folder, TriangleAlert } from "lucide-react";
import {
  type DragEventHandler,
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
import { ComposerMenu, type ComposerMenuOption } from "../components/ComposerMenu/ComposerMenu.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import {
  AttachmentChips,
  AttachmentPicker,
  useComposerAttachments,
} from "./ComposerAttachments.tsx";
import {
  type AgentEffort,
  type AgentModels,
  type ComposerPopoverName,
  ComposerPreferences,
  effortSettingKey,
  fastSettingKey,
  initialEffortForModel,
  modelSettingKey,
} from "./ComposerPreferences.tsx";
import { GitBranchLabel, useGitInfo } from "./GitBranch.tsx";
import styles from "./NewConversationView.module.css";
import { TextType } from "./TextType.tsx";
import { upsertConversation } from "./useConversationIndex.ts";

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const LAST_FOLDER_SETTING = "newConversation.lastFolder";
const TERMINAL_CHOICE = "terminal";
const PERSONAL_FOLDER = "~";

type AgentChoice = typeof TERMINAL_CHOICE | string;
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
  const [activePopover, setActivePopover] = useState<ComposerPopoverName>(null);
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
  const [preferredEffort, setPreferredEffort] = useState<AgentEffort | "">("");
  const [fastMode, setFastMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [greetingName, setGreetingName] = useState<string | null>(null);
  const [openingGreeting] = useState(() => ({
    hour: new Date().getHours(),
    sample: Math.random(),
  }));
  const choiceTouchedRef = useRef(false);
  const folderTouchedRef = useRef(false);
  const titleId = useId();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDialogFormId = useId();

  const updateFolderPath = useCallback((path: string) => {
    setFolderPath(path);
  }, []);

  const saveSetting = useCallback(
    (key: string, value: string | boolean, failureMessage: string) => {
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
      bridge.request("system.userName", {}),
      bridge.request("settings.get", { key: "profile.userNameOverride" }),
    ]).then(
      async ([
        agentsResult,
        agentSettingResult,
        folderSettingResult,
        systemInfoResult,
        userNameResult,
        userNameSettingResult,
      ]) => {
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

        const storedName =
          userNameSettingResult.status === "fulfilled" &&
          typeof userNameSettingResult.value.value === "string"
            ? userNameSettingResult.value.value.trim()
            : "";
        const systemName = userNameResult.status === "fulfilled" ? userNameResult.value.name : null;
        setGreetingName(storedName || systemName);

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
          saveSetting(
            LAST_FOLDER_SETTING,
            PERSONAL_FOLDER,
            t.conversation.settingsFolderSaveFailed,
          );
        }
      },
    );

    return () => {
      mounted = false;
    };
  }, [bridge, saveSetting, updateFolderPath]);

  const selectedAgent = agents.find((agent) => agent.id === choice);
  const selectedTitle = selectedAgent?.name ?? t.conversation.terminal;
  const canAttachFiles = Boolean(
    bridge &&
      selectedAgent &&
      (selectedAgent.id === "claude" || selectedAgent.id === "codex") &&
      !isOpening,
  );
  const composerAttachments = useComposerAttachments(
    canAttachFiles,
    choice === TERMINAL_CHOICE ? "terminal" : "agent",
  );
  const gitPath = folderPath === PERSONAL_FOLDER ? homePath : folderPath;
  const { info: gitInfo } = useGitInfo(gitPath, "new-conversation");
  const isPersonalFolderSelected = folderPath === PERSONAL_FOLDER || folderPath === homePath;
  const folderName = isPersonalFolderSelected ? PERSONAL_FOLDER : getFolderName(folderPath);
  const accessibleFolderPath = isPersonalFolderSelected
    ? (homePath ?? PERSONAL_FOLDER)
    : folderPath;
  const folderButtonLabel = `${t.conversation.folderAccessibleName(accessibleFolderPath)}`;

  const selectedAgentId =
    selectedAgent?.id === "claude" || selectedAgent?.id === "codex" ? selectedAgent.id : null;
  const currentModels = models?.agent === selectedAgentId ? models : null;
  const modelListAvailable = Boolean(currentModels?.models.length);
  const currentModel = currentModels?.models.some((option) => option.id === model) ? model : "";
  const currentEffort = currentModel ? effort : "";

  useEffect(() => {
    if (!bridge || !selectedAgentId) {
      setModels(null);
      setModel("");
      setEffort("");
      setPreferredEffort("");
      setFastMode(false);
      return;
    }
    const agentId = selectedAgentId;
    let mounted = true;
    setModels(null);
    setModel("");
    setEffort("");
    setFastMode(false);
    void Promise.allSettled([
      bridge.request("agent.models", { agent: agentId }),
      bridge.request("settings.get", { key: modelSettingKey(agentId) }),
      bridge.request("settings.get", { key: effortSettingKey(agentId) }),
      bridge.request("settings.get", { key: fastSettingKey(agentId) }),
    ]).then(([modelsResult, storedModelResult, storedEffortResult, storedFastResult]) => {
      if (!mounted) return;
      const result: AgentModels =
        modelsResult.status === "fulfilled"
          ? modelsResult.value
          : { agent: agentId, models: [], efforts: [] };
      setModels(result);
      const storedModel =
        storedModelResult.status === "fulfilled" &&
        typeof storedModelResult.value.value === "string"
          ? storedModelResult.value.value
          : "";
      const initialModel = result.models.some((option) => option.id === storedModel)
        ? storedModel
        : (result.models[0]?.id ?? "");
      setModel(initialModel);
      const knownEffort =
        storedEffortResult.status === "fulfilled" &&
        typeof storedEffortResult.value.value === "string" &&
        (result.efforts?.includes(storedEffortResult.value.value as AgentEffort) ||
          result.models.some((option) =>
            (option.efforts ?? result.efforts ?? []).includes(
              storedEffortResult.value.value as AgentEffort,
            ),
          ))
          ? (storedEffortResult.value.value as AgentEffort)
          : "";
      setPreferredEffort(knownEffort);
      setEffort(initialEffortForModel(result, initialModel, knownEffort));
      const storedFast =
        storedFastResult.status === "fulfilled" && storedFastResult.value.value === true;
      const initialFast =
        storedFast &&
        result.models.find((option) => option.id === initialModel)?.supportsFast === true;
      setFastMode(initialFast);
      if (storedFast && !initialFast)
        saveSetting(fastSettingKey(agentId), false, t.conversation.settingsSaveFailed);
    });
    return () => {
      mounted = false;
    };
  }, [bridge, saveSetting, selectedAgentId]);

  function chooseAgent(option: AgentChoice) {
    choiceTouchedRef.current = true;
    if (option === TERMINAL_CHOICE) composerAttachments.clear();
    setChoice(option);
    setActivePopover(null);
    setError("");
    saveSetting(LAST_AGENT_SETTING, option, t.conversation.settingsSaveFailed);
  }

  function chooseModel(value: string) {
    if (!selectedAgentId) return;
    setModel(value);
    setEffort(initialEffortForModel(currentModels, value, preferredEffort));
    saveSetting(modelSettingKey(selectedAgentId), value, t.conversation.settingsSaveFailed);
    if (currentModels?.models.find((option) => option.id === value)?.supportsFast !== true) {
      setFastMode(false);
      saveSetting(fastSettingKey(selectedAgentId), false, t.conversation.settingsSaveFailed);
    }
  }

  function chooseFastMode(value: boolean) {
    if (!selectedAgentId) return;
    setFastMode(value);
    saveSetting(fastSettingKey(selectedAgentId), value, t.conversation.settingsSaveFailed);
  }

  function chooseEffort(value: AgentEffort | "") {
    if (!selectedAgentId) return;
    setEffort(value);
    if (!value) return;
    setPreferredEffort(value);
    saveSetting(effortSettingKey(selectedAgentId), value, t.conversation.settingsSaveFailed);
  }

  function chooseFolder(path: string) {
    folderTouchedRef.current = true;
    const selectedPath = path === homePath ? PERSONAL_FOLDER : path;
    updateFolderPath(selectedPath);
    setError("");
    saveSetting(LAST_FOLDER_SETTING, selectedPath, t.conversation.settingsFolderSaveFailed);
  }

  function buildChoiceOptions(): ComposerMenuOption[] {
    return [
      ...agents.map((agent) => ({
        id: agent.id,
        selected: agent.id === choice,
        content: (
          <>
            <AgentIcon agentId={agent.id} />
            <span className={styles.agentName}>{agent.name}</span>
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
            <span className={styles.agentName}>{t.conversation.terminal}</span>
          </>
        ),
        onSelect: () => chooseAgent(TERMINAL_CHOICE),
      },
      {
        id: "manage-agents",
        selected: false,
        content: <span>{t.conversation.manageAgents}</span>,
        action: true,
        onSelect: () => {
          setActivePopover(null);
          navigate({ name: "settings", section: "agents" });
        },
      },
    ];
  }

  async function openFolderChooser() {
    setActivePopover(null);
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
    if (!bridge || isOpening || !selectedAgent || (modelListAvailable && !currentModel)) return;
    if (selectedAgent.id !== "claude" && selectedAgent.id !== "codex") {
      setError(t.chat.agentUnavailable);
      return;
    }
    const text = value.trim();
    const files: ConversationAttachment[] = composerAttachments.getRequestAttachments();
    if (!text && files.length === 0) return;
    setError("");
    setIsOpening(true);
    let created: Conversation | null = null;
    try {
      const cwd =
        folderPath === PERSONAL_FOLDER
          ? (homePath ?? (await bridge.request("system.info", {})).homeDir)
          : folderPath;
      const result = await bridge.request("conversation.create", {
        agent: selectedAgent.id,
        cwd,
        mode,
        title: t.conversation.title,
        ...(modelListAvailable && currentModel ? { model: currentModel } : {}),
        ...(effort ? { effort } : {}),
        plan: planMode,
        fast: Boolean(
          fastMode &&
            currentModels?.models.find((option) => option.id === currentModel)?.supportsFast,
        ),
      });
      created = result.conversation;
      upsertConversation(created);
      await bridge.request("conversation.send", {
        id: created.id,
        text: text || " ",
        ...(files.length ? { attachments: files } : {}),
      });
      composerAttachments.clear();
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1
          className={styles.title}
          data-pane-title=""
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          {...dragHandleProps}
        >
          {t.conversation.title}
        </h1>
        {headerActions}
      </header>

      <section aria-labelledby={titleId} className={styles.composerSection}>
        <p className={styles.welcome} data-k-new-conversation-title>
          {t.conversation.welcomeTitle(greetingName, openingGreeting.hour, openingGreeting.sample)}
        </p>
        {composerAttachments.isPreparing ? (
          <p className={styles.preparing} role="status">
            {t.chat.preparingAttachments}
          </p>
        ) : null}
        {composerAttachments.error ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{composerAttachments.error}</span>
          </p>
        ) : null}
        <Composer
          disabled={choice !== TERMINAL_CHOICE && !selectedAgent}
          ariaDescription={t.conversation.composerKeyboardDescription}
          leading={
            <div className={styles.controls}>
              {selectedAgent && (selectedAgent.id === "claude" || selectedAgent.id === "codex") ? (
                <AttachmentPicker
                  disabled={!canAttachFiles}
                  onFiles={composerAttachments.addFiles}
                />
              ) : null}
              <ComposerMenu
                label={t.conversation.agentLabel}
                onOpenChange={(open) => setActivePopover(open ? "agent" : null)}
                open={activePopover === "agent"}
                options={choiceOptions}
                triggerClassName={styles.selectorButton}
                triggerContent={
                  <>
                    <AgentIcon agentId={choice} />
                    <span className={styles.agentName}>{selectedTitle}</span>
                  </>
                }
                triggerLabel={`${t.conversation.agentLabel}: ${selectedTitle}`}
              />
              {selectedAgent && (selectedAgent.id === "claude" || selectedAgent.id === "codex") ? (
                <ComposerPreferences
                  activePopover={activePopover}
                  effort={currentEffort}
                  fastMode={fastMode}
                  mode={mode}
                  model={currentModel}
                  models={currentModels}
                  planMode={planMode}
                  disabled={isOpening}
                  onActivePopoverChange={setActivePopover}
                  onEffortChange={chooseEffort}
                  onFastModeChange={chooseFastMode}
                  onModeChange={setMode}
                  onModelChange={chooseModel}
                  onPlanModeChange={setPlanMode}
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
              <span className={styles.branchSlot}>
                <GitBranchLabel info={gitInfo} />
              </span>
            </div>
          }
          attachments={
            <AttachmentChips
              attachments={composerAttachments.attachments}
              onRemove={composerAttachments.remove}
            />
          }
          mono={choice === TERMINAL_CHOICE}
          onChange={setCommand}
          onDragEnter={composerAttachments.onDragEnter}
          onDragLeave={composerAttachments.onDragLeave}
          onDragOver={composerAttachments.onDragOver}
          onDrop={composerAttachments.onDrop}
          onPaste={composerAttachments.onPaste}
          onSubmit={submitComposer}
          placeholder={
            choice === TERMINAL_CHOICE
              ? t.conversation.terminalCommandPlaceholder
              : t.conversation.promptPlaceholder
          }
          animatedPlaceholder={choice !== TERMINAL_CHOICE && selectedAgent ? <TextType /> : null}
          submitDisabled={
            !bridge ||
            isOpening ||
            composerAttachments.isPreparing ||
            (choice !== TERMINAL_CHOICE &&
              (!selectedAgent ||
                (modelListAvailable && !currentModel) ||
                (!command.trim() && composerAttachments.attachments.length === 0)))
          }
          dragActive={composerAttachments.isDragging}
          dropMessage={t.chat.dropAttachments}
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

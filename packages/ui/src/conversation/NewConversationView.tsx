import type {
  Agent,
  AgentCapabilities,
  ComposerSkill,
  Conversation,
  ConversationAttachment,
  ResultOf,
  Worktree,
} from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { Folder, TriangleAlert } from "lucide-react";
import {
  type DragEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { findChatAgents } from "../agents/chatAgents.ts";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Composer, type ComposerAutocompleteOption } from "../components/Composer/Composer.tsx";
import { ComposerMenu, type ComposerMenuOption } from "../components/ComposerMenu/ComposerMenu.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { resolveInitialAgent, TERMINAL_CHOICE } from "../projects/initialAgent.ts";
import { getProjectIcon } from "../projects/projectIcons.ts";
import { useProject } from "../projects/useProjects.ts";
import { upsertWorktree } from "../projects/useWorktrees.ts";
import { shouldOfferSeparateCopy } from "../projects/worktreeOffer.ts";
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
import {
  type ComposerShortcutTrigger,
  consumePendingComposerCaret,
  detectComposerShortcut,
  findMentionedSkills,
  fuzzyFilter,
  insertComposerShortcut,
  removeComposerCommand,
} from "./composerShortcuts.ts";
import { GitBranchLabel, useGitInfo } from "./GitBranch.tsx";
import { resolveModelId } from "./modelCatalog.ts";
import styles from "./NewConversationView.module.css";
import { upsertConversation, useConversationIndex } from "./useConversationIndex.ts";

type ComposerFile = ResultOf<"composer.files">["files"][number];

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const LAST_FOLDER_SETTING = "newConversation.lastFolder";
const PERSONAL_FOLDER = "~";

type AgentChoice = typeof TERMINAL_CHOICE | string;
export function NewConversationView({
  titleRef,
  headerActions,
  dragHandleProps,
  projectId,
}: {
  /** Projeto da nova conversa. Se ele não existir mais, a tela vira conversa solta. */
  projectId?: string;
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
  const { project, loading: projectsLoading } = useProject(projectId);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [manualChoice, setManualChoice] = useState<AgentChoice | null>(null);
  const [lastUsedAgent, setLastUsedAgent] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState(PERSONAL_FOLDER);
  const [homePath, setHomePath] = useState<string>();
  const [command, setCommand] = useState("");
  const [caretRequest, setCaretRequest] = useState(0);
  const [activePopover, setActivePopover] = useState<ComposerPopoverName>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogPath, setFolderDialogPath] = useState("");
  const [folderDialogError, setFolderDialogError] = useState("");
  const [error, setError] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [creatingCopy, setCreatingCopy] = useState(false);
  const [offerError, setOfferError] = useState("");
  const offerCopyRef = useRef<Worktree | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [agentsError, setAgentsError] = useState(false);
  const [models, setModels] = useState<AgentModels | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [shortcutTrigger, setShortcutTrigger] = useState<ComposerShortcutTrigger | null>(null);
  const [activeShortcutIndex, setActiveShortcutIndex] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<ComposerFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<ComposerSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
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
  const folderTouchedRef = useRef(false);
  const hasProjectRef = useRef(Boolean(projectId));
  const titleId = useId();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const composerSectionRef = useRef<HTMLElement>(null);
  const pendingComposerCaretRef = useRef<number | null>(null);
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
          setAgents(findChatAgents(agentsResult.value.agents));
          setAgentsLoaded(true);
        } else {
          setAgentsError(true);
        }

        if (
          agentSettingResult.status === "fulfilled" &&
          typeof agentSettingResult.value.value === "string"
        ) {
          setLastUsedAgent(agentSettingResult.value.value);
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
          // Dentro de um projeto a pasta salva não é usada nem mexida.
          if (!hasProjectRef.current) {
            saveSetting(
              LAST_FOLDER_SETTING,
              PERSONAL_FOLDER,
              t.conversation.settingsFolderSaveFailed,
            );
          }
        }
      },
    );

    return () => {
      mounted = false;
    };
  }, [bridge, saveSetting, updateFolderPath]);

  const choice = resolveInitialAgent({
    manualChoice,
    projectDefault: project?.defaultAgent,
    lastUsed: lastUsedAgent,
    foundAgentIds: agentsLoaded ? agents.map((agent) => agent.id) : null,
  });
  const selectedAgent = agents.find((agent) => agent.id === choice);
  const selectedAgentForShortcuts = selectedAgent?.id;
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
  // Com projeto carregado, a pasta é a dele e não dá para trocar.
  const workingPath = project ? project.path : folderPath;
  const gitPath = workingPath === PERSONAL_FOLDER ? homePath : workingPath;
  const suggestionCwd = workingPath === PERSONAL_FOLDER ? homePath : workingPath;
  const { info: gitInfo } = useGitInfo(gitPath, "new-conversation");
  const activeConversations = useConversationIndex().conversations;
  const isPersonalFolderSelected =
    !project && (folderPath === PERSONAL_FOLDER || folderPath === homePath);
  const folderName = isPersonalFolderSelected ? PERSONAL_FOLDER : getFolderName(workingPath);
  const accessibleFolderPath = isPersonalFolderSelected
    ? (homePath ?? PERSONAL_FOLDER)
    : workingPath;
  const folderButtonLabel = `${t.conversation.folderAccessibleName(accessibleFolderPath)}`;

  const selectedAgentId =
    selectedAgent?.id === "claude" || selectedAgent?.id === "codex" ? selectedAgent.id : null;
  const currentModels = models?.agent === selectedAgentId ? models : null;
  const modelListAvailable = Boolean(currentModels?.models.length);
  const currentModel = currentModels?.models.some((option) => option.id === model) ? model : "";
  const currentEffort = currentModel ? effort : "";

  useEffect(() => {
    if (!bridge || !selectedAgent) {
      setCapabilities(null);
      setCapabilitiesLoading(false);
      return;
    }
    let mounted = true;
    setCapabilities(null);
    setCapabilitiesLoading(true);
    void bridge
      .request("agent.capabilities", { agent: selectedAgent.id })
      .then((result) => {
        if (mounted) {
          setCapabilities(result.capabilities);
          setCapabilitiesLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setCapabilities(null);
          setCapabilitiesLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [bridge, selectedAgent]);

  const fileQuery = shortcutTrigger?.type === "file" ? shortcutTrigger.query : null;
  const shortcutLabels = t.chat.shortcutSuggestions;
  const shortcutCommands = useMemo(
    () =>
      (
        [
          ["plan", shortcutLabels.commandsByName.plan],
          ["model", shortcutLabels.commandsByName.model],
          ["effort", shortcutLabels.commandsByName.effort],
          ["access", shortcutLabels.commandsByName.access],
          ["new", shortcutLabels.commandsByName.new],
        ] as const
      ).map(([command, value]) => ({
        command,
        id: `command:${command}`,
        type: "command" as const,
        primary: value,
        secondary: shortcutLabels.commandDescriptions[command],
      })),
    [shortcutLabels],
  );
  const shortcutOptions = useMemo<ComposerAutocompleteOption[]>(() => {
    if (!shortcutTrigger) return [];
    if (shortcutTrigger.type === "file") {
      return fileSuggestions.map((file) => ({
        id: `file:${file.path}`,
        type: "file",
        primary: file.name,
        secondary: file.path.slice(0, Math.max(0, file.path.length - file.name.length)),
        detail: file.path,
      }));
    }
    if (shortcutTrigger.type === "skill") {
      return fuzzyFilter(
        skillCatalog,
        shortcutTrigger.query,
        (skill) => `${skill.name} ${skill.description}`,
      ).map((skill) => ({
        id: `skill:${skill.name}`,
        type: "skill",
        primary: `$${skill.name}`,
        secondary: skill.description,
      }));
    }
    return fuzzyFilter(
      shortcutCommands,
      shortcutTrigger.query,
      (command) => `${command.primary} ${command.secondary}`,
    );
  }, [fileSuggestions, shortcutCommands, shortcutTrigger, skillCatalog]);
  const shortcutLoading =
    shortcutTrigger?.type === "file"
      ? filesLoading
      : shortcutTrigger?.type === "skill"
        ? skillsLoading || (capabilitiesLoading && capabilities === null)
        : false;

  useEffect(() => {
    if (fileQuery === null || !bridge || !suggestionCwd) {
      setFileSuggestions([]);
      setFilesLoading(false);
      return;
    }
    let active = true;
    setFilesLoading(true);
    const timer = window.setTimeout(() => {
      void bridge
        .request("composer.files", { cwd: suggestionCwd, query: fileQuery })
        .then((result) => {
          if (active) setFileSuggestions(result.files.slice(0, 50));
        })
        .catch(() => {
          if (active) setFileSuggestions([]);
        })
        .finally(() => {
          if (active) setFilesLoading(false);
        });
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [bridge, fileQuery, suggestionCwd]);

  useEffect(() => {
    setSkillCatalog([]);
    if (!bridge || !selectedAgentForShortcuts || !suggestionCwd || capabilities?.skills !== true) {
      setSkillsLoading(false);
      return;
    }
    let active = true;
    setSkillsLoading(true);
    void bridge
      .request("composer.skills", { agent: selectedAgentForShortcuts, cwd: suggestionCwd })
      .then((result) => {
        if (active) setSkillCatalog(result.skills);
      })
      .catch(() => {
        if (active) setSkillCatalog([]);
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, capabilities?.skills, selectedAgentForShortcuts, suggestionCwd]);

  useLayoutEffect(() => {
    if (caretRequest === 0) return;
    const textarea = composerSectionRef.current?.querySelector("textarea");
    if (!textarea) return;
    const caret = consumePendingComposerCaret(pendingComposerCaretRef);
    if (caret === null) return;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [caretRequest]);

  useEffect(() => {
    if (
      !capabilitiesLoading &&
      capabilities?.skills !== true &&
      shortcutTrigger?.type === "skill"
    ) {
      setShortcutTrigger(null);
    }
  }, [capabilities?.skills, capabilitiesLoading, shortcutTrigger?.type]);

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
      const initialModel = resolveModelId(result, storedModel);
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
    if (option === TERMINAL_CHOICE) composerAttachments.clear();
    setManualChoice(option);
    setLastUsedAgent(option);
    setShortcutTrigger(null);
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
        ...(workingPath === PERSONAL_FOLDER ? {} : { cwd: workingPath }),
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

  async function openAgentConversation(
    value: string,
    options: { skipOffer?: boolean; worktree?: Worktree; onError?: (message: string) => void } = {},
  ) {
    const reportError = options.onError ?? setError;
    if (!bridge || isOpening || !selectedAgent || (modelListAvailable && !currentModel)) return;
    if (selectedAgent.id !== "claude" && selectedAgent.id !== "codex") {
      setError(t.chat.agentUnavailable);
      return;
    }
    const text = value.trim();
    const selectedSkills = findMentionedSkills(
      text,
      skillCatalog,
      capabilities?.maxSkillsPerMessage ?? 8,
    );
    const files: ConversationAttachment[] = composerAttachments.getRequestAttachments();
    if (!text && files.length === 0) return;
    if (
      !options.skipOffer &&
      !options.worktree &&
      shouldOfferSeparateCopy({
        projectId: project?.id,
        isTerminal: false,
        usesGit: Boolean(gitInfo && (gitInfo.branch || gitInfo.detached)),
        conversations: activeConversations,
      })
    ) {
      setOfferError("");
      setOfferOpen(true);
      return;
    }
    setError("");
    setIsOpening(true);
    let created: Conversation | null = null;
    try {
      const cwd =
        options.worktree?.path ??
        (workingPath === PERSONAL_FOLDER
          ? (homePath ?? (await bridge.request("system.info", {})).homeDir)
          : workingPath);
      const result = await bridge.request("conversation.create", {
        agent: selectedAgent.id,
        cwd,
        ...(project ? { projectId: project.id } : {}),
        ...(options.worktree ? { worktreeId: options.worktree.id } : {}),
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
        ...(selectedSkills.length ? { skills: selectedSkills } : {}),
      });
      composerAttachments.clear();
      setOfferOpen(false);
      navigate({ name: "conversation", id: created.id });
    } catch (openError) {
      reportError(
        openError instanceof BridgeError && openError.message
          ? openError.message
          : t.chat.createFailed,
      );
    } finally {
      setIsOpening(false);
    }
  }

  function closeOffer() {
    if (creatingCopy || isOpening) return;
    setOfferOpen(false);
    setOfferError("");
  }

  function continueInProjectFolder() {
    setOfferOpen(false);
    setOfferError("");
    void openAgentConversation(command, { skipOffer: true });
  }

  async function chooseSeparateCopy() {
    if (!bridge || !project || creatingCopy || isOpening) return;
    setOfferError("");
    let worktree = offerCopyRef.current;
    if (!worktree) {
      setCreatingCopy(true);
      try {
        worktree = (await bridge.request("worktrees.create", { projectId: project.id })).worktree;
        offerCopyRef.current = worktree;
        upsertWorktree(worktree);
      } catch (createError) {
        setOfferError(
          createError instanceof BridgeError && createError.message
            ? createError.message
            : t.worktrees.createCopyFailed,
        );
        return;
      } finally {
        setCreatingCopy(false);
      }
    }
    await openAgentConversation(command, { worktree, onError: setOfferError });
  }

  function submitComposer() {
    if (choice === TERMINAL_CHOICE) void openTerminal(command);
    else void openAgentConversation(command);
  }

  function updateShortcutAtCaret(value: string, caret: number) {
    const supportsSkills = capabilitiesLoading || capabilities?.skills === true;
    const next =
      choice === TERMINAL_CHOICE ? null : detectComposerShortcut(value, caret, supportsSkills);
    const isSame =
      shortcutTrigger?.type === next?.type &&
      shortcutTrigger?.start === next?.start &&
      shortcutTrigger?.caret === next?.caret &&
      shortcutTrigger?.tokenEnd === next?.tokenEnd &&
      shortcutTrigger?.query === next?.query;
    if (!isSame) {
      setActiveShortcutIndex(0);
      setShortcutTrigger(next);
    }
  }

  function applyShortcutText(value: string, caret: number) {
    pendingComposerCaretRef.current = caret;
    setCaretRequest((current) => current + 1);
    setCommand(value);
    setShortcutTrigger(null);
  }

  function selectComposerSuggestion(option: ComposerAutocompleteOption) {
    if (!shortcutTrigger) return;
    if (shortcutTrigger.type === "file" && option.type === "file" && option.detail) {
      const result = insertComposerShortcut(command, shortcutTrigger, `@${option.detail} `);
      applyShortcutText(result.value, result.caret);
      return;
    }
    if (shortcutTrigger.type === "skill" && option.type === "skill") {
      const skill = skillCatalog.find((entry) => option.id === `skill:${entry.name}`);
      if (!skill) return;
      const result = insertComposerShortcut(command, shortcutTrigger, `$${skill.name} `);
      applyShortcutText(result.value, result.caret);
      return;
    }
    if (shortcutTrigger.type !== "command" || option.type !== "command") return;
    const shortcutCommand = shortcutCommands.find((entry) => entry.id === option.id)?.command;
    if (!shortcutCommand) return;
    const result = removeComposerCommand(command, shortcutTrigger);
    applyShortcutText(result.value, result.caret);

    if (shortcutCommand === "plan") setPlanMode((current) => !current);
    else if (shortcutCommand === "model") setActivePopover("model");
    else if (shortcutCommand === "effort") setActivePopover("effort");
    else if (shortcutCommand === "access") setActivePopover("config");
    else if (shortcutCommand === "new") {
      composerAttachments.clear();
      navigate(
        project
          ? { name: "new-conversation", projectId: project.id }
          : { name: "new-conversation" },
      );
    }
  }

  const composerAutocomplete = shortcutTrigger
    ? {
        open: true,
        label:
          shortcutTrigger.type === "file"
            ? shortcutLabels.files
            : shortcutTrigger.type === "skill"
              ? shortcutLabels.skills
              : shortcutLabels.commands,
        options: shortcutOptions,
        activeIndex: activeShortcutIndex,
        loading: shortcutLoading,
        loadingLabel:
          shortcutTrigger.type === "file"
            ? shortcutLabels.loadingFiles
            : shortcutTrigger.type === "skill"
              ? shortcutLabels.loadingSkills
              : shortcutLabels.loadingCommands,
        emptyLabel: shortcutLabels.nothingFound,
        onActiveIndexChange: setActiveShortcutIndex,
        onSelect: selectComposerSuggestion,
        onClose: () => setShortcutTrigger(null),
      }
    : undefined;
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

      <section
        aria-labelledby={titleId}
        className={styles.composerSection}
        ref={composerSectionRef}
      >
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
                tooltipAlign="start"
                tooltipLabel={t.chat.agentTooltip(selectedTitle)}
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
              {project ? (
                // biome-ignore lint/a11y/useSemanticElements: o nome acessível exige role explícito num contêiner.
                <div
                  aria-label={t.projects.stripAccessibleName(project.name, project.path)}
                  className={styles.projectLabel}
                  role="group"
                  title={project.path}
                >
                  <ProjectStripIcon name={project.icon} />
                  <span>{project.name}</span>
                </div>
              ) : (
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
              )}
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
          onCaretChange={updateShortcutAtCaret}
          onDragEnter={composerAttachments.onDragEnter}
          onDragLeave={composerAttachments.onDragLeave}
          onDragOver={composerAttachments.onDragOver}
          onDrop={composerAttachments.onDrop}
          onPaste={composerAttachments.onPaste}
          onSubmit={submitComposer}
          placeholder={
            choice === TERMINAL_CHOICE
              ? t.conversation.terminalCommandPlaceholder
              : t.conversation.promptPlaceholder(capabilities?.skills === true)
          }
          autocomplete={composerAutocomplete}
          submitDisabled={
            !bridge ||
            isOpening ||
            (Boolean(projectId) && projectsLoading) ||
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
          submitTooltipLabel={
            choice === TERMINAL_CHOICE ? t.conversation.openTerminal : t.chat.sendTooltip
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
        description={t.worktrees.offerDescription}
        footer={
          <>
            <Button
              disabled={creatingCopy || isOpening}
              onClick={() => void chooseSeparateCopy()}
              ref={copyButtonRef}
              variant="primary"
            >
              {creatingCopy ? t.worktrees.creatingCopy : t.worktrees.useCopy}
            </Button>
            <Button
              disabled={creatingCopy || isOpening}
              onClick={continueInProjectFolder}
              variant="secondary"
            >
              {t.worktrees.keepFolder}
            </Button>
            <Button disabled={creatingCopy || isOpening} onClick={closeOffer} variant="ghost">
              {t.worktrees.cancel}
            </Button>
          </>
        }
        initialFocusRef={copyButtonRef as RefObject<HTMLElement | null>}
        onClose={closeOffer}
        open={offerOpen}
        title={t.worktrees.offerTitle}
      >
        <p className={styles.offerNotice}>{t.worktrees.offerNotice}</p>
        {offerError ? (
          <p className={styles.offerError} role="alert">
            <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{offerError}</span>
          </p>
        ) : null}
      </Dialog>

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

function ProjectStripIcon({ name }: { name: string }) {
  const Icon = getProjectIcon(name);
  return <Icon aria-hidden="true" size={16} strokeWidth={1.8} />;
}

function getFolderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

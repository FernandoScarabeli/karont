import { type Agent, BridgeError, methods, ONBOARDING_COMPLETED_SETTING } from "@karont/contract";
import { Check, CircleAlert, Plus, SquareTerminal, X } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { findChatAgents } from "../agents/chatAgents.ts";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import scrollAreaStyles from "../components/ScrollArea/ScrollArea.module.css";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import { Avatar } from "../profile/Avatar.tsx";
import { prepareAvatar } from "../profile/avatar.ts";
import { useProfile } from "../profile/ProfileContext.tsx";
import { TERMINAL_CHOICE } from "../projects/initialAgent.ts";
import { DEFAULT_PROJECT_ICON } from "../projects/projectIcons.ts";
import { upsertProject } from "../projects/useProjects.ts";
import { getActiveWorkspaceId } from "../projects/useWorkspaces.ts";
import { BrandMark } from "../shell/BrandMark.tsx";
import styles from "./Onboarding.module.css";
import { useOnboarding } from "./OnboardingContext.tsx";
import {
  findProjectByPath,
  groupOtherAgents,
  initialChoice,
  isAbsolutePath,
  ONBOARDING_STEP_COUNT,
  projectNameFromPath,
  validChoice,
} from "./steps.ts";

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const LAST_FOLDER_SETTING = "newConversation.lastFolder";

type AgentsPhase = "loading" | "ready" | "error";
type AddErrors = { name?: string; command?: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof BridgeError && error.message
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : fallback;
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
      <span>{children}</span>
    </p>
  );
}

/** Fundo opaco enquanto o serviço não disse se é a primeira abertura; a tela em si só aparece ativa. */
export function Onboarding() {
  const { active, pending } = useOnboarding();
  if (active) return <OnboardingScreen />;
  if (pending) return <div aria-hidden="true" className={styles.cover} />;
  return null;
}

function OnboardingScreen() {
  const bridge = useMemo(() => getBridge(), []);
  const { mode, finish, close } = useOnboarding();
  const { navigate } = useNavigation();
  const profile = useProfile();
  const [step, setStep] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsPhase, setAgentsPhase] = useState<AgentsPhase>(() => (bridge ? "loading" : "error"));
  const [chosen, setChosen] = useState<string | null>(null);
  const choice = validChoice(chosen ?? initialChoice(agents), agents);

  const [folderPath, setFolderPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectError, setProjectError] = useState("");

  const [draftName, setDraftName] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);

  const loadAgents = useCallback(async () => {
    if (!bridge) return;
    setAgentsPhase("loading");
    try {
      const result = await bridge.request("agents.list", {});
      setAgents(result.agents);
      setAgentsPhase("ready");
    } catch {
      setAgentsPhase("error");
    }
  }, [bridge]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  // O foco vai para o título de cada passo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: o passo é o gatilho.
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  // Reaberta: Esc sai sem mudar nada, e o foco volta a quem abriu.
  useEffect(() => {
    if (mode !== "reopen") return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [mode, close]);

  async function complete(path: string | null) {
    if (busy) return;
    if (!bridge) {
      setProjectError(t.onboarding.noBridge);
      return;
    }
    setBusy(true);
    setProjectError("");
    let stage: "project" | "finish" = "project";
    try {
      let projectId: string | undefined;
      if (path) {
        const { projects } = await bridge.request("projects.list", {});
        const existing = findProjectByPath(projects, path);
        if (existing) {
          projectId = existing.id;
        } else {
          const workspaceId = getActiveWorkspaceId();
          const { project } = await bridge.request("projects.create", {
            name: projectNameFromPath(path) || path.slice(0, 80),
            icon: DEFAULT_PROJECT_ICON,
            path,
            ...(workspaceId ? { workspaceId } : {}),
            ...(choice !== TERMINAL_CHOICE ? { defaultAgent: choice } : {}),
          });
          upsertProject(project);
          projectId = project.id;
        }
      }
      stage = "finish";
      await bridge.request("settings.set", { key: LAST_AGENT_SETTING, value: choice });
      if (!path) {
        const info = await bridge.request("system.info", {});
        await bridge.request("settings.set", { key: LAST_FOLDER_SETTING, value: info.homeDir });
      }
      await bridge.request("settings.set", {
        key: ONBOARDING_COMPLETED_SETTING,
        value: new Date().toISOString(),
      });
      finish();
      navigate(projectId ? { name: "new-conversation", projectId } : { name: "new-conversation" });
    } catch (error) {
      setProjectError(
        errorMessage(
          error,
          stage === "project" ? t.projects.saveFailed : t.onboarding.finishFailed,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueFromProfile() {
    if (savingName) return;
    const next = (draftName ?? profile.name).trim();
    if (next !== profile.name) {
      setSavingName(true);
      setNameError("");
      try {
        await profile.saveName(next);
      } catch (error) {
        setNameError(errorMessage(error, t.settings.userNameSaveFailed));
        setSavingName(false);
        return;
      }
      setSavingName(false);
    }
    setDraftName(null);
    setStep(3);
  }

  const pickerMissing = !bridge?.pickFolder;
  const trimmedPath = folderPath.trim();
  const canCreate = trimmedPath !== "" && !busy;

  function createFromFolder() {
    if (!trimmedPath) return;
    if (!isAbsolutePath(trimmedPath)) {
      setProjectError(t.projects.folderMustBeAbsolute);
      return;
    }
    void complete(trimmedPath);
  }

  return (
    <div
      aria-label={t.onboarding.dialogLabel}
      aria-modal="true"
      className={styles.root}
      role="dialog"
    >
      <header className={styles.header}>
        <span className={styles.brand}>
          <BrandMark />
          <span className={styles.brandName}>{t.brand.name}</span>
        </span>
        {mode === "reopen" ? (
          <Button
            iconStart={<X aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={close}
            size="sm"
            variant="ghost"
          >
            {t.onboarding.close}
          </Button>
        ) : null}
      </header>

      <div className={`${styles.body} ${scrollAreaStyles.scrollArea}`}>
        <section aria-labelledby={titleId} className={styles.step} key={step}>
          {step === 0 ? (
            <>
              <h1 className={styles.welcomeTitle} id={titleId} ref={titleRef} tabIndex={-1}>
                {t.onboarding.welcomeTitle}
              </h1>
              <p className={styles.lead}>{t.onboarding.welcomeText}</p>
              <div className={styles.actions}>
                <Button onClick={() => setStep(1)} size="lg" variant="primary">
                  {t.onboarding.start}
                </Button>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <AgentsStep
              agents={agents}
              choice={choice}
              onChoose={setChosen}
              onReload={loadAgents}
              onReplace={(next) => {
                setAgents(next);
                setAgentsPhase("ready");
              }}
              phase={agentsPhase}
              titleId={titleId}
              titleRef={titleRef}
            />
          ) : null}

          {step === 2 ? (
            <ProfileStep
              draftName={draftName ?? profile.name}
              error={nameError}
              onDraftName={setDraftName}
              titleId={titleId}
              titleRef={titleRef}
            />
          ) : null}

          {step === 3 ? (
            <ProjectStep
              busy={busy}
              error={projectError}
              folderPath={folderPath}
              onFolder={(path) => {
                setFolderPath(path);
                setProjectError("");
              }}
              onSkip={() => void complete(null)}
              pickerMissing={pickerMissing}
              titleId={titleId}
              titleRef={titleRef}
            />
          ) : null}
        </section>
      </div>

      <footer className={styles.footer}>
        <span className={styles.stepLabel}>
          {t.onboarding.stepOf(step + 1, ONBOARDING_STEP_COUNT)}
        </span>
        {step > 0 ? (
          <div className={styles.footerActions}>
            <Button
              disabled={busy || savingName}
              onClick={() => setStep(step - 1)}
              variant="secondary"
            >
              {t.onboarding.back}
            </Button>
            {step === 1 ? (
              <Button onClick={() => setStep(2)} variant="primary">
                {t.onboarding.next}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                disabled={savingName}
                onClick={() => void continueFromProfile()}
                variant="primary"
              >
                {t.onboarding.next}
              </Button>
            ) : null}
            {step === 3 && trimmedPath ? (
              <Button disabled={!canCreate} onClick={createFromFolder} variant="primary">
                {busy ? t.onboarding.creating : t.onboarding.createAndStart}
              </Button>
            ) : null}
          </div>
        ) : null}
      </footer>
    </div>
  );
}

type StepHeadProps = { titleId: string; titleRef: React.RefObject<HTMLHeadingElement | null> };

function AgentsStep({
  agents,
  choice,
  onChoose,
  onReload,
  onReplace,
  phase,
  titleId,
  titleRef,
}: StepHeadProps & {
  agents: Agent[];
  choice: string;
  onChoose: (id: string) => void;
  onReload: () => Promise<void>;
  onReplace: (agents: Agent[]) => void;
  phase: AgentsPhase;
}) {
  const bridge = useMemo(() => getBridge(), []);
  const groupName = useId();
  const formId = useId();
  const [detecting, setDetecting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [command, setCommand] = useState("");
  const [addErrors, setAddErrors] = useState<AddErrors>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const chatAgents = findChatAgents(agents);
  const { foundWithoutChat, missing } = groupOtherAgents(agents);

  async function detect() {
    if (!bridge || detecting) return;
    setDetecting(true);
    setActionError("");
    try {
      const result = await bridge.request("agents.detect", {});
      onReplace(result.agents);
    } catch (error) {
      setActionError(errorMessage(error, t.settings.detectFailed));
    } finally {
      setDetecting(false);
    }
  }

  async function addAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge || adding) return;
    const parsed = methods["agents.add"].params.safeParse({ name: agentName, command });
    if (!parsed.success) {
      const errors: AddErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name") errors.name = t.settings.invalidName;
        if (field === "command") errors.command = t.settings.invalidCommand;
      }
      setAddErrors(errors);
      (errors.name ? nameInputRef : commandInputRef).current?.focus();
      return;
    }
    setAddErrors({});
    setAdding(true);
    try {
      await bridge.request("agents.add", parsed.data);
      setAddOpen(false);
      setAgentName("");
      setCommand("");
      await onReload();
    } catch (error) {
      setAddErrors({ command: errorMessage(error, t.settings.addFailed) });
      commandInputRef.current?.focus();
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <h2 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>
        {t.onboarding.agentsTitle}
      </h2>
      <p className={styles.lead}>{t.onboarding.loginNote}</p>

      {phase === "loading" ? (
        <p className={styles.note} role="status">
          {t.settings.loadingAgents}
        </p>
      ) : null}
      {phase === "error" ? (
        <div className={styles.inline}>
          <ErrorLine>{t.settings.loadError}</ErrorLine>
          <Button onClick={() => void onReload()} size="sm" variant="secondary">
            {t.settings.retry}
          </Button>
        </div>
      ) : null}
      {actionError ? <ErrorLine>{actionError}</ErrorLine> : null}

      {phase === "ready" && chatAgents.length === 0 ? (
        <p className={styles.note}>{t.onboarding.noAgents}</p>
      ) : null}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t.onboarding.startWith}</legend>
        <div className={styles.choices}>
          {chatAgents.map((agent) => (
            <label className={styles.choice} key={agent.id}>
              <input
                checked={choice === agent.id}
                className={styles.radio}
                name={groupName}
                onChange={() => onChoose(agent.id)}
                type="radio"
                value={agent.id}
              />
              <AgentIcon agentId={agent.id} />
              <span className={styles.choiceName}>{agent.name}</span>
              {choice === agent.id ? (
                <Check
                  aria-hidden="true"
                  className={styles.choiceCheck}
                  size={16}
                  strokeWidth={2}
                />
              ) : null}
            </label>
          ))}
          <label className={styles.choice}>
            <input
              checked={choice === TERMINAL_CHOICE}
              className={styles.radio}
              name={groupName}
              onChange={() => onChoose(TERMINAL_CHOICE)}
              type="radio"
              value={TERMINAL_CHOICE}
            />
            <SquareTerminal aria-hidden="true" size={16} strokeWidth={1.8} />
            <span className={styles.choiceName}>{t.conversation.terminal}</span>
            {choice === TERMINAL_CHOICE ? (
              <Check aria-hidden="true" className={styles.choiceCheck} size={16} strokeWidth={2} />
            ) : null}
          </label>
        </div>
      </fieldset>

      {foundWithoutChat.length > 0 ? (
        <ul aria-label={t.onboarding.otherClis} className={styles.statusList}>
          {foundWithoutChat.map((agent) => (
            <li className={styles.statusItem} key={agent.id}>
              <AgentIcon agentId={agent.id} />
              <span className={styles.statusName}>{agent.name}</span>
              <span className={styles.statusMark}>
                <Check aria-hidden="true" size={14} strokeWidth={2} />
                {t.onboarding.found}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {missing.length > 0 ? (
        <section
          aria-label={t.onboarding.missingClis}
          className={`${styles.missing} ${scrollAreaStyles.scrollArea}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: região com rolagem própria precisa de foco no teclado.
          tabIndex={0}
        >
          <ul className={styles.statusList}>
            {missing.map((agent) => (
              <li className={`${styles.statusItem} ${styles.dim}`} key={agent.id}>
                <AgentIcon agentId={agent.id} />
                <span className={styles.statusName}>{agent.name}</span>
                <span className={styles.statusMark}>
                  <X aria-hidden="true" size={14} strokeWidth={2} />
                  {t.onboarding.notFound}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.actionsRow}>
        <Button disabled={detecting} onClick={() => void detect()} size="sm" variant="secondary">
          {detecting ? t.settings.detecting : t.settings.detectAgain}
        </Button>
        {!addOpen ? (
          <Button
            iconStart={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={() => {
              setAddErrors({});
              setAddOpen(true);
              window.requestAnimationFrame(() => nameInputRef.current?.focus());
            }}
            size="sm"
            variant="ghost"
          >
            {t.settings.addAnotherCli}
          </Button>
        ) : null}
      </div>

      {addOpen ? (
        <form
          className={styles.addForm}
          id={formId}
          noValidate
          onSubmit={(event) => void addAgent(event)}
        >
          <TextField
            autoComplete="off"
            error={addErrors.name}
            label={t.settings.name}
            onChange={(event) => {
              setAgentName(event.currentTarget.value);
              setAddErrors((current) => ({ ...current, name: undefined }));
            }}
            placeholder={t.settings.namePlaceholder}
            ref={nameInputRef}
            value={agentName}
          />
          <TextField
            autoComplete="off"
            error={addErrors.command}
            hint={t.settings.commandHint}
            label={t.settings.command}
            mono
            onChange={(event) => {
              setCommand(event.currentTarget.value);
              setAddErrors((current) => ({ ...current, command: undefined }));
            }}
            ref={commandInputRef}
            spellCheck={false}
            value={command}
          />
          <div className={styles.actionsRow}>
            <Button
              disabled={adding}
              onClick={() => setAddOpen(false)}
              size="sm"
              variant="secondary"
            >
              {t.settings.cancel}
            </Button>
            <Button aria-disabled={adding} size="sm" type="submit" variant="primary">
              {adding ? t.settings.adding : t.settings.add}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function ProfileStep({
  draftName,
  error,
  onDraftName,
  titleId,
  titleRef,
}: StepHeadProps & {
  draftName: string;
  error: string;
  onDraftName: (name: string) => void;
}) {
  const profile = useProfile();
  const ready = profile.status === "ready";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !ready || savingAvatar) return;
    setAvatarError("");
    setSavingAvatar(true);
    try {
      await profile.saveAvatar(await prepareAvatar(file));
    } catch (failure) {
      setAvatarError(errorMessage(failure, t.profile.avatarSaveFailed));
    } finally {
      setSavingAvatar(false);
    }
  }

  return (
    <>
      <h2 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>
        {t.onboarding.profileTitle}
      </h2>
      <div className={styles.photoRow}>
        <Avatar avatar={profile.avatar} name={draftName} size="lg" />
        <Button
          disabled={!ready || savingAvatar}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          variant="secondary"
        >
          {savingAvatar
            ? t.profile.avatarSaving
            : profile.avatar
              ? t.profile.avatarChange
              : t.profile.avatarChoose}
        </Button>
        <input
          accept="image/png,image/jpeg,image/webp"
          aria-label={t.profile.avatarInputLabel}
          className={styles.fileInput}
          onChange={(event) => void chooseFile(event)}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      {avatarError ? <ErrorLine>{avatarError}</ErrorLine> : null}
      <TextField
        autoComplete="off"
        label={t.settings.userNameLabel}
        maxLength={80}
        onChange={(event) => onDraftName(event.currentTarget.value)}
        placeholder={t.settings.userNamePlaceholder}
        value={draftName}
      />
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </>
  );
}

function ProjectStep({
  busy,
  error,
  folderPath,
  onFolder,
  onSkip,
  pickerMissing,
  titleId,
  titleRef,
}: StepHeadProps & {
  busy: boolean;
  error: string;
  folderPath: string;
  onFolder: (path: string) => void;
  onSkip: () => void;
  pickerMissing: boolean;
}) {
  const bridge = useMemo(() => getBridge(), []);
  const [pickError, setPickError] = useState("");

  async function pickFolder() {
    if (!bridge?.pickFolder || busy) return;
    setPickError("");
    try {
      const selected = await bridge.pickFolder(
        folderPath.startsWith("/") ? { defaultPath: folderPath } : undefined,
      );
      if (selected) onFolder(selected.path);
    } catch (failure) {
      setPickError(errorMessage(failure, t.projects.folderChooseFailed));
    }
  }

  return (
    <>
      <h2 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>
        {t.onboarding.projectTitle}
      </h2>
      <p className={styles.lead}>{t.onboarding.projectText}</p>

      {pickerMissing ? (
        <TextField
          autoComplete="off"
          label={t.projects.folderLabel}
          mono
          onChange={(event) => onFolder(event.currentTarget.value)}
          placeholder={t.projects.folderPlaceholder}
          spellCheck={false}
          value={folderPath}
        />
      ) : (
        <>
          {folderPath ? (
            <p className={styles.folder}>
              <span className={styles.folderLabel}>{t.onboarding.chosenFolder}</span>
              <code className={styles.folderPath}>{folderPath}</code>
            </p>
          ) : null}
          <div className={styles.actionsRow}>
            <Button disabled={busy} onClick={() => void pickFolder()} variant="secondary">
              {folderPath ? t.onboarding.chooseOtherFolder : t.onboarding.chooseFolder}
            </Button>
          </div>
        </>
      )}
      {pickError ? <ErrorLine>{pickError}</ErrorLine> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}

      <div className={styles.actionsRow}>
        <Button disabled={busy} onClick={onSkip} variant="ghost">
          {busy && !folderPath ? t.onboarding.finishing : t.onboarding.skipProject}
        </Button>
      </div>
    </>
  );
}

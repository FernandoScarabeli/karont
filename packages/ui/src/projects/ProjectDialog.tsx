import { type Agent, BridgeError, type Project } from "@karont/contract";
import { TriangleAlert } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { findChatAgents } from "../agents/chatAgents.ts";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ProjectDialog.module.css";
import { DEFAULT_PROJECT_ICON, PROJECT_ICONS } from "./projectIcons.ts";

const MAX_NAME_LENGTH = 80;
/** Valor do radio "Último usado"; não é um id de agente. */
const LAST_USED = "";

export type ProjectDialogProps = {
  open: boolean;
  /** `null` cria um projeto novo; um projeto existente abre a edição. */
  project: Project | null;
  onClose: () => void;
  onSaved: (project: Project, mode: "create" | "edit") => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ProjectDialog({
  open,
  project,
  onClose,
  onSaved,
  returnFocusRef,
}: ProjectDialogProps) {
  const bridge = getBridge();
  const editing = project !== null;
  const [wasOpen, setWasOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_PROJECT_ICON);
  const [path, setPath] = useState("");
  const [defaultAgent, setDefaultAgent] = useState(LAST_USED);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const iconGroupName = useId();
  const agentGroupName = useId();

  // Começa o formulário do zero cada vez que o diálogo abre.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(project?.name ?? "");
      setIcon(project?.icon ?? DEFAULT_PROJECT_ICON);
      setPath(project?.path ?? "");
      setDefaultAgent(project?.defaultAgent ?? LAST_USED);
      setError("");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!open || !bridge) return;
    let mounted = true;
    setAgents(null);
    setAgentsError(false);
    void bridge
      .request("agents.list", {})
      .then((result) => {
        if (mounted) setAgents(result.agents);
      })
      .catch(() => {
        if (mounted) setAgentsError(true);
      });
    return () => {
      mounted = false;
    };
  }, [bridge, open]);

  const chatAgents = agents ? findChatAgents(agents) : [];
  const savedAgentId = project?.defaultAgent ?? null;
  const savedAgentMissing =
    savedAgentId !== null && !chatAgents.some((agent) => agent.id === savedAgentId);
  const savedAgentName = agents?.find((agent) => agent.id === savedAgentId)?.name ?? savedAgentId;

  function fillNameFromFolder(folder: string) {
    setName((current) =>
      current.trim() ? current : folderBaseName(folder).slice(0, MAX_NAME_LENGTH),
    );
  }

  async function pickFolder() {
    if (!bridge?.pickFolder || submitting) return;
    setError("");
    try {
      const selected = await bridge.pickFolder(
        path.trim().startsWith("/") ? { defaultPath: path.trim() } : undefined,
      );
      if (!selected) return;
      setPath(selected.path);
      fillNameFromFolder(selected.path);
    } catch (pickError) {
      setError(
        pickError instanceof BridgeError && pickError.message
          ? pickError.message
          : t.projects.folderChooseFailed,
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const cleanName = name.trim();
    const cleanPath = path.trim();
    if (!cleanName) {
      setError(t.projects.nameRequired);
      nameRef.current?.focus();
      return;
    }
    if (cleanName.length > MAX_NAME_LENGTH) {
      setError(t.projects.nameTooLong);
      nameRef.current?.focus();
      return;
    }

    if (project) {
      const changes = {
        ...(cleanName !== project.name ? { name: cleanName } : {}),
        ...(icon !== project.icon ? { icon } : {}),
        ...((defaultAgent || null) !== project.defaultAgent
          ? { defaultAgent: defaultAgent || null }
          : {}),
      };
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      await save(() => bridge?.request("projects.update", { id: project.id, ...changes }), "edit");
      return;
    }

    if (!cleanPath) {
      setError(t.projects.folderRequired);
      pathRef.current?.focus();
      return;
    }
    if (!isAbsolutePath(cleanPath)) {
      setError(t.projects.folderMustBeAbsolute);
      pathRef.current?.focus();
      return;
    }
    await save(
      () =>
        bridge?.request("projects.create", {
          name: cleanName,
          icon,
          path: cleanPath,
          ...(defaultAgent ? { defaultAgent } : {}),
        }),
      "create",
    );
  }

  async function save(
    request: () => Promise<{ project: Project }> | undefined,
    mode: "create" | "edit",
  ) {
    const pending = request();
    if (!pending) {
      setError(t.projects.noBridge);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const result = await pending;
      setSubmitting(false);
      onSaved(result.project, mode);
    } catch (saveError) {
      setSubmitting(false);
      setError(
        saveError instanceof BridgeError && saveError.message
          ? saveError.message
          : t.projects.saveFailed,
      );
    }
  }

  function close() {
    if (!submitting) onClose();
  }

  return (
    <Dialog
      description={editing ? undefined : t.projects.createDescription}
      footer={
        <>
          <Button disabled={submitting} onClick={close} variant="secondary">
            {t.projects.cancel}
          </Button>
          <Button disabled={submitting} form={formId} type="submit" variant="primary">
            {editing
              ? submitting
                ? t.projects.saving
                : t.projects.save
              : submitting
                ? t.projects.creating
                : t.projects.create}
          </Button>
        </>
      }
      initialFocusRef={nameRef as RefObject<HTMLElement | null>}
      onClose={close}
      open={open}
      returnFocusRef={returnFocusRef}
      title={editing ? t.projects.editTitle : t.projects.createTitle}
    >
      <form className={styles.form} id={formId} onSubmit={(event) => void submit(event)}>
        <TextField
          autoComplete="off"
          label={t.projects.nameLabel}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setError("");
          }}
          ref={nameRef}
          value={name}
        />

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t.projects.iconLabel}</legend>
          <div className={styles.iconGrid}>
            {PROJECT_ICONS.map(({ name: iconName, Icon }) => {
              const label = t.projects.iconNames[iconName] ?? iconName;
              return (
                <label className={styles.iconOption} key={iconName} title={label}>
                  <input
                    aria-label={label}
                    checked={icon === iconName}
                    className={styles.choiceInput}
                    name={iconGroupName}
                    onChange={() => setIcon(iconName)}
                    type="radio"
                    value={iconName}
                  />
                  <span className={styles.iconFace}>
                    <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {editing ? (
          <TextField
            hint={t.projects.folderReadOnlyHint}
            label={t.projects.folderLabel}
            mono
            readOnly
            value={project.path}
          />
        ) : (
          <div className={styles.folderRow}>
            <TextField
              autoComplete="off"
              label={t.projects.folderLabel}
              mono
              onBlur={() => {
                if (path.trim()) fillNameFromFolder(path.trim());
              }}
              onChange={(event) => {
                setPath(event.currentTarget.value);
                setError("");
              }}
              placeholder={t.projects.folderPlaceholder}
              ref={pathRef}
              spellCheck={false}
              value={path}
            />
            {bridge?.pickFolder ? (
              <Button
                aria-label={t.projects.chooseFolderAccessibleName}
                disabled={submitting}
                onClick={() => void pickFolder()}
                variant="secondary"
              >
                {t.projects.chooseFolder}
              </Button>
            ) : null}
          </div>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t.projects.defaultAgentLabel}</legend>
          <div className={styles.agentList}>
            <AgentOption
              checked={defaultAgent === LAST_USED}
              groupName={agentGroupName}
              onSelect={() => setDefaultAgent(LAST_USED)}
              value={LAST_USED}
            >
              <span className={styles.agentName}>{t.projects.lastUsedAgent}</span>
            </AgentOption>
            {chatAgents.map((agent) => (
              <AgentOption
                checked={defaultAgent === agent.id}
                groupName={agentGroupName}
                key={agent.id}
                onSelect={() => setDefaultAgent(agent.id)}
                value={agent.id}
              >
                <AgentIcon agentId={agent.id} />
                <span className={styles.agentName}>{agent.name}</span>
              </AgentOption>
            ))}
            {savedAgentMissing && savedAgentId ? (
              <AgentOption
                accessibleName={
                  agents ? t.projects.agentNotFoundAccessibleName(savedAgentName ?? "") : undefined
                }
                checked={defaultAgent === savedAgentId}
                groupName={agentGroupName}
                onSelect={() => setDefaultAgent(savedAgentId)}
                value={savedAgentId}
              >
                <AgentIcon agentId={savedAgentId} />
                <span className={styles.agentName}>{savedAgentName}</span>
                {agents ? (
                  <span className={styles.agentMissing}>{t.projects.agentNotFound}</span>
                ) : null}
              </AgentOption>
            ) : null}
          </div>
          {agentsError ? (
            <p className={styles.agentsError} role="status">
              {t.projects.agentsLoadFailed}
            </p>
          ) : null}
        </fieldset>

        {error ? (
          <p className={styles.error} role="alert">
            <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{error}</span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function AgentOption({
  checked,
  groupName,
  value,
  accessibleName,
  onSelect,
  children,
}: {
  checked: boolean;
  groupName: string;
  value: string;
  accessibleName?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.agentOption}>
      <input
        aria-label={accessibleName}
        checked={checked}
        className={styles.choiceInput}
        name={groupName}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <span className={styles.agentFace}>
        <span aria-hidden="true" className={styles.radioMark} />
        {children}
      </span>
    </label>
  );
}

function folderBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

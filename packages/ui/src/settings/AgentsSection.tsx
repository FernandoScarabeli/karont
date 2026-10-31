import { type Agent, methods } from "@karont/contract";
import { CircleCheck, CircleDashed, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AgentIcon } from "../agents/AgentIcon.tsx";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { TextField } from "../components/TextField/TextField.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./AgentsSection.module.css";

type LoadPhase = "loading" | "ready" | "error" | "noBridge";
type AddErrors = { name?: string; command?: string };
type AddErrorFocusTarget = "name" | "command" | null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function displayPath(path: string): string {
  return path.replace(/^\/home\/[^/]+(?=\/|$)/u, "~").replace(/^\/root(?=\/|$)/u, "~");
}

export function AgentsSection() {
  const bridge = useMemo(() => getBridge(), []);
  const [phase, setPhase] = useState<LoadPhase>(() => (bridge ? "loading" : "noBridge"));
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [command, setCommand] = useState("");
  const [addErrors, setAddErrors] = useState<AddErrors>({});
  const [addErrorFocusTarget, setAddErrorFocusTarget] = useState<AddErrorFocusTarget>(null);
  const [addErrorFocusVersion, setAddErrorFocusVersion] = useState(0);
  const [removingAgent, setRemovingAgent] = useState<Agent | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const removeCancelRef = useRef<HTMLButtonElement>(null);
  const formId = useId();

  const loadAgents = useCallback(async () => {
    if (!bridge) {
      setPhase("noBridge");
      return;
    }
    setPhase("loading");
    setLoadError("");
    setActionError("");
    try {
      const result = await bridge.request("agents.list", {});
      setAgents(result.agents);
      setPhase("ready");
    } catch (error) {
      setLoadError(errorMessage(error, t.settings.loadError));
      setPhase("error");
    }
  }, [bridge]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (addErrorFocusVersion === 0) return;
    if (addErrorFocusTarget === "name") nameInputRef.current?.focus();
    else if (addErrorFocusTarget === "command") commandInputRef.current?.focus();
  }, [addErrorFocusTarget, addErrorFocusVersion]);

  useEffect(() => {
    if (removeError && !isRemoving) removeCancelRef.current?.focus();
  }, [isRemoving, removeError]);

  async function detectAgents() {
    if (!bridge || isDetecting) return;
    setIsDetecting(true);
    setActionError("");
    setAnnouncement("");
    try {
      const result = await bridge.request("agents.detect", {});
      setAgents(result.agents);
      setPhase("ready");
    } catch (error) {
      setActionError(errorMessage(error, t.settings.detectFailed));
    } finally {
      setIsDetecting(false);
    }
  }

  function openAddDialog() {
    setAgentName("");
    setCommand("");
    setAddErrors({});
    setIsAddOpen(true);
  }

  async function addAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge || isAdding) return;

    const parsed = methods["agents.add"].params.safeParse({ name: agentName, command });
    if (!parsed.success) {
      const errors: AddErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name") errors.name = t.settings.invalidName;
        if (field === "command") errors.command = t.settings.invalidCommand;
      }
      setAddErrors(errors);
      setAddErrorFocusTarget(errors.name ? "name" : errors.command ? "command" : null);
      setAddErrorFocusVersion((version) => version + 1);
      return;
    }

    setAddErrors({});
    setIsAdding(true);
    try {
      const result = await bridge.request("agents.add", parsed.data);
      setIsAddOpen(false);
      setAnnouncement(t.settings.agentAdded(result.agent.name));
      setAgentName("");
      setCommand("");
      await loadAgents();
    } catch (error) {
      setAddErrors({ command: errorMessage(error, t.settings.addFailed) });
      setAddErrorFocusTarget("command");
      setAddErrorFocusVersion((version) => version + 1);
    } finally {
      setIsAdding(false);
    }
  }

  async function removeAgent() {
    if (!bridge || !removingAgent || isRemoving) return;
    setIsRemoving(true);
    setRemoveError("");
    try {
      await bridge.request("agents.remove", { id: removingAgent.id });
      setRemovingAgent(null);
      setAnnouncement("");
      await loadAgents();
    } catch (error) {
      setRemoveError(errorMessage(error, t.settings.removeFailed));
    } finally {
      setIsRemoving(false);
    }
  }

  const foundCount = agents.filter((agent) => agent.found).length;

  return (
    <section
      aria-labelledby="settings-agents-title"
      className={styles.section}
      id="settings-agents"
    >
      <header className={styles.sectionHeader}>
        <h2 className={styles.title} id="settings-agents-title">
          {t.settings.agents}
        </h2>
        <p className={styles.description}>{t.settings.agentsDescription}</p>
      </header>

      {phase === "noBridge" ? (
        <p className={styles.connectionMessage} role="status">
          {t.settings.noBridge}
        </p>
      ) : (
        <>
          {phase === "ready" ? (
            <div className={styles.listToolbar}>
              <p className={styles.count}>{t.settings.detectedCount(foundCount, agents.length)}</p>
              <Button
                disabled={isDetecting}
                iconStart={<RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />}
                onClick={() => void detectAgents()}
                size="sm"
                variant="secondary"
              >
                {isDetecting ? t.settings.detecting : t.settings.detectAgain}
              </Button>
            </div>
          ) : null}

          {phase === "loading" ? (
            <p className={styles.statusMessage} role="status">
              {t.settings.loadingAgents}
            </p>
          ) : null}

          {phase === "error" ? (
            <div className={styles.errorState}>
              <p className={styles.errorMessage} role="alert">
                {loadError || t.settings.loadError}
              </p>
              <Button onClick={() => void loadAgents()} size="sm" variant="secondary">
                {t.settings.retry}
              </Button>
            </div>
          ) : null}

          {actionError ? (
            <p className={styles.errorMessage} role="alert">
              {actionError}
            </p>
          ) : null}
          {announcement ? (
            <p className={styles.announcement} role="status">
              {announcement}
            </p>
          ) : null}

          {phase === "ready" ? (
            agents.length > 0 ? (
              <ul aria-label={t.settings.agents} className={styles.agentList}>
                {agents.map((agent) => (
                  <li className={styles.agentItem} key={agent.id}>
                    <div className={styles.agentDetails}>
                      <div className={styles.agentHeading}>
                        <AgentIcon agentId={agent.id} />
                        <span
                          className={
                            agent.found
                              ? styles.agentName
                              : `${styles.agentName} ${styles.notFoundAgentName}`
                          }
                        >
                          {agent.name}
                        </span>
                        <span className={styles.agentState}>
                          {agent.found ? (
                            <CircleCheck
                              aria-hidden="true"
                              className={styles.foundIcon}
                              size={16}
                              strokeWidth={1.8}
                            />
                          ) : (
                            <CircleDashed
                              aria-hidden="true"
                              className={styles.stateIcon}
                              size={16}
                              strokeWidth={1.8}
                            />
                          )}
                          <span>{agent.found ? t.settings.found : t.settings.notFound}</span>
                          {agent.kind === "known" && !agent.structured ? (
                            <span className={styles.marker}>{t.settings.terminalOnly}</span>
                          ) : null}
                          {agent.kind === "custom" ? (
                            <span className={styles.marker}>{t.settings.addedByYou}</span>
                          ) : null}
                        </span>
                      </div>
                      {agent.path ? (
                        <code className={styles.agentPath} title={agent.path}>
                          {displayPath(agent.path)}
                        </code>
                      ) : null}
                    </div>
                    {agent.kind === "custom" ? (
                      <IconButton
                        disabled={isRemoving}
                        icon={<Trash2 aria-hidden="true" size={16} strokeWidth={1.8} />}
                        label={t.settings.removeAgent(agent.name)}
                        onClick={() => {
                          setRemoveError("");
                          setRemovingAgent(agent);
                        }}
                        size="sm"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyList}>{t.settings.noAgents}</p>
            )
          ) : null}

          <div className={styles.actions}>
            <Button
              iconStart={<Plus aria-hidden="true" size={16} strokeWidth={1.8} />}
              onClick={openAddDialog}
              size="md"
              variant="primary"
            >
              {t.settings.addAnotherCli}
            </Button>
          </div>
        </>
      )}

      <Dialog
        description={t.settings.addDialogDescription}
        footer={
          <>
            <Button onClick={() => setIsAddOpen(false)} variant="secondary">
              {t.settings.cancel}
            </Button>
            <Button aria-disabled={isAdding} form={formId} type="submit" variant="primary">
              {isAdding ? t.settings.adding : t.settings.add}
            </Button>
          </>
        }
        onClose={() => setIsAddOpen(false)}
        open={isAddOpen}
        title={t.settings.addDialogTitle}
      >
        <form className={styles.addForm} id={formId} onSubmit={(event) => void addAgent(event)}>
          <TextField
            autoComplete="off"
            autoFocus
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
            value={command}
          />
        </form>
      </Dialog>

      <Dialog
        description={t.settings.removeDialogDescription}
        footer={
          <>
            <Button
              disabled={isRemoving}
              onClick={() => setRemovingAgent(null)}
              ref={removeCancelRef}
              variant="secondary"
            >
              {t.settings.cancel}
            </Button>
            <Button aria-disabled={isRemoving} onClick={() => void removeAgent()} variant="danger">
              {t.settings.remove}
            </Button>
          </>
        }
        onClose={() => setRemovingAgent(null)}
        open={removingAgent !== null}
        title={removingAgent ? t.settings.removeDialogTitle(removingAgent.name) : t.settings.remove}
      >
        {removeError ? (
          <p className={styles.errorMessage} role="alert">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}

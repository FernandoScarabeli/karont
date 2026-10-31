import type { Agent } from "@karont/contract";
import { BridgeError } from "@karont/contract";
import { ChevronDown, SquareTerminal, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { getBridge } from "../bridge/index.ts";
import { Button } from "../components/Button/Button.tsx";
import { t } from "../i18n/pt-BR.ts";
import { useNavigation } from "../navigation/NavigationContext.tsx";
import styles from "./NewConversationView.module.css";

const LAST_AGENT_SETTING = "newConversation.lastAgent";
const TERMINAL_CHOICE = "terminal";

type AgentChoice = typeof TERMINAL_CHOICE | string;
type SelectorOption =
  | { id: string; kind: "agent"; agent: Agent }
  | { id: string; kind: "terminal" }
  | { id: string; kind: "manage" };

export function NewConversationView({
  titleRef,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const bridge = getBridge();
  const { navigate } = useNavigation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [choice, setChoice] = useState<AgentChoice>(TERMINAL_CHOICE);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState("");
  const [agentsError, setAgentsError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const choiceTouchedRef = useRef(false);
  const titleId = useId();
  const listboxId = useId();

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;

    void Promise.allSettled([
      bridge.request("agents.list", {}),
      bridge.request("settings.get", { key: LAST_AGENT_SETTING }),
    ]).then(([agentsResult, settingResult]) => {
      if (!mounted) return;
      if (agentsResult.status === "fulfilled") {
        const foundAgents = agentsResult.value.agents.filter((agent) => agent.found);
        setAgents(foundAgents);
        if (
          !choiceTouchedRef.current &&
          settingResult.status === "fulfilled" &&
          typeof settingResult.value.value === "string" &&
          (settingResult.value.value === TERMINAL_CHOICE ||
            foundAgents.some((agent) => agent.id === settingResult.value.value))
        ) {
          setChoice(settingResult.value.value);
        }
      } else {
        setAgentsError(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, [bridge]);

  const options: SelectorOption[] = [
    ...agents.map((agent) => ({ id: agent.id, kind: "agent" as const, agent })),
    { id: TERMINAL_CHOICE, kind: "terminal" },
    { id: "manage-agents", kind: "manage" },
  ];
  const selectedAgent = agents.find((agent) => agent.id === choice);
  const selectedTitle = selectedAgent?.name ?? t.conversation.terminal;

  useEffect(() => {
    if (!isMenuOpen) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, isMenuOpen]);

  function openMenu() {
    const selectedIndex = options.findIndex((option) => option.id === choice);
    const terminalIndex = options.findIndex((option) => option.kind === "terminal");
    setActiveIndex(selectedIndex === -1 ? Math.max(terminalIndex, 0) : selectedIndex);
    setIsMenuOpen(true);
  }

  function choose(option: SelectorOption) {
    if (option.kind === "agent") return;
    if (option.kind === "manage") {
      setIsMenuOpen(false);
      navigate({ name: "settings", section: "agents" });
      return;
    }

    choiceTouchedRef.current = true;
    setChoice(TERMINAL_CHOICE);
    setError("");
    setIsMenuOpen(false);
    triggerRef.current?.focus();
    if (!bridge) return;
    void bridge
      .request("settings.set", { key: LAST_AGENT_SETTING, value: TERMINAL_CHOICE })
      .catch(() => {
        setError(t.conversation.settingsSaveFailed);
      });
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
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
      const option = options[index];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsMenuOpen(false);
      triggerRef.current?.focus();
    }
  }

  async function openTerminal() {
    if (!bridge || isOpening || choice !== TERMINAL_CHOICE) return;
    setError("");
    setIsOpening(true);
    try {
      const result = await bridge.request("terminals.open", { cols: 80, rows: 24 });
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

  return (
    <div className={styles.page}>
      <h1 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>
        {t.conversation.title}
      </h1>

      <section aria-labelledby={titleId} className={styles.composer}>
        {choice !== TERMINAL_CHOICE ? (
          <>
            <textarea
              aria-label={t.conversation.promptPlaceholder}
              className={styles.prompt}
              disabled
              placeholder={t.conversation.promptPlaceholder}
            />
            <p className={styles.helper}>{t.conversation.agentChatSoon}</p>
          </>
        ) : null}

        <div className={styles.composerFooter}>
          <div className={styles.composerChoices}>
            <div className={styles.selectorWrap}>
              <button
                aria-controls={listboxId}
                aria-expanded={isMenuOpen}
                aria-haspopup="listbox"
                aria-label={`${t.conversation.agentLabel}: ${selectedTitle}`}
                className={styles.selectorButton}
                onClick={() => (isMenuOpen ? setIsMenuOpen(false) : openMenu())}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    openMenu();
                  }
                }}
                ref={triggerRef}
                type="button"
              >
                <span>{selectedTitle}</span>
                <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>

              {isMenuOpen ? (
                <div
                  aria-label={t.conversation.agentLabel}
                  className={styles.listbox}
                  id={listboxId}
                  role="listbox"
                >
                  {options.map((option, index) => (
                    <div
                      aria-disabled={option.kind === "agent" ? "true" : undefined}
                      aria-selected={option.id === choice}
                      className={`${styles.option} ${option.kind === "manage" ? styles.manageOption : ""}`}
                      id={`${listboxId}-${index}`}
                      key={option.id}
                      onClick={() => choose(option)}
                      onBlur={(event) => {
                        if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
                          setIsMenuOpen(false);
                        }
                      }}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      role="option"
                      tabIndex={activeIndex === index ? 0 : -1}
                    >
                      {option.kind === "agent" ? (
                        <>
                          <span>{option.agent.name}</span>
                          <span className={styles.soonMarker}>{t.conversation.soon}</span>
                        </>
                      ) : option.kind === "terminal" ? (
                        <>
                          <SquareTerminal aria-hidden="true" size={16} strokeWidth={1.8} />
                          <span>{t.conversation.terminal}</span>
                        </>
                      ) : (
                        <span>{t.conversation.manageAgents}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <span className={styles.folder}>{t.conversation.personalFolder}</span>
          </div>

          <Button
            disabled={!bridge || isOpening || choice !== TERMINAL_CHOICE}
            iconStart={<SquareTerminal aria-hidden="true" size={16} strokeWidth={1.8} />}
            onClick={() => void openTerminal()}
            size="lg"
            variant="primary"
          >
            {isOpening
              ? t.conversation.openingTerminal
              : choice === TERMINAL_CHOICE
                ? t.conversation.openTerminal
                : t.conversation.openConversation}
          </Button>
        </div>
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
    </div>
  );
}

import type { Conversation, ResultOf } from "@karont/contract";
import { ListTodo, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/Button/Button.tsx";
import { ComposerMenu, type ComposerMenuOption } from "../components/ComposerMenu/ComposerMenu.tsx";
import {
  ComposerPopover,
  ComposerPopoverHeading,
} from "../components/ComposerPopover/ComposerPopover.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ComposerPreferences.module.css";

type AgentModelsResult = ResultOf<"agent.models">;
export type AgentEffort = AgentModelsResult["efforts"][number];
export type AgentModels = {
  agent: AgentModelsResult["agent"];
  models: Array<AgentModelsResult["models"][number] & { efforts?: AgentEffort[] }>;
  efforts?: AgentEffort[];
};
export type ComposerPopoverName = "agent" | "model" | "config" | null;
type ConversationMode = NonNullable<Conversation["mode"]>;

export function modelSettingKey(agent: AgentModels["agent"]): string {
  return `composer.${agent}.model`;
}

export function effortSettingKey(agent: AgentModels["agent"]): string {
  return `composer.${agent}.effort`;
}

export function effortsForModel(models: AgentModels | null, modelId: string): AgentEffort[] {
  if (!modelId) return [];
  const modelEfforts = models?.models.find((option) => option.id === modelId)?.efforts;
  return modelEfforts ?? models?.efforts ?? [];
}

export function initialEffortForModel(
  models: AgentModels | null,
  modelId: string,
  preferredEffort: string | null,
): AgentEffort | "" {
  const supported = effortsForModel(models, modelId);
  if (!supported.length) return "";
  if (preferredEffort && supported.includes(preferredEffort as AgentEffort)) {
    return preferredEffort as AgentEffort;
  }
  const modelDefault = models?.models.find((option) => option.id === modelId)?.defaultEffort;
  if (modelDefault && supported.includes(modelDefault)) return modelDefault;
  if (supported.includes("medium")) return "medium";
  return supported[0] ?? "";
}

export function modelDisplayName(models: AgentModels | null, modelId: string | null): string {
  if (!modelId) return t.chat.model;
  return models?.models.find((option) => option.id === modelId)?.name ?? modelId;
}

const modes: ConversationMode[] = ["read-only", "edit", "full"];

export function ComposerPreferences({
  models,
  model,
  effort,
  mode,
  planMode,
  activePopover,
  onActivePopoverChange,
  disabled = false,
  onModelChange,
  onEffortChange,
  onModeChange,
  onPlanModeChange,
}: {
  models: AgentModels | null;
  model: string | null;
  effort: AgentEffort | "";
  mode: ConversationMode;
  planMode: boolean;
  activePopover: ComposerPopoverName;
  onActivePopoverChange: (popover: ComposerPopoverName) => void;
  disabled?: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: AgentEffort | "") => void;
  onModeChange: (value: ConversationMode) => void;
  onPlanModeChange: (value: boolean) => void;
}) {
  const [confirmFull, setConfirmFull] = useState(false);
  const [configAnchorName, setConfigAnchorName] = useState<"config" | "plan" | "full">("config");
  const configTriggerRef = useRef<HTMLButtonElement>(null);
  const planBadgeRef = useRef<HTMLButtonElement>(null);
  const fullAccessBadgeRef = useRef<HTMLButtonElement>(null);
  const modeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const configFocusIntentRef = useRef<"radio" | "popover">("popover");
  const configPopoverId = useId();
  const configContentId = useId();
  const planDescriptionId = useId();
  const modelName = modelDisplayName(models, model);
  const modelOptions: ComposerMenuOption[] = (models?.models ?? []).map((option) => ({
    id: option.id,
    content: <span className={styles.modelOption}>{option.name}</span>,
    selected: option.id === model,
    onSelect: () => onModelChange(option.id),
  }));
  if (model && !modelOptions.some((option) => option.id === model)) {
    modelOptions.unshift({
      id: model,
      content: <span className={styles.modelOption}>{model}</span>,
      selected: true,
      onSelect: () => onModelChange(model),
    });
  }

  const efforts = effortsForModel(models, model ?? "");
  const selectedEffort = effort && efforts.includes(effort) ? effort : "";
  const fullAccess = mode === "full";
  const configAnchorRef =
    configAnchorName === "plan" && planMode
      ? planBadgeRef
      : configAnchorName === "full" && fullAccess
        ? fullAccessBadgeRef
        : configTriggerRef;
  const active = (name: Exclude<ComposerPopoverName, null>) => activePopover === name;

  function openConfig(target: HTMLButtonElement, fromKeyboard: boolean) {
    const anchorName = (target.dataset.configAnchor ?? "config") as "config" | "plan" | "full";
    const shouldClose = active("config") && configAnchorName === anchorName;
    if (!shouldClose) {
      setConfigAnchorName(anchorName);
      configFocusIntentRef.current = fromKeyboard ? "radio" : "popover";
    }
    onActivePopoverChange(shouldClose ? null : "config");
  }

  function handleConfigKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (active("config") || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    openConfig(event.currentTarget, true);
  }

  function handleConfigClick(event: MouseEvent<HTMLButtonElement>) {
    openConfig(event.currentTarget, event.detail === 0);
  }

  function closeConfig(returnFocus = true) {
    onActivePopoverChange(null);
    if (returnFocus) requestAnimationFrame(() => configAnchorRef.current?.focus());
  }

  function chooseMode(value: ConversationMode) {
    if (value === "full" && mode !== "full") {
      setConfirmFull(true);
      closeConfig(false);
      return;
    }
    onModeChange(value);
  }

  return (
    <div className={styles.options}>
      <ComposerMenu
        disabled={disabled || !models || modelOptions.length === 0}
        label={t.chat.model}
        onOpenChange={(open) => onActivePopoverChange(open ? "model" : null)}
        open={active("model")}
        options={modelOptions}
        triggerClassName={styles.modelTrigger}
        triggerContent={<span className={styles.modelName}>{modelName}</span>}
        triggerLabel={model ? `${t.chat.model}: ${modelName}` : t.chat.model}
      />
      {efforts.length > 0 ? (
        <EffortButton
          activePopover={activePopover !== null}
          disabled={disabled}
          effort={selectedEffort}
          levels={efforts}
          onChange={onEffortChange}
        />
      ) : null}
      <div className={styles.configGroup}>
        <button
          aria-controls={configPopoverId}
          aria-expanded={active("config")}
          aria-haspopup="dialog"
          aria-label={t.chat.configLabel}
          className={styles.iconTrigger}
          data-config-anchor="config"
          data-composer-menu-trigger
          disabled={disabled}
          onClick={handleConfigClick}
          onKeyDown={handleConfigKeyDown}
          ref={configTriggerRef}
          title={t.chat.configLabel}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        {planMode ? (
          <button
            aria-controls={configPopoverId}
            aria-expanded={active("config")}
            aria-haspopup="dialog"
            aria-label={t.chat.planBadgeAccessibleName}
            className={styles.badge}
            data-config-anchor="plan"
            data-composer-menu-trigger
            disabled={disabled}
            onClick={handleConfigClick}
            onKeyDown={handleConfigKeyDown}
            ref={planBadgeRef}
            title={t.chat.configLabel}
            type="button"
          >
            <ListTodo aria-hidden="true" size={13} />
            <span>{t.chat.planMode}</span>
          </button>
        ) : null}
        {fullAccess ? (
          <button
            aria-controls={configPopoverId}
            aria-expanded={active("config")}
            aria-haspopup="dialog"
            aria-label={t.chat.fullAccessBadgeAccessibleName}
            className={[styles.badge, styles.alertBadge].join(" ")}
            data-config-anchor="full"
            data-composer-menu-trigger
            disabled={disabled}
            onClick={handleConfigClick}
            onKeyDown={handleConfigKeyDown}
            ref={fullAccessBadgeRef}
            title={t.chat.configLabel}
            type="button"
          >
            <TriangleAlert aria-hidden="true" size={13} />
            <span>{t.chat.modes.full}</span>
          </button>
        ) : null}
        <ComposerPopover
          anchorRef={configAnchorRef}
          className={styles.configPopover}
          id={configPopoverId}
          initialFocus={() =>
            configFocusIntentRef.current === "radio"
              ? (modeRefs.current[modes.indexOf(mode)] ?? null)
              : null
          }
          label={t.chat.configLabel}
          onClose={() => closeConfig()}
          open={active("config")}
          role="dialog"
        >
          <ComposerPopoverHeading>{t.chat.access}</ComposerPopoverHeading>
          <fieldset className={styles.configContent} id={configContentId}>
            <legend className={styles.srOnly}>{t.chat.configLabel}</legend>
            <section className={styles.configSection}>
              <fieldset className={styles.accessOptions}>
                <legend className={styles.srOnly}>{t.chat.access}</legend>
                {modes.map((value, index) => (
                  <label className={styles.accessOption} data-checked={mode === value} key={value}>
                    <input
                      aria-describedby={`${configPopoverId}-${value}-description`}
                      aria-labelledby={`${configPopoverId}-${value}-name`}
                      checked={mode === value}
                      className={styles.radioInput}
                      disabled={disabled}
                      name={`${configPopoverId}-access`}
                      onChange={() => chooseMode(value)}
                      ref={(element) => {
                        modeRefs.current[index] = element;
                      }}
                      type="radio"
                      value={value}
                    />
                    <span aria-hidden="true" className={styles.radioMark} />
                    <span className={styles.accessCopy}>
                      <span className={styles.accessName} id={`${configPopoverId}-${value}-name`}>
                        {t.chat.modes[value]}
                      </span>
                      <span
                        className={styles.accessDescription}
                        id={`${configPopoverId}-${value}-description`}
                      >
                        {t.chat.modeDescriptions[value]}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>
            <hr className={styles.sectionSeparator} />
            <section className={styles.configSection}>
              <button
                aria-checked={planMode}
                aria-describedby={planDescriptionId}
                aria-label={t.chat.planMode}
                className={styles.planOption}
                disabled={disabled}
                onClick={() => onPlanModeChange(!planMode)}
                role="switch"
                type="button"
              >
                <span className={styles.planCopy}>
                  <span className={styles.accessName}>{t.chat.planMode}</span>
                  <span className={styles.accessDescription} id={planDescriptionId}>
                    {t.chat.planDescription}
                  </span>
                </span>
                <span aria-hidden="true" className={styles.switchTrack} data-checked={planMode}>
                  <span className={styles.switchThumb} />
                </span>
              </button>
            </section>
          </fieldset>
        </ComposerPopover>
      </div>
      <Dialog
        description={t.chat.fullAccessDescription}
        footer={
          <>
            <Button onClick={() => setConfirmFull(false)} variant="secondary">
              {t.conversation.cancel}
            </Button>
            <Button
              onClick={() => {
                setConfirmFull(false);
                onModeChange("full");
              }}
              variant="danger"
            >
              {t.chat.fullAccessConfirm}
            </Button>
          </>
        }
        onClose={() => setConfirmFull(false)}
        open={confirmFull}
        returnFocusRef={configAnchorRef}
        title={t.chat.fullAccessTitle}
      >
        <p className={styles.warning}>{t.chat.fullAccessWarning}</p>
      </Dialog>
    </div>
  );
}

function EffortButton({
  effort,
  levels,
  disabled,
  activePopover,
  onChange,
}: {
  effort: AgentEffort | "";
  levels: AgentEffort[];
  disabled: boolean;
  activePopover: boolean;
  onChange: (value: AgentEffort | "") => void;
}) {
  const currentIndex = levels.indexOf(effort as AgentEffort);
  const effortLabel =
    currentIndex >= 0
      ? t.chat.effortAccessibleName(t.chat.efforts[levels[currentIndex] ?? "medium"])
      : t.chat.effort;
  const [timedTooltip, setTimedTooltip] = useState(false);
  const [tooltipLabel, setTooltipLabel] = useState(effortLabel);
  const [announcement, setAnnouncement] = useState("");
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angle =
    currentIndex < 0 || levels.length < 2 ? 0 : -110 + (220 * currentIndex) / (levels.length - 1);

  useEffect(
    () => () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!activePopover) return;
    setTimedTooltip(false);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  }, [activePopover]);

  function chooseIndex(index: number) {
    const level = levels[index];
    if (!level) return;
    const label = t.chat.effortAccessibleName(t.chat.efforts[level]);
    setTooltipLabel(label);
    setAnnouncement(label);
    setTimedTooltip(true);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => setTimedTooltip(false), 1200);
    onChange(level);
  }

  function advance() {
    if (!levels.length) return;
    chooseIndex(currentIndex < 0 ? 0 : (currentIndex + 1) % levels.length);
  }

  function adjust(direction: -1 | 1) {
    if (!levels.length) return;
    const nextIndex =
      currentIndex < 0 ? 0 : Math.max(0, Math.min(levels.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) chooseIndex(nextIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      adjust(1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      adjust(-1);
    }
  }

  return (
    <span className={styles.effortControl} data-popover-open={activePopover}>
      <button
        aria-description={t.chat.effortChangeDescription}
        aria-label={effortLabel}
        className={styles.effortTrigger}
        data-composer-menu-trigger
        disabled={disabled}
        onClick={advance}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <EffortGauge angle={angle} />
      </button>
      <span
        aria-hidden="true"
        className={styles.effortTooltip}
        data-visible={timedTooltip}
        role="tooltip"
      >
        {tooltipLabel}
      </span>
      <span aria-atomic="true" aria-live="polite" className={styles.srOnly}>
        {announcement}
      </span>
    </span>
  );
}

function EffortGauge({ angle }: { angle: number }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.gauge}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <g className={styles.gaugeNeedle} style={{ transform: `rotate(${angle}deg)` }}>
        <path d="M12 14 L12 8.34" />
      </g>
    </svg>
  );
}

export function agentDisplayName(agent: string): string {
  return agent === "claude" ? t.chat.agents.claude : t.chat.agents.codex;
}

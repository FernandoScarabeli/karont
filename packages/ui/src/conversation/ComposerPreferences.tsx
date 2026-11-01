import type { Conversation, ResultOf } from "@karont/contract";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button/Button.tsx";
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
type ConversationMode = Conversation["mode"];

export function effortsForModel(models: AgentModels | null, modelId: string): AgentEffort[] {
  const modelEfforts = models?.models.find((option) => option.id === modelId)?.efforts;
  return modelEfforts ?? models?.efforts ?? [];
}

export function ComposerPreferences({
  models,
  model,
  effort,
  mode,
  disabled = false,
  onModelChange,
  onEffortChange,
  onModeChange,
}: {
  models: AgentModels | null;
  model: string;
  effort: AgentEffort | "";
  mode: ConversationMode;
  disabled?: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: AgentEffort | "") => void;
  onModeChange: (value: ConversationMode) => void;
}) {
  const [confirmFull, setConfirmFull] = useState(false);
  const needsModelOption = model && !models?.models.some((option) => option.id === model);
  const efforts = effortsForModel(models, model);
  const selectedEffort = efforts.includes(effort as AgentEffort) ? effort : "";

  return (
    <fieldset aria-label={t.chat.composerOptions} className={styles.options}>
      <label className={styles.control}>
        <span className={styles.srOnly}>{t.chat.model}</span>
        <span className={styles.selectWrap}>
          <select
            aria-label={t.chat.model}
            className={styles.select}
            disabled={disabled || !models || models.models.length === 0}
            onChange={(event) => onModelChange(event.currentTarget.value)}
            value={model}
          >
            <option value="">{t.chat.modelDefault}</option>
            {needsModelOption ? <option value={model}>{model}</option> : null}
            {models?.models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className={styles.chevron} size={13} />
        </span>
      </label>
      <label className={styles.control}>
        <span className={styles.srOnly}>{t.chat.effort}</span>
        <span className={styles.selectWrap}>
          <select
            aria-label={t.chat.effort}
            className={styles.select}
            disabled={disabled || !models || efforts.length === 0}
            onChange={(event) => onEffortChange(event.currentTarget.value as AgentEffort | "")}
            value={selectedEffort}
          >
            <option value="">{t.chat.effortDefault}</option>
            {efforts.map((level) => (
              <option key={level} value={level}>
                {t.chat.efforts[level]}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className={styles.chevron} size={13} />
        </span>
      </label>
      <label className={styles.control}>
        <span className={styles.srOnly}>{t.chat.access}</span>
        <span className={styles.selectWrap}>
          <select
            aria-label={t.chat.access}
            className={styles.select}
            disabled={disabled}
            onChange={(event) => {
              const value = event.currentTarget.value as ConversationMode;
              if (value === "full" && mode !== "full") {
                setConfirmFull(true);
                return;
              }
              onModeChange(value);
            }}
            value={mode}
          >
            <option value="read-only">{t.chat.modes["read-only"]}</option>
            <option value="edit">{t.chat.modes.edit}</option>
            <option value="full">{t.chat.modes.full}</option>
          </select>
          <ChevronDown aria-hidden="true" className={styles.chevron} size={13} />
        </span>
      </label>
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
        title={t.chat.fullAccessTitle}
      >
        <p className={styles.warning}>{t.chat.fullAccessWarning}</p>
      </Dialog>
    </fieldset>
  );
}

export function agentDisplayName(agent: string): string {
  return agent === "claude" ? t.chat.agents.claude : t.chat.agents.codex;
}

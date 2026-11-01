import type { Conversation, ResultOf } from "@karont/contract";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button/Button.tsx";
import { Dialog } from "../components/Dialog/Dialog.tsx";
import { t } from "../i18n/pt-BR.ts";
import styles from "./ComposerPreferences.module.css";

type AgentModels = ResultOf<"agent.models">;
type ConversationMode = Conversation["mode"];

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
  effort: AgentModels["efforts"][number] | "";
  mode: ConversationMode;
  disabled?: boolean;
  onModelChange: (value: string) => void;
  onEffortChange: (value: AgentModels["efforts"][number] | "") => void;
  onModeChange: (value: ConversationMode) => void;
}) {
  const [confirmFull, setConfirmFull] = useState(false);
  const needsModelOption = model && !models?.models.some((option) => option.id === model);

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
            disabled={disabled || !models || models.efforts.length === 0}
            onChange={(event) =>
              onEffortChange(event.currentTarget.value as AgentModels["efforts"][number] | "")
            }
            value={effort}
          >
            <option value="">{t.chat.effortDefault}</option>
            {models?.efforts.map((level) => (
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

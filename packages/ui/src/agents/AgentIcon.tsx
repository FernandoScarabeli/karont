import { SquareTerminal } from "lucide-react";
import ampIconUrl from "../assets/agents/amp-icon.svg?url";
import claudeIconUrl from "../assets/agents/claude-icon.svg?url";
import cursorIconUrl from "../assets/agents/cursor-icon.svg?url";
import geminiIconUrl from "../assets/agents/google-gemini-icon.svg?url";
import qwenIconUrl from "../assets/agents/qwen-icon.svg?url";
import styles from "./AgentIcon.module.css";

const iconUrls: Record<string, string> = {
  amp: ampIconUrl,
  claude: claudeIconUrl,
  "cursor-agent": cursorIconUrl,
  gemini: geminiIconUrl,
  qwen: qwenIconUrl,
};

const monochromeClasses: Record<string, string | undefined> = {
  codex: styles.codex,
  goose: styles.goose,
  opencode: styles.opencode,
};

export function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  const classNames = [styles.icon, className].filter(Boolean).join(" ");
  const monochromeClass = monochromeClasses[agentId];

  if (monochromeClass) {
    return (
      <span
        aria-hidden="true"
        className={`${classNames} ${styles.monochrome} ${monochromeClass}`}
      />
    );
  }

  const iconUrl = iconUrls[agentId];
  if (iconUrl) return <img alt="" aria-hidden="true" className={classNames} src={iconUrl} />;

  return <SquareTerminal aria-hidden="true" className={classNames} size={16} strokeWidth={1.8} />;
}

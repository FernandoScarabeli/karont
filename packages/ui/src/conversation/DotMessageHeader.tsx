import { useDot } from "../dot/DotContext.tsx";
import { type DotMood, EyeTracker } from "../dot/EyeTracker.tsx";
import { t } from "../i18n/pt-BR.ts";
import { agentDisplayName } from "./ComposerPreferences.tsx";
import styles from "./DotMessageHeader.module.css";

/** Quem responde: rosto, nome do Dot e o Agente por trás. Fica fora do texto copiado. */
export function DotMessageHeader({ agent, mood }: { agent?: string; mood: DotMood }) {
  const dot = useDot();
  if (!dot?.enabled) return null;
  const agentName = agent ? agentDisplayName(agent) : "";
  return (
    <div className={styles.header} data-dot-header>
      <span className={styles.face}>
        <EyeTracker color={dot.color} mood={mood} size={20} still />
      </span>
      <span className={styles.name} title={dot.name}>
        {dot.name}
      </span>
      {agentName ? <span className={styles.via}>{t.dotChat.via(agentName)}</span> : null}
    </div>
  );
}

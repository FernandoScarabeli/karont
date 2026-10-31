import { X } from "lucide-react";
import { getBridge } from "../bridge/index.ts";
import { IconButton } from "../components/IconButton/IconButton.tsx";
import { t } from "../i18n/pt-BR.ts";

export function TerminalCloseButton({
  className,
  label,
  onRequestClose,
}: {
  className?: string;
  label: string;
  onRequestClose: () => void;
}) {
  return (
    <IconButton
      className={className}
      disabled={!getBridge()}
      icon={<X aria-hidden="true" size={16} strokeWidth={1.75} />}
      label={t.terminal.endTerminal(label)}
      onClick={onRequestClose}
      size="sm"
    />
  );
}

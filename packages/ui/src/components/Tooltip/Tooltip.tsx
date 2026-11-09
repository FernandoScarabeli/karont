import { memo, type ReactNode, useMemo } from "react";
import styles from "./Tooltip.module.css";

export type TooltipAlign = "center" | "start" | "end";
export type TooltipSide = "top" | "end";

export const Tooltip = memo(function Tooltip({
  children,
  label,
  align = "center",
  side = "top",
  className,
  open = false,
  visible = false,
}: {
  children: ReactNode;
  label: string;
  align?: TooltipAlign;
  /** `end` abre ao lado (à direita), para botões em faixas estreitas. */
  side?: TooltipSide;
  className?: string;
  open?: boolean;
  visible?: boolean;
}) {
  const classNames = useMemo(() => [styles.root, className].filter(Boolean).join(" "), [className]);
  return (
    <span
      className={classNames}
      data-align={align}
      data-side={side}
      data-open={open}
      data-visible={visible}
    >
      {children}
      <span aria-hidden="true" className={styles.bubble} role="tooltip">
        {label}
      </span>
    </span>
  );
});

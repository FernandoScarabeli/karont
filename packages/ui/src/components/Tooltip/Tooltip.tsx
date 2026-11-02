import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export type TooltipAlign = "center" | "start" | "end";

export function Tooltip({
  children,
  label,
  align = "center",
  className,
  open = false,
  visible = false,
}: {
  children: ReactNode;
  label: string;
  align?: TooltipAlign;
  className?: string;
  open?: boolean;
  visible?: boolean;
}) {
  return (
    <span
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-align={align}
      data-open={open}
      data-visible={visible}
    >
      {children}
      <span aria-hidden="true" className={styles.bubble} role="tooltip">
        {label}
      </span>
    </span>
  );
}

import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./IconButton.module.css";

export type IconButtonVariant = "ghost" | "secondary";
export type IconButtonSize = "sm" | "md";

export type IconButtonProps = Omit<
  ComponentPropsWithRef<"button">,
  "aria-label" | "aria-pressed" | "title" | "className"
> & {
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  pressed?: boolean;
  className?: string;
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  pressed,
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  const classNames = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      aria-label={label}
      aria-pressed={pressed}
      className={classNames}
      title={label}
      type={type}
    >
      <span aria-hidden="true" className={styles.icon}>
        {icon}
      </span>
    </button>
  );
}

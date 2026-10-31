import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: ReactNode;
  className?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  iconStart,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  const classNames = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...props} className={classNames} type={type}>
      {iconStart ? (
        <span aria-hidden="true" className={styles.icon}>
          {iconStart}
        </span>
      ) : null}
      {children}
    </button>
  );
}

import { CircleAlert } from "lucide-react";
import { type ComponentPropsWithRef, useId } from "react";
import styles from "./TextField.module.css";

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  id?: string;
};

export function TextField({
  label,
  hint,
  error,
  mono = false,
  id,
  className,
  "aria-describedby": describedBy,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedByIds = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  const inputClassNames = [styles.input, mono ? styles.mono : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        aria-describedby={describedByIds}
        aria-invalid={error ? true : undefined}
        className={inputClassNames}
        id={inputId}
      />
      {hint ? (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.error} id={errorId}>
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}

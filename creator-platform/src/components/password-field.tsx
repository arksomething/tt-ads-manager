"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ComponentPropsWithoutRef } from "react";

import styles from "./password-field.module.css";

type PasswordFieldProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  label: string;
};

export function PasswordField({ id, label, ...inputProps }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide" : "Show";
  const accessibleLabel = `${action} ${label.toLowerCase()}`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.control}>
        <input
          {...inputProps}
          id={inputId}
          type={visible ? "text" : "password"}
        />
        <button
          aria-controls={inputId}
          aria-label={accessibleLabel}
          aria-pressed={visible}
          className={styles.toggle}
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={18} strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden="true" size={18} strokeWidth={1.8} />
          )}
        </button>
      </div>
    </div>
  );
}

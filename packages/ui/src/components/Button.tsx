import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Spinner } from "./States";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "hero";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  /** Muestra un indicador, deshabilita el botón y cambia el texto si se pasa `loadingLabel`. */
  loading?: boolean;
  loadingLabel?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["rc-btn", `rc-btn--${variant}`, size !== "md" && `rc-btn--${size}`, block && "rc-btn--block", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Spinner size="sm" decorative /> : null}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

import { type InputHTMLAttributes, type ReactNode, useId } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Ícono a la izquierda, dentro del campo (decorativo). */
  icon?: ReactNode;
  /** Botón a la derecha, dentro del campo (por ejemplo, mostrar la contraseña). */
  trailing?: ReactNode;
}

/** Campo de texto con etiqueta, ayuda y error asociados (aria-describedby / aria-invalid). */
export function TextField({ label, hint, error, icon, trailing, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={["rc-field", icon && "rc-field--icon", trailing && "rc-field--trailing", className].filter(Boolean).join(" ")}>
      <label className="rc-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="rc-field__control">
        {icon ? (
          <span className="rc-field__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <input
          {...input}
          id={id}
          className="rc-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        />
        {trailing ? <span className="rc-field__trailing">{trailing}</span> : null}
      </div>
      {hint ? (
        <span id={hintId} className="rc-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="rc-field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...input }: CheckboxProps) {
  return (
    <label className={["rc-check", className].filter(Boolean).join(" ")}>
      <input {...input} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}

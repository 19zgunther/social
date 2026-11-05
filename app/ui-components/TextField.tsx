import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const FIELD_BASE_CLASS =
  "w-full rounded-xl border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-60";

const TONE_CLASS = {
  default: "bg-bg",
  surface: "bg-surface",
} as const;

type TextFieldTone = keyof typeof TONE_CLASS;

type TextFieldBase = {
  label?: ReactNode;
  error?: ReactNode;
  className?: string;
  containerClassName?: string;
  tone?: TextFieldTone;
};

export type TextFieldProps = TextFieldBase &
  (
    | ({ as?: "input" } & Omit<InputHTMLAttributes<HTMLInputElement>, "className">)
    | ({ as: "textarea" } & Omit<
        TextareaHTMLAttributes<HTMLTextAreaElement>,
        "className"
      >)
  );

export default function TextField({
  label,
  error,
  className,
  containerClassName,
  tone = "default",
  as = "input",
  ...rest
}: TextFieldProps) {
  const fieldClassName = cn(FIELD_BASE_CLASS, TONE_CLASS[tone], className);

  const control =
    as === "textarea" ? (
      <textarea
        className={fieldClassName}
        {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    ) : (
      <input
        className={fieldClassName}
        {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      />
    );

  if (!label && !error) {
    return control;
  }

  return (
    <label className={cn("block", containerClassName)}>
      {label ? <span className="mb-1 block text-xs text-muted">{label}</span> : null}
      {control}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </label>
  );
}

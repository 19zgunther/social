import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "soft" | "outline" | "danger";
type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent transition hover:brightness-110 disabled:opacity-60",
  secondary:
    "border border-border text-muted transition hover:text-foreground disabled:opacity-60",
  soft: "border border-accent/50 bg-accent/15 text-accent transition hover:border-accent hover:bg-accent/25 disabled:opacity-60",
  outline:
    "border border-accent bg-surface text-accent transition hover:bg-accent/10 disabled:opacity-60",
  danger:
    "border border-danger-fill/50 bg-danger-fill/10 text-danger transition hover:bg-danger-fill/20 disabled:opacity-60",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "rounded-xl px-3 py-1.5 text-xs font-semibold",
  md: "rounded-xl px-4 py-3 text-sm font-semibold",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export default function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(SIZE_CLASS[size], VARIANT_CLASS[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

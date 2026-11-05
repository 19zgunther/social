import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type IconButtonVariant = "ghost" | "bordered" | "danger";

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  ghost:
    "rounded-full p-1.5 text-muted transition hover:bg-surface hover:text-foreground disabled:opacity-50",
  bordered:
    "rounded-full border border-border bg-surface p-2 text-muted transition hover:text-foreground disabled:opacity-50",
  danger:
    "rounded-full border border-danger-fill/50 bg-danger-fill/10 p-2 text-danger transition hover:bg-danger-fill/20 disabled:opacity-50",
};

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: IconButtonVariant;
  children: ReactNode;
};

export default function IconButton({
  variant = "ghost",
  className,
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(VARIANT_CLASS[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

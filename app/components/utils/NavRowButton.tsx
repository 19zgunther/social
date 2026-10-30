import type { ReactNode } from "react";

export default function NavRowButton({
  icon,
  active = false,
  showCircle,
  onClick,
  className,
}: {
  icon: ReactNode;
  active?: boolean;
  showCircle: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center py-3 text-sm font-medium transition active:scale-95 active:opacity-80 ${className ?? ""}`}
    >
      <span
        className={`relative flex items-center justify-center rounded-xl p-2 transition-colors duration-150 ${
          active ? "bg-accent/15" : "bg-transparent"
        }`}
      >
        {icon}
        {showCircle ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent"
          />
        ) : null}
      </span>
    </button>
  );
}

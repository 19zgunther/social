import type { ReactNode } from "react";

export default function NavRowButton({
  icon,
  showCircle,
  onClick,
  className,
}: {
  icon: ReactNode;
  showCircle: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition ${className ?? ""}`}
    >
      {icon}
      {showCircle && (
        <div className="rounded-full bg-accent text-on-accent text-xs font-medium px-1 py-1" />
      )}
    </button>
  );
}

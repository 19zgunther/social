

export default function NavRowButton({
    icon,
    isActive,
    showCircle,
    onClick,
    className,
}: {
    icon: React.ReactNode;
    isActive: boolean;
    showCircle: boolean;
    onClick: () => void;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition ${className} ${isActive
                ? "text-accent-3"
                : "text-accent-2 hover:text-foreground"
                }`}
        >
            {icon}
            {showCircle && <div className="rounded-full bg-accent-3 text-primary-background text-xs font-medium px-1 py-1" />}
        </button>
    )
}
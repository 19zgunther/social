

export default function NavRowButton({
    icon,
    isActive,
    showCircle,
    onClick,
}: {
    icon: React.ReactNode;
    isActive: boolean;
    showCircle: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center justify-center gap-2 py-3 text-sm font-medium transition ${isActive
                ? "text-accent-3"
                : "text-accent-2 hover:text-foreground"
                }`}
        >
            {icon}
            {showCircle && <div className="rounded-full bg-accent-3 text-primary-background text-xs font-medium px-1 py-1" />}
        </button>
    )
}
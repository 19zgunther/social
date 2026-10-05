
export default function NavRowButton({
    iconClassName,
    isActive,
    showCircle,
    onClick,
    className,
}: {
    iconClassName: string;
    isActive: boolean;
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
            <span
                aria-hidden
                className={`nav-rgb-icon ${iconClassName}${isActive ? " nav-rgb-icon-active" : ""}`}
            />
            {showCircle && <div className="rounded-full bg-accent text-on-accent text-xs font-medium px-1 py-1" />}
        </button>
    )
}

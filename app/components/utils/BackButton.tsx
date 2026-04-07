import { ArrowLeft } from "lucide-react";

export default function BackButton({
    onBack,
    backLabel,
    textOnly = false,
}: {
    onBack: () => void;
    backLabel: string;
    textOnly?: boolean;
}) {
    const buttonClassName = textOnly
        ? "border-0 bg-transparent p-0 text-sm font-medium text-accent-2 transition hover:text-foreground"
        : "rounded-full border border-accent-1 bg-primary-background px-3 py-1.5 text-sm font-medium text-accent-2 transition hover:text-foreground";

    return (
        <button
          type="button"
          onClick={onBack}
          className={buttonClassName}
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </button>
    );
}
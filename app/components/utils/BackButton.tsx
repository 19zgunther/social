

export default function BackButton({ onBack, backLabel }: { onBack: () => void, backLabel: string }) {
    return (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-accent-1 bg-primary-background px-3 py-1.5 text-xs font-medium text-accent-2 transition hover:text-foreground"
        >
          {"<"} {backLabel}
        </button>
    );
}
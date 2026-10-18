import { BackIcon } from "@/app/components/Icons";

export default function BackButton({
  onBack,
  backLabel = "Back",
}: {
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
    >
      <BackIcon className="h-4 w-4 shrink-0" />
      {backLabel}
    </button>
  );
}

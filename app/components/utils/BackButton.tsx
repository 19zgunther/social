import { BackIcon } from "@/app/components/Icons";

export default function BackButton({
  onBack,
  backLabel = "",
}: {
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={backLabel || "Back"}
      className="inline-flex items-center gap-1.5 px-3 text-sm text-muted transition hover:text-foreground"
    >
      <BackIcon className="h-5 w-5 shrink-0" />
      {backLabel}
    </button>
  );
}

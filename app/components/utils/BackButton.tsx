import { ArrowLeft } from "lucide-react";

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
      className="inline-flex items-center gap-1.5 text-sm text-accent-2 transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" />
      {backLabel}
    </button>
  );
}

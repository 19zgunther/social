import { APP_VIEWPORT_STYLE, MOBILE_FRAME_STYLE } from "@/app/components/utils";
import Loader from "@/app/components/Loader";

export default function CheckingSessionPage() {
  return (
    <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0">
      <section
        style={MOBILE_FRAME_STYLE}
        className="flex h-full flex-col items-center justify-center gap-4 border border-border bg-surface px-6"
      >
        <Loader />
        <p className="text-sm text-muted">Checking your session...</p>
      </section>
    </main>
  );
}

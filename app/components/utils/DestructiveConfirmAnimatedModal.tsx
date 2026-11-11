"use client";

import type { ReactNode } from "react";
import AnimatedModal from "@/app/components/utils/AnimatedModal";
import { Button } from "@/app/ui-components";

type DestructiveConfirmAnimatedModalProps = {
  isPresented: boolean;
  isClosing?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  busy?: boolean;
  ariaLabel?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
};

export default function DestructiveConfirmAnimatedModal({
  isPresented,
  isClosing = false,
  onClose,
  onConfirm,
  title,
  message,
  busy = false,
  ariaLabel,
  cancelLabel = "Cancel",
  confirmLabel = "Remove",
  confirmingLabel = "Removing…",
}: DestructiveConfirmAnimatedModalProps) {
  return (
    <AnimatedModal
      isPresented={isPresented}
      isClosing={isClosing}
      onClose={onClose}
      ariaLabel={ariaLabel ?? title}
      title={title}
      closeDisabled={busy}
      rootClassName="z-[2300] px-4"
      panelClassName="max-w-sm bg-bg shadow-xl"
    >
      <div className="space-y-4 px-4 pb-4 pt-1">
        <div className="text-sm text-foreground">{message}</div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}

"use client";

import { ChangeEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AddIcon, AddImageIcon, CameraIcon, EmojiIcon } from "@/app/components/Icons";
import EmojiPicker from "@/app/components/utils/EmojiPicker";
import { BlurOptionsList, BlurOptionsListItem, IconButton } from "@/app/ui-components";

/** Below message-options overlay (1950); above thread chrome. Below EmojiPicker (2000). */
const ATTACH_MENU_OVERLAY_Z = 1900;
const MENU_GAP_ABOVE_TRIGGER_PX = 8;

type ThreadComposerAttachMenuProps = {
  disabled?: boolean;
  onTakePhoto: () => void;
  onUploadPhoto: (file: File) => void;
  onSendEmoji: (emoji: string) => void;
};

type MenuAnchor = {
  left: number;
  /** Distance from viewport bottom to the top of the + button, plus gap. */
  bottom: number;
  /** Distance from viewport bottom to the top of the + button (backdrop cutoff). */
  backdropBottom: number;
};

export default function ThreadComposerAttachMenu({
  disabled = false,
  onTakePhoto,
  onUploadPhoto,
  onSendEmoji,
}: ThreadComposerAttachMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [emojiOpenRequestId, setEmojiOpenRequestId] = useState(0);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const triggerWrapRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = () => {
    setIsOpen(false);
  };

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuAnchor(null);
      return;
    }

    const updateAnchor = () => {
      const trigger = triggerWrapRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const backdropBottom = Math.max(0, window.innerHeight - rect.top);
      setMenuAnchor({
        left: Math.max(8, rect.left),
        bottom: backdropBottom + MENU_GAP_ABOVE_TRIGGER_PX,
        backdropBottom,
      });
    };

    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [isOpen]);

  const onToggleMenu = () => {
    if (disabled) {
      return;
    }
    setIsOpen((open) => !open);
  };

  const onSelectSendEmoji = () => {
    closeMenu();
    setEmojiOpenRequestId((previous) => previous + 1);
  };

  const onSelectTakePhoto = () => {
    closeMenu();
    onTakePhoto();
  };

  const onSelectUploadPhoto = () => {
    closeMenu();
    photoInputRef.current?.click();
  };

  const onPhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    onUploadPhoto(file);
  };

  return (
    <>
      <div ref={triggerWrapRef} className="relative shrink-0">
        <IconButton
          type="button"
          variant="bordered"
          className={isOpen ? "text-foreground" : undefined}
          onClick={onToggleMenu}
          disabled={disabled}
          aria-label={isOpen ? "Close attach menu" : "Attach"}
          aria-expanded={isOpen}
        >
          <AddIcon
            className={`h-5 w-5 transition-transform duration-200 ${isOpen ? "rotate-45" : ""}`}
          />
        </IconButton>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPhotoInputChange}
      />

      <EmojiPicker
        hideTrigger
        openRequestId={emojiOpenRequestId}
        onSelectEmoji={onSendEmoji}
      />

      {menuAnchor ? (
        <BlurOptionsList
          open={isOpen}
          onClose={closeMenu}
          ariaLabel="Attach options"
          zIndex={ATTACH_MENU_OVERLAY_Z}
          left={menuAnchor.left}
          bottom={menuAnchor.bottom}
          backdropBottom={menuAnchor.backdropBottom}
        >
          <BlurOptionsListItem onClick={onSelectSendEmoji}>
            <EmojiIcon className="h-5 w-5 shrink-0 text-muted" />
            Send Emoji
          </BlurOptionsListItem>
          <BlurOptionsListItem onClick={onSelectTakePhoto}>
            <CameraIcon className="h-5 w-5 shrink-0 text-muted" />
            Take Photo
          </BlurOptionsListItem>
          <BlurOptionsListItem onClick={onSelectUploadPhoto}>
            <AddImageIcon className="h-5 w-5 shrink-0 text-muted" />
            Upload Photo
          </BlurOptionsListItem>
        </BlurOptionsList>
      ) : null}
    </>
  );
}

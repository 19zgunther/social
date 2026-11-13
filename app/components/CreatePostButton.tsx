"use client";

import { CollagePromptButton } from "@/app/ui-components";

const CREATE_POST_COLLAGE_KEYS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

const CREATE_POST_PROMPTS = [
  "camping",
  "fishing",
  "hiking",
  "friends",
  "sunsets",
  "family",
  "holidays",
  "you",
] as const;

type CreatePostButtonProps = {
  onClick: () => void;
};

export default function CreatePostButton({ onClick }: CreatePostButtonProps) {
  return (
    <CollagePromptButton
      onClick={onClick}
      ariaLabel="Create post"
      promptPrefix="Post about"
      prompts={[...CREATE_POST_PROMPTS]}
      imageSrcs={CREATE_POST_COLLAGE_KEYS.map(
        (key) => `/api/default-post-button-images/${encodeURIComponent(key)}`,
      )}
    />
  );
}

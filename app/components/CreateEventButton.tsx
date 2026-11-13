"use client";

import { CollagePromptButton } from "@/app/ui-components";

/** Bundled defaults used as diagonal slices on the empty-state create button. */
const CREATE_EVENT_COLLAGE_KEYS = [
  "party_1",
  "hike_1",
  "drinks_2",
  "dance_party_1",
  "ski_1",
  "movie_1",
  "halloween",
  "christmas_2",
] as const;

const CREATE_EVENT_PROMPTS = [
  "movie night",
  "house party",
  "camping trip",
  "hiking trip",
  "ski trip",
  "get together",
] as const;

type CreateEventButtonProps = {
  onClick: () => void;
};

export default function CreateEventButton({ onClick }: CreateEventButtonProps) {
  return (
    <CollagePromptButton
      onClick={onClick}
      ariaLabel="Create event"
      promptPrefix="Plan your next"
      prompts={[...CREATE_EVENT_PROMPTS]}
      imageSrcs={CREATE_EVENT_COLLAGE_KEYS.map(
        (key) => `/api/default-event-images/${encodeURIComponent(key)}`,
      )}
    />
  );
}

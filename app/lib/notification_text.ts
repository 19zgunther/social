const CUSTOM_EMOJI_TOKEN_GLOBAL_REGEX = /\[\[(?:(?:emoji|ce):)?[a-f0-9-]{36}\]\]/gi;
const CUSTOM_EMOJI_TOKEN_REGEX = /^\[\[(?:(?:emoji|ce):)?([a-f0-9-]{36})\]\]$/i;
const MULTISPACE_REGEX = /\s+/g;
/** Allows unicode emoji sequences (incl. ZWJ / skin tones) and emoji components. */
const EMOJI_ONLY_TEXT_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
/**
 * True "emoji present" check. Extended_Pictographic alone misses flags (regional
 * indicators) and keycaps (digit/#/* + U+20E3), which would then render as comments.
 */
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

export const sanitizeNotificationText = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  return value.replace(CUSTOM_EMOJI_TOKEN_GLOBAL_REGEX, " ").replace(MULTISPACE_REGEX, " ").trim();
};

/** True when text is only a unicode emoji reaction or a custom-emoji token. */
export const isEmojiOnlyText = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    (Boolean(trimmed) && EMOJI_ONLY_TEXT_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed))
    || CUSTOM_EMOJI_TOKEN_REGEX.test(trimmed)
  );
};

const CUSTOM_EMOJI_TOKEN_GLOBAL_REGEX = /\[\[(?:(?:emoji|ce):)?[a-f0-9-]{36}\]\]/gi;
const MULTISPACE_REGEX = /\s+/g;

export const sanitizeNotificationText = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  return value.replace(CUSTOM_EMOJI_TOKEN_GLOBAL_REGEX, " ").replace(MULTISPACE_REGEX, " ").trim();
};

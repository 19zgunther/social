/** Shared username rules for humans, bots, and composed `{primary}_{devname}` accounts. */
export const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export const USERNAME_RULES_MESSAGE =
  "Username must be 3–32 characters: letters, numbers, or underscores.";

/** Max linked child/dev accounts under one primary developer. */
export const MAX_DEV_ACCOUNTS_PER_PRIMARY = 5;

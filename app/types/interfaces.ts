export type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type {
  ThemeColors,
  ThemeInfo,
  ThemePresetId,
} from "@/app/lib/theme";
import type { ThemeInfo } from "@/app/lib/theme";

export type AuthUser = {
  user_id: string;
  username: string;
  email: string | null;
  profile_image_id: string | null;
  profile_image_url: string | null;
  minted_at: number;
  theme_info?: ThemeInfo | null;
  /** When set, this is a child/dev account linked to the primary user. */
  primary_user_id?: string | null;
  /** Server-computed: family root is a developer (do not infer from a client allowlist). */
  can_use_dev_account_switcher?: boolean;
};

/** One row in Profile → Settings → Dev Account Switcher. */
export type DevAccountListItem = {
  user_id: string;
  username: string;
  profile_image_id: string | null;
  profile_image_url: string | null;
  is_current: boolean;
  is_primary: boolean;
};

export type DevAccountsListResponse = {
  accounts: DevAccountListItem[];
};

/** Username suffix only — server composes `{primary}_{suffix}`; email/password null. */
export type DevAccountCreateRequest = {
  username?: string;
};

export type DevAccountSwitchRequest = {
  target_user_id?: string;
};

/** Omit target_user_id to reset the currently authenticated child account. */
export type DevAccountResetRequest = {
  target_user_id?: string;
};

export type DevAccountResetResponse = {
  ok: true;
};

export type PostCommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, PostCommentNode>;
  /** Present when the author removed the comment but replies were preserved. */
  deleted?: boolean;
};

export type PollSelectionMode = "single" | "multiple";
export type PollDurationHours = 12 | 24 | 48 | 168;

export type PollOption = {
  id: string;
  text: string;
};

/** Stored in posts.data.poll (server-side). */
export type PollData = {
  options: PollOption[];
  selection_mode: PollSelectionMode;
  allow_vote_changes: boolean;
  closes_at: string;
  votes: Record<string, string[]>;
};

/** Create-time poll config (no votes / closes_at). */
export type PollCreateInput = {
  options: Array<{ text: string }>;
  selection_mode: PollSelectionMode;
  allow_vote_changes: boolean;
  duration_hours: PollDurationHours;
};

export type PollResultRow = {
  option_id: string;
  count: number;
};

/** Viewer-facing poll returned in PostItem.data.poll. */
export type PollViewerState = {
  options: PollOption[];
  selection_mode: PollSelectionMode;
  allow_vote_changes: boolean;
  closes_at: string;
  has_voted: boolean;
  viewer_selection: string[];
  is_closed: boolean;
  results: PollResultRow[] | null;
  total_voters: number | null;
};

export type TierListTier = {
  id: string;
  name: string;
};

export type TierListOption = {
  id: string;
  text: string;
};

/** Stored in posts.data.tier_list (server-side). */
export type TierListData = {
  tiers: TierListTier[];
  options: TierListOption[];
  /** userId → optionId → tierId */
  submissions: Record<string, Record<string, string>>;
};

/** Create-time tier list config (no submissions / ids). */
export type TierListCreateInput = {
  tiers: Array<{ name: string }>;
  options: Array<{ text: string }>;
};

export type TierListResultCell = {
  tier_id: string;
  option_id: string;
  percentage: number;
};

/** Viewer-facing tier list returned in PostItem.data.tier_list. */
export type TierListViewerState = {
  tiers: TierListTier[];
  options: TierListOption[];
  has_submitted: boolean;
  viewer_assignment: Record<string, string> | null;
  results: TierListResultCell[] | null;
  total_submitters: number | null;
};

export type PostMediaKind = "image" | "video";

export type PostMediaItem = {
  id: string;
  kind: PostMediaKind;
  /** JPEG still for video slides (required when kind is video). */
  poster_id?: string;
  /** Storage owner for shared-event media (path `{owner}/{id}`). */
  owner_user_id?: string;
};

export type PostData = {
  comments?: Record<string, PostCommentNode>;
  likes?: Record<string, boolean>;
  /** Ordered slides (images + videos). Active source of truth for post media. */
  media?: PostMediaItem[];
  /**
   * DEAD / legacy — do not read or write. Historical extra image ids before `media`.
   * Kept in stored JSON only; use `media` instead.
   */
  other_image_ids?: string[];
  /** Storage uses PollData; API responses replace with PollViewerState. */
  poll?: PollData | PollViewerState;
  /** Storage uses TierListData; API responses replace with TierListViewerState. */
  tier_list?: TierListData | TierListViewerState;
};

export type PostItem = {
  id: string;
  created_at: string;
  created_by: string;
  text: string;
  data: PostData | null;
  /**
   * First-paint cover still from `data.media[0]` (image id or video poster).
   * Not `posts.image_id` — derived for list/create responses only.
   */
  cover_image_id?: string | null;
  /** Viewer-bound grant for `cover_image_id`; remaining media via `/api/image-access-grants`. */
  cover_image_access_grant?: string | null;
  like_count?: number;
  is_liked_by_viewer?: boolean;
  username: string;
  email: string | null;
  /** True when the author user_id is a bot persona (bots.user_id). */
  is_bot?: boolean;
  /** True when the viewer may delete this post (author, or owner of the authoring bot). */
  viewer_can_delete?: boolean;
  author_profile_image_id?: string | null;
  /** Legacy; always null from list/create APIs. */
  author_profile_image_url?: string | null;
  author_profile_image_access_grant?: string | null;
};

export type ImageOverlayData = {
  text: string;
  y_ratio: number;
};

export type ThreadItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_username: string;
  /** True when this is a 1:1 direct message thread. */
  is_direct?: boolean;
  /** Member user ids for avatar collage when the thread has no group photo. */
  member_user_ids?: string[];
  /** Member usernames for Messages search. */
  member_usernames?: string[];
  /** Whether the current user has pinned this thread. */
  user_pinned_thread?: boolean;
  image_id?: string | null;
  image_url?: string | null;
  /** Thread-scoped grant for `image_id`; resolve with `imageThreadId` = this thread's `id`. */
  image_access_grant?: string | null;
  /** Short preview of the latest message text (or photo fallback) for the Messages list. */
  last_message_preview?: string | null;
  /** Present when this thread was created by an event with a background image. */
  event_background_image_id?: string | null;
  /** Thread-scoped grant for the event background image; resolve with `imageThreadId` = this thread's `id`. */
  event_background_image_access_grant?: string | null;
};

import type { VideoCallSignal } from "@/app/components/utils/webrtcVideoCall";

export type ThreadMemberFriendshipStatus =
  | "self"
  | "none"
  | "friends"
  | "pending_sent"
  | "pending_received"
  | "rejected";

export type MessageData = {
  image_overlay?: ImageOverlayData;
  video_call_signal?: VideoCallSignal;
};

export type ThreadMessage = {
  id: string;
  text: string;
  created_at: string;
  created_by: string;
  parent_id: string | null;
  image_id: string | null;
  image_url: string | null;
  image_access_grant?: string | null;
  data: MessageData | null;
  direct_reply_count: number;
  username: string;
};

export type ThreadMember = {
  user_id: string;
  username: string;
  email: string | null;
  is_owner: boolean;
  friendship_status: ThreadMemberFriendshipStatus;
};

export type FriendRelation = {
  id: string;
  direction: "outgoing" | "incoming";
  accepted: boolean | null;
};

export type FriendSearchResult = {
  id: string;
  username: string;
  email: string | null;
  relation: FriendRelation | null;
};

export type IncomingFriendRequest = {
  id: string;
  requesting_user_id: string;
  requested_at: string;
  username: string;
  email: string | null;
};

export type OutgoingFriendRequest = {
  id: string;
  other_user_id: string;
  requested_at: string;
  accepted: boolean | null;
  accepted_at: string | null;
  username: string;
  email: string | null;
};

export type AcceptedFriend = {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  accepted_at: string | null;
};

export type SyncEvent = {
  id: string;
  type: "thread_message_posted" | "thread_message_updated";
  thread_id: string;
  message_id: string;
  created_by: string;
};

export type AuthCheckResponse = AuthUser;
export type LoginRequest = { identifier?: string; password?: string };
export type LoginResponse = { token: string; user: AuthUser };
export type TempLoginEmailRequest = { identifier?: string };
export type TempLoginEmailResponse = { message: string };
export type SignupRequest = { username?: string; email?: string; password?: string };
export type SignupResponse = { token: string; user: AuthUser };

export type FeedPostsListRequest = {
  /** ISO timestamp of the last item's `created_at`. */
  cursor?: string;
  /** @deprecated Prefer `cursor`. */
  cursor_post_id?: string;
};
export type FeedPostsListResponse = {
  viewer_user_id?: string;
  posts: PostItem[];
  has_more: boolean;
  next_cursor: string | null;
  next_cursor_post_id: string | null;
};

export type EventAlbumPhase = "open" | "pending" | "released";

export type EventContributeRequest = {
  event_id?: string;
  media?: PostMediaItem[];
};
export type EventContributeResponse = {
  ok: true;
  contributed_count: number;
};

export type EventPublishPostRequest = {
  event_id?: string;
};
export type EventPublishPostResponse = {
  post: PostItem;
  event: ThreadEventItem;
};

export type ProfilePostsListRequest = { cursor_post_id?: string };
export type ProfilePostsListResponse = {
  posts: PostItem[];
  has_more: boolean;
  next_cursor_post_id: string | null;
};

export type UserProfileImageEntry = {
  profile_image_id: string | null;
  profile_image_access_grant: string | null;
};

export type UserProfileImagesRequest = { user_ids?: string[] };
export type UserProfileImagesResponse = {
  profiles: Record<string, UserProfileImageEntry>;
};

export type PostAudienceMode = "permanent" | "all" | "group";

export type PostAudienceRequest = {
  mode: PostAudienceMode;
  /** Required when mode is "group". */
  group_id?: string;
};

export type PostCreateRequest = {
  text?: string;
  /** Optional single image; folded into `data.media` on create. Prefer `data.media`. */
  image_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
  data?: unknown;
  /** Defaults to permanent (all current and future friends). */
  audience?: PostAudienceRequest;
};
export type PostCreateResponse = { post: PostItem };
export type FeedPostPollVotersRequest = {
  post_id?: string;
};
export type FeedPostPollVoter = {
  user_id: string;
  username: string;
};
export type FeedPostPollVotersOption = {
  option_id: string;
  text: string;
  voters: FeedPostPollVoter[];
};
export type FeedPostPollVotersResponse = {
  options: FeedPostPollVotersOption[];
};

export type FeedPostTierListSubmitRequest = {
  post_id?: string;
  assignment?: Record<string, string>;
};

export type FeedPostTierListSubmissionsRequest = {
  post_id?: string;
};

export type FeedPostTierListSubmissionUser = {
  user_id: string;
  username: string;
  /** optionId → tierId */
  assignment: Record<string, string>;
};

export type FeedPostTierListSubmissionsResponse = {
  tiers: TierListTier[];
  options: TierListOption[];
  submissions: FeedPostTierListSubmissionUser[];
};

export type PostEditRequest = {
  post_id?: string;
  text?: string;
};
export type PostEditResponse = {
  post: {
    id: string;
    text: string;
  };
};

export type ImageUploadSignRequest = {
  phase: "sign";
  image_mime_type: string;
};
export type ImageUploadSignResponse = {
  image_id: string;
  signed_upload_url: string;
  upload_token: string;
  storage_path: string;
};
export type ImageUploadCompleteRequest = {
  phase: "complete";
  image_id: string;
};
export type ImageUploadRequest =
  | ImageUploadSignRequest
  | ImageUploadCompleteRequest
  | {
      image_base64_data?: string;
      image_mime_type?: string;
    };
export type ImageUploadResponse = {
  image_id: string;
  image_url: string;
};

export type MessagesListResponse = { threads: ThreadItem[] };

export type ThreadMessagesRequest = {
  thread_id?: string;
  cursor_message_id?: string;
};
export type ThreadMessagesResponse = {
  thread: {
    id: string;
    name: string;
    owner_user_id: string;
    image_id?: string | null;
    image_url?: string | null;
    image_access_grant?: string | null;
    event_background_image_id?: string | null;
    event_background_image_access_grant?: string | null;
    is_direct?: boolean;
  };
  viewer_user_id: string;
  has_more_older: boolean;
  next_cursor_message_id: string | null;
  messages: ThreadMessage[];
};

export type ThreadSendRequest = {
  thread_id?: string;
  text?: string;
  reply_to_message_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
  message_data?: unknown;
};
export type ThreadSendResponse = {
  message: ThreadMessage;
};

export type ThreadMembersRequest = { thread_id?: string };
export type ThreadMembersResponse = {
  thread_id: string;
  is_owner: boolean;
  members: ThreadMember[];
};

export type ThreadEventRsvpStatus = "going" | "maybe" | "not_going";

export type ThreadEventItem = {
  id: string;
  created_at: string;
  updated_at: string;
  thread_id: string;
  created_by: string;
  name: string;
  location: string | null;
  description: string | null;
  users_status_map: Record<string, ThreadEventRsvpStatus>;
  /** User ids with the `cohost` role on this event (not including created_by). */
  cohost_user_ids: string[];
  starts_at: string;
  ends_at: string;
  background_image_id: string | null;
  background_image_url: string | null;
  background_image_access_grant?: string | null;
  /** When true, album media is hidden until `release_at`; contributions close at `close_at`. */
  blind_reveal: boolean;
  close_at: string | null;
  release_at: string | null;
  /** Album media payload. Media is omitted while blind and unreleased. */
  shared_post_data?: PostData | null;
  /** Blind events: open / pending / released. Non-blind events are always "open". */
  album_phase?: EventAlbumPhase;
  /** Total media items in the album (available even while media is hidden). */
  album_media_count?: number;
  /** True when the viewer has contributed at least one media item. */
  viewer_has_contributed?: boolean;
  /** Feed post created when the event album is published; null until then. */
  published_post_id: string | null;
};

export type ThreadEventCohostAddRequest = {
  thread_id?: string;
  event_id?: string;
  user_id?: string;
};
export type ThreadEventCohostAddResponse = { event: ThreadEventItem };

export type ThreadEventCohostRemoveRequest = {
  thread_id?: string;
  event_id?: string;
  user_id?: string;
};
export type ThreadEventCohostRemoveResponse = { event: ThreadEventItem };

export type ThreadEventsListRequest = { thread_id?: string };
export type ThreadEventsListResponse = { events: ThreadEventItem[] };

export type UserUpcomingEventsRequest = {
  /** When true, return ended events (newest first) instead of upcoming. */
  past?: boolean;
};

export type UserUpcomingEventsResponse = {
  items: UserUpcomingEventListItem[];
};

/** Global upcoming-events tab: thread context plus event (for navigation and display). */
export type UserUpcomingEventListItem = {
  thread: ThreadItem;
  event: ThreadEventItem;
};

export type ThreadEventCreateRequest = {
  thread_id?: string;
  name?: string;
  location?: string;
  description?: string;
  /** ISO; optional — defaults to now and one hour later. */
  starts_at?: string;
  /** ISO; optional — defaults to one hour after starts. */
  ends_at?: string;
};
export type ThreadEventCreateResponse = { event: ThreadEventItem };

export type EventCreateRequest = {
  name?: string;
  location?: string;
  description?: string;
  /** ISO; optional — defaults to now and one hour later. */
  starts_at?: string;
  /** ISO; optional — defaults to one hour after starts. */
  ends_at?: string;
  /** Hide album media until release_at. Requires close_at and release_at. */
  blind_reveal?: boolean;
  /** ISO; required when blind_reveal is true. */
  close_at?: string;
  /** ISO; required when blind_reveal is true. */
  release_at?: string;
  /** Accepted friends to add to the event thread. */
  invitee_user_ids?: string[];
  /**
   * Bundled default background key (e.g. `hike_1`).
   * Required unless `image_base64_data` + `image_mime_type` are provided.
   */
  default_background_key?: string;
  /** Custom background upload. Required with mime type unless `default_background_key` is set. */
  image_base64_data?: string;
  image_mime_type?: string;
};
export type EventCreateResponse = {
  thread: ThreadItem;
  event: ThreadEventItem;
};

export type ThreadEventUpdateRequest = {
  thread_id?: string;
  event_id?: string;
  name?: string;
  location?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  /** Hide album media until release_at. Requires close_at and release_at. */
  blind_reveal?: boolean;
  /** ISO; required when blind_reveal is true. */
  close_at?: string;
  /** ISO; required when blind_reveal is true. */
  release_at?: string;
};
export type ThreadEventUpdateResponse = { event: ThreadEventItem };

export type ThreadEventBackgroundSetRequest = {
  thread_id?: string;
  event_id?: string;
  /** When true, clears the background (`background_image_id = null`). */
  clear?: boolean;
  /** Bundled default background key (e.g. `hike_1`). */
  default_background_key?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};
export type ThreadEventBackgroundSetResponse = { event: ThreadEventItem };

export type ThreadEventRsvpRequest = {
  thread_id?: string;
  event_id?: string;
  status?: ThreadEventRsvpStatus;
};
export type ThreadEventRsvpResponse = { event: ThreadEventItem };

export type ThreadEventDeleteRequest = {
  thread_id?: string;
  event_id?: string;
};
export type ThreadEventDeleteResponse = { deleted_event_id: string };

export type SyncRequest = { timeout_ms?: number; max_events?: number };
export type SyncResponse = { events: SyncEvent[] };

export type FriendSearchRequest = { query?: string };
export type FriendSearchResponse = { users: FriendSearchResult[] };

export type FriendRequestsListResponse = {
  incoming_requests: IncomingFriendRequest[];
  outgoing_requests: OutgoingFriendRequest[];
  accepted_friends: AcceptedFriend[];
};

export type ProfileImageSetResponse = {
  profile_image_id: string;
  profile_image_url: string;
};

export type ProfileImageRemoveResponse = {
  profile_image_id: null;
  profile_image_url: null;
};

export type ThreadImageSetResponse = {
  thread_id: string;
  image_id: string;
  image_url: string | null;
  image_access_grant: string;
};

export type ThreadImageRemoveResponse = {
  thread_id: string;
  image_id: null;
  image_url: null;
};

export type UserProfileRequest = {
  user_id?: string;
  cursor_post_id?: string;
};

export type UserProfileBotInfo = {
  bot_id: string;
  description: string;
  /** Effective privacy: true only when bots.is_private is exactly true (null = public). */
  is_private: boolean;
  owner_user_id: string;
  owner_username: string;
  is_owner: boolean;
};

export type UserProfileResponse = {
  user: {
    id: string;
    username: string;
    profile_image_id: string | null;
    profile_image_url: string | null;
    profile_image_access_grant?: string | null;
  };
  /** Present when this profile is a bot persona account. */
  bot?: UserProfileBotInfo | null;
  friendship_status: "none" | "friends" | "pending_sent" | "pending_received" | "rejected";
  friendship_id: string | null;
  posts: PostItem[];
  has_more: boolean;
  next_cursor_post_id: string | null;
};

export type EmojiItem = {
  uuid: string;
  created_at: string;
  updated_at: string;
  name: string;
  data_b64: string;
};

export type EmojisListRequest = {
  client_known?: Array<{ uuid: string; updated_at: string }>;
};

export type EmojisListResponse = {
  /** New or changed rows since the client’s known revisions. */
  emojis: EmojiItem[];
  /** UUIDs the client had cached but no longer exist for this user. */
  removed_uuids?: string[];
};

export type EmojiSaveRequest = {
  emoji_uuid?: string;
  name?: string;
  data_b64?: string;
};

export type EmojiSaveResponse = {
  emoji: EmojiItem;
};

export type EmojisResolveResponse = {
  emojis_by_uuid: Record<string, EmojiItem>;
};

export type PostGroup = {
  id: string;
  name: string;
  member_ids: string[];
};

export type PostGroupsData = {
  groups: PostGroup[];
};

export type PostGroupsGetResponse = PostGroupsData;

export type PostGroupsSetRequest = PostGroupsData;

export type PostGroupsSetResponse = PostGroupsData;

export type BotWakePeriod = "24h" | "1w";

export type BotListItem = {
  id: string;
  user_id: string;
  username: string;
  profile_image_id: string | null;
  profile_image_url: string | null;
  wake_period: BotWakePeriod;
  /** Local wall-clock "HH:MM" in `wake_timezone`. */
  wake_time: string;
  /** 0 = Sunday … 6 = Saturday; only used when `wake_period` is "1w". */
  wake_weekday: number;
  /** IANA timezone name, e.g. "America/New_York". */
  wake_timezone: string;
  last_woke_at: string | null;
};

export type BotsListResponse = {
  bots: BotListItem[];
};

export type BotCreateRequest = {
  username?: string;
  /** Null/omitted = public (default). */
  is_private?: boolean | null;
};

export type BotCreateResponse = {
  bot: BotDetail;
};

export type BotGetRequest = {
  bot_id?: string;
};

export type BotDetail = {
  id: string;
  user_id: string;
  username: string;
  profile_image_id: string | null;
  profile_image_url: string | null;
  system_prompt: string;
  description: string;
  /** Null = public (default for existing bots). */
  is_private: boolean | null;
  wake_period: BotWakePeriod;
  /** Local wall-clock "HH:MM" in `wake_timezone`. */
  wake_time: string;
  /** 0 = Sunday … 6 = Saturday; only used when `wake_period` is "1w". */
  wake_weekday: number;
  /** IANA timezone name, e.g. "America/New_York". */
  wake_timezone: string;
  rss_feeds: string[];
  last_woke_at: string | null;
  created_at: string;
  updated_at: string;
  owner_user_id: string;
  owner_username: string;
  /** True when the authenticated viewer owns this bot. */
  is_owner: boolean;
};

export type BotGetResponse = {
  bot: BotDetail;
};

export type BotUpdateRequest = {
  bot_id?: string;
  username?: string;
  system_prompt?: string;
  description?: string;
  is_private?: boolean | null;
  wake_period?: BotWakePeriod;
  wake_time?: string;
  wake_weekday?: number;
  wake_timezone?: string;
  rss_feeds?: string[];
};

export type BotUpdateResponse = {
  bot: BotDetail;
};

export type BotDeleteRequest = {
  bot_id?: string;
};

export type BotDeleteResponse = {
  ok: true;
  bot_id: string;
};

export type BotProfileImageSetRequest = {
  bot_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};

export type BotProfileImageRemoveRequest = {
  bot_id?: string;
};

export type BotWakeRequest = {
  bot_id?: string;
};

export type BotWakeResponse = {
  log_id: string;
  status: "completed" | "failed";
  error?: string;
};

export type BotLogListItem = {
  id: string;
  created_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
};

export type BotLogsListRequest = {
  bot_id?: string;
};

export type BotLogsListResponse = {
  logs: BotLogListItem[];
};

export type BotLogGetRequest = {
  log_id?: string;
};

export type BotLogDetail = BotLogListItem & {
  bot_id: string;
  messages: unknown;
};

export type BotLogGetResponse = {
  log: BotLogDetail;
};

/** Leaderboard partition within a game (e.g. tetris uses "global"). */
export type GameScoreScope = "all" | "friends";

export type GameScoreSubmitRequest = {
  game?: string;
  level?: string;
  score?: number;
};

export type GameScoreSubmitResponse = {
  id: string;
  game: string;
  level: string;
  score: number;
  created_at: string;
  /** 1-based rank of this run among all scores for the game/level. */
  run_rank: number;
  /** Your best score for this game/level. */
  personal_best: number;
  /** 1-based rank of your personal best among users' bests (all players). */
  personal_best_rank: number;
};

export type GameScoresLeaderboardRequest = {
  game?: string;
  level?: string;
  /** all-time everyone vs accepted friends (+ self). Default "all". */
  scope?: GameScoreScope;
  /** How many top personal-best rows to return (1–50). Default 20. */
  limit?: number;
};

export type GameScoreLeaderboardEntry = {
  user_id: string;
  username: string;
  score: number;
  created_at: string;
  /** 1-based rank among personal bests in this scope. */
  rank: number;
};

export type GameScoresLeaderboardResponse = {
  game: string;
  level: string;
  scope: GameScoreScope;
  top: GameScoreLeaderboardEntry[];
  /** Players with a personal best in this scope. */
  total: number;
  me: {
    user_id: string;
    username: string;
    personal_best: number | null;
    /** 1-based rank among personal bests in this scope; null if no scores. */
    rank: number | null;
  };
};

export type GameScoresPlayedRequest = {
  game?: string;
};

export type GameScoresPlayedResponse = {
  game: string;
  /** Distinct level ids the user has finished (has at least one score row). */
  levels: string[];
};

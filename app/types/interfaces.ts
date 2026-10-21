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
  /** Ordered slides (images + videos). Source of truth when present. */
  media?: PostMediaItem[];
  /** Legacy additional image ids; still written for backward compat. */
  other_image_ids?: string[];
  /** Storage uses PollData; API responses replace with PollViewerState. */
  poll?: PollData | PollViewerState;
  /** Storage uses TierListData; API responses replace with TierListViewerState. */
  tier_list?: TierListData | TierListViewerState;
};

export type FeedPostKind = "post" | "shared_event";

export type PostItem = {
  id: string;
  created_at: string;
  created_by: string;
  image_id: string | null;
  /** Always null from list/create APIs; use `image_access_grant` and `/api/image-resolve` via image cache. */
  image_url: string | null;
  /** Encrypted grant (viewer-bound, expiring); use with `image_id` and `created_by` as storage owner for resolve. */
  image_access_grant?: string | null;
  text: string;
  data: PostData | null;
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
  /** Defaults to "post" when omitted (legacy feed/cache items). */
  kind?: FeedPostKind;
  /** Present when kind is "shared_event". */
  title?: string;
  shared_post_id?: string;
  close_at?: string;
  release_at?: string;
};

export type ImageOverlayData = {
  text: string;
  y_ratio: number;
};

/** Latest incoming message from someone else when it is the most recent in the thread (Groups list: tap for preview or photo reply). */
export type ThreadLastPhotoPreview = {
  message_id: string;
  image_id: string | null;
  image_url: string | null;
  /** Main-bucket grant for message photo; use with `image_storage_user_id`. */
  image_access_grant?: string | null;
  /** `thread_messages.created_by` — storage owner for the message image. */
  image_storage_user_id?: string | null;
  image_overlay: ImageOverlayData | null;
};

export type ThreadItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_username: string;
  /** True when this is a 1:1 direct message thread. */
  is_direct?: boolean;
  participant_count?: number;
  image_id?: string | null;
  image_url?: string | null;
  /** Thread-scoped grant for `image_id`; resolve with `imageThreadId` = this thread's `id`. */
  image_access_grant?: string | null;
  /** ISO time of the chronologically latest message in the thread, if any. */
  last_message_at?: string | null;
  /** True when `last_message_at` refers to a message you sent (Groups list affordance). */
  last_message_from_self?: boolean;
  /** Present when the latest message is from someone else: image (tap to preview) or text-only (tap to reply with a photo). */
  last_photo_preview?: ThreadLastPhotoPreview | null;
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
  /** ISO timestamp of the last item's sort time (`created_at` / `release_at`). */
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

export type SharedPostPhase = "open" | "pending" | "released";

export type SharedPostContributorItem = {
  user_id: string;
  username: string;
  email: string | null;
  invited_at: string;
  has_contributed: boolean;
  profile_image_id?: string | null;
  profile_image_access_grant?: string | null;
};

export type SharedPostListItem = {
  id: string;
  created_at: string;
  created_by: string;
  title: string;
  text: string;
  close_at: string;
  release_at: string;
  phase: SharedPostPhase;
  contributor_count: number;
  others_contributed_count: number;
  viewer_has_contributed: boolean;
  viewer_invited_at: string | null;
  is_creator: boolean;
  /** Only populated when phase is "released". */
  image_id: string | null;
  image_url: string | null;
  image_access_grant?: string | null;
  data: PostData | null;
  like_count?: number;
  is_liked_by_viewer?: boolean;
  username: string;
  email: string | null;
  author_profile_image_id?: string | null;
  author_profile_image_access_grant?: string | null;
  contributors?: SharedPostContributorItem[];
};

export type SharedPostCreateRequest = {
  title?: string;
  text?: string;
  close_at?: string;
  release_at?: string;
  invitee_user_ids?: string[];
};
export type SharedPostCreateResponse = { shared_post: SharedPostListItem };

export type SharedPostUpdateRequest = {
  shared_post_id?: string;
  title?: string;
  text?: string;
  close_at?: string;
  release_at?: string;
  invitee_user_ids?: string[];
};
export type SharedPostUpdateResponse = { shared_post: SharedPostListItem };

export type SharedPostsListRequest = {
  /** Defaults to open + pending. Pass "released" to include released posts. */
  phases?: SharedPostPhase[];
};

export type SharedPostsListResponse = {
  open: SharedPostListItem[];
  pending: SharedPostListItem[];
  released: SharedPostListItem[];
};

export type SharedPostGetRequest = { shared_post_id?: string };
export type SharedPostGetResponse = { shared_post: SharedPostListItem };

export type SharedPostInviteRequest = {
  shared_post_id?: string;
  invitee_user_ids?: string[];
};
export type SharedPostInviteResponse = { shared_post: SharedPostListItem };

export type SharedPostContributeRequest = {
  shared_post_id?: string;
  media?: PostMediaItem[];
};
export type SharedPostContributeResponse = {
  ok: true;
  contributed_count: number;
};

export type SharedPostLikeRequest = {
  shared_post_id?: string;
  like?: boolean;
};
export type SharedPostLikeResponse = {
  data: PostData | null;
  like_count: number;
  is_liked_by_viewer: boolean;
};

export type SharedPostCommentRequest = {
  shared_post_id?: string;
  parent_path?: string[];
  message?: string;
  comment_path?: string[];
};
export type SharedPostCommentResponse = { data: PostData | null };

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

export type GroupsListResponse = { threads: ThreadItem[] };

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
  starts_at: string;
  ends_at: string;
  background_image_id: string | null;
  background_image_url: string | null;
  background_image_access_grant?: string | null;
};

export type ThreadEventsListRequest = { thread_id?: string };
export type ThreadEventsListResponse = { events: ThreadEventItem[] };

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
};
export type ThreadEventUpdateResponse = { event: ThreadEventItem };

export type ThreadEventBackgroundSetRequest = {
  thread_id?: string;
  event_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};
export type ThreadEventBackgroundSetResponse = { event: ThreadEventItem };

export type ThreadEventBackgroundRemoveRequest = {
  thread_id?: string;
  event_id?: string;
};
export type ThreadEventBackgroundRemoveResponse = { event: ThreadEventItem };

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

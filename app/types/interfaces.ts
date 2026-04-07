export type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type AuthUser = {
  user_id: string;
  username: string;
  email: string | null;
  profile_image_id: string | null;
  profile_image_url: string | null;
  minted_at: number;
};

export type PostCommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, PostCommentNode>;
  /** Present when the author removed the comment but replies were preserved. */
  deleted?: boolean;
};

export type PostData = {
  comments?: Record<string, PostCommentNode>;
  likes?: Record<string, boolean>;
  other_image_ids?: string[];
};

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
  author_profile_image_id?: string | null;
  /** Legacy; always null from list/create APIs. */
  author_profile_image_url?: string | null;
  author_profile_image_access_grant?: string | null;
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
};

import type { VideoCallSignal } from "@/app/components/utils/webrtcVideoCall";

export type ThreadMemberFriendshipStatus =
  | "self"
  | "none"
  | "friends"
  | "pending_sent"
  | "pending_received"
  | "rejected";

export type PoolBallState = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pocketed: boolean;
};

/** Turn-based pool game payload stored on thread_messages.data.pool_game */
export type PoolGameMessageData = {
  v: 1;
  game_id: string;
  /** Creator / first participant (always set). */
  player_a_username: string;
  /** Second participant — null until the first non-creator sends a pool move (first responder). */
  player_b_username: string | null;
  /** Whose shot; null means “waiting for first opponent shot” after the opener, or opponent’s turn when b is set (see isPoolTurnForUser). */
  current_turn_username: string | null;
  table_w: number;
  table_h: number;
  balls: PoolBallState[];
};

export type MessageData = {
  image_overlay?: ImageOverlayData;
  video_call_signal?: VideoCallSignal;
  pool_game?: PoolGameMessageData;
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
  profile_image_id: string | null;
  profile_image_url: string | null;
  profile_image_access_grant?: string | null;
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
  profile_image_id: string | null;
  profile_image_url: string | null;
  profile_image_access_grant?: string | null;
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
  profile_image_id: string | null;
  profile_image_url: string | null;
  profile_image_access_grant?: string | null;
};

export type AcceptedFriend = {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  accepted_at: string | null;
  profile_image_id: string | null;
  profile_image_url: string | null;
  profile_image_access_grant?: string | null;
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
export type SignupRequest = { username?: string; email?: string; password?: string };
export type SignupResponse = { token: string; user: AuthUser };

export type FeedPostsListRequest = { cursor_post_id?: string };
export type FeedPostsListResponse = {
  viewer_user_id?: string;
  posts: PostItem[];
  has_more: boolean;
  next_cursor_post_id: string | null;
};

export type ProfilePostsListRequest = { cursor_post_id?: string };
export type ProfilePostsListResponse = {
  posts: PostItem[];
  has_more: boolean;
  next_cursor_post_id: string | null;
};

export type PostCreateRequest = {
  text?: string;
  image_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
  data?: unknown;
};
export type PostCreateResponse = { post: PostItem };
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

export type UserProfileResponse = {
  user: {
    id: string;
    username: string;
    profile_image_id: string | null;
    profile_image_url: string | null;
    profile_image_access_grant?: string | null;
  };
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

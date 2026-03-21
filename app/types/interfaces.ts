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
  image_url: string | null;
  text: string;
  data: PostData | null;
  like_count?: number;
  is_liked_by_viewer?: boolean;
  username: string;
  email: string | null;
  author_profile_image_id?: string | null;
  author_profile_image_url?: string | null;
};

export type ThreadItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_username: string;
  image_id?: string | null;
  image_url?: string | null;
};

export type ImageOverlayData = {
  text: string;
  y_ratio: number;
};

import type { VideoCallSignal } from "@/app/components/utils/webrtcVideoCall";

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
  data: MessageData | null;
  direct_reply_count: number;
  username: string;
};

export type ThreadMember = {
  user_id: string;
  username: string;
  email: string | null;
  is_owner: boolean;
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
};

export type AcceptedFriend = {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  accepted_at: string | null;
  profile_image_id: string | null;
  profile_image_url: string | null;
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

export type ImageUploadRequest = {
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
  image_url: string;
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
  };
  friendship_status: "none" | "friends" | "pending_sent" | "pending_received" | "rejected";
  friendship_id: string | null;
  posts: PostItem[];
  has_more: boolean;
  next_cursor_post_id: string | null;
};

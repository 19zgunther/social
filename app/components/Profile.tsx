"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import PostSection, { PostItem } from "@/app/components/PostSection";
import { prepareImageForUpload } from "@/app/components/client_file_storage_utils";

type ProfileProps = {
  userId: string;
  username: string;
  email: string | null;
};

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

const AUTH_TOKEN_KEY = "auth_token";

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated.");
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function Profile({ userId, username, email }: ProfileProps) {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [createCaption, setCreateCaption] = useState("");
  const [createImagePreviewUrl, setCreateImagePreviewUrl] = useState<string | null>(null);
  const [createImageBase64Data, setCreateImageBase64Data] = useState<string | null>(null);
  const [createImageMimeType, setCreateImageMimeType] = useState<string | null>(null);
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const createInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPost = selectedPostId ? posts.find((post) => post.id === selectedPostId) ?? null : null;

  const loadPosts = async (cursorPostId?: string) => {
    if (cursorPostId) {
      setIsLoadingMorePosts(true);
    } else {
      setIsLoadingPosts(true);
    }

    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/profile-posts-list", {
        ...(cursorPostId ? { cursor_post_id: cursorPostId } : {}),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as {
        posts: PostItem[];
        has_more: boolean;
        next_cursor_post_id: string | null;
      };
      setPosts((previousPosts) =>
        cursorPostId ? [...previousPosts, ...payload.posts] : payload.posts,
      );
      setHasMorePosts(payload.has_more);
      setNextCursorPostId(payload.next_cursor_post_id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load profile posts.");
    } finally {
      setIsLoadingPosts(false);
      setIsLoadingMorePosts(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, [userId]);

  const onSelectPostImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const preparedImage = await prepareImageForUpload(file);
      setCreateImagePreviewUrl(preparedImage.previewDataUrl);
      setCreateImageBase64Data(preparedImage.base64Data);
      setCreateImageMimeType(preparedImage.mimeType);
      setStatusMessage("");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onCreatePost = async () => {
    if (!createImageBase64Data || !createImageMimeType) {
      return;
    }

    setIsCreatingPost(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/post-create", {
        text: createCaption.trim(),
        image_base64_data: createImageBase64Data,
        image_mime_type: createImageMimeType,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { post: PostItem };
      setPosts((previousPosts) => [payload.post, ...previousPosts]);
      setCreateCaption("");
      setCreateImagePreviewUrl(null);
      setCreateImageBase64Data(null);
      setCreateImageMimeType(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create post.");
    } finally {
      setIsCreatingPost(false);
    }
  };

  if (selectedPost) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-primary-background">
        <div className="border-b border-accent-1 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedPostId(null)}
            className="rounded-full border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            Back
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection post={selectedPost} showComments />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <div className="border-b border-accent-1 px-4 py-3">
        <p className="text-base font-semibold text-foreground">{username}</p>
        <p className="text-xs text-accent-2">{email ?? "No email"}</p>
      </div>

      {createImagePreviewUrl ? (
        <div className="border-b border-accent-1 bg-secondary-background p-3">
          <img src={createImagePreviewUrl} alt="New post preview" className="w-full aspect-square overflow-hidden rounded-lg object-cover" />
          <input
            value={createCaption}
            onChange={(event) => setCreateCaption(event.target.value)}
            placeholder="Caption (optional)"
            className="mt-2 w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onCreatePost}
              disabled={isCreatingPost}
              className="rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
            >
              {isCreatingPost ? "Posting..." : "Post"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateImagePreviewUrl(null);
                setCreateImageBase64Data(null);
                setCreateImageMimeType(null);
                setCreateCaption("");
              }}
              className="rounded-lg border border-accent-1 px-3 py-2 text-xs text-accent-2 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={createInputRef}
        type="file"
        accept="image/*"
        onChange={onSelectPostImage}
        className="hidden"
      />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
        {isLoadingPosts ? <p className="px-3 py-3 text-xs text-accent-2">Loading posts...</p> : null}
        {!isLoadingPosts && posts.length === 0 ? (
          <p className="px-3 py-3 text-xs text-accent-2">No posts yet. Create your first post.</p>
        ) : null}

        <div className="grid grid-cols-3 border-t border-accent-1">
          <button
            type="button"
            onClick={() => createInputRef.current?.click()}
            className="aspect-square border-r border-b border-accent-1 bg-secondary-background p-2"
          >
            <div className="flex h-full w-full items-center justify-center rounded-md border border-accent-1">
              <Plus className="h-6 w-6 text-accent-2" />
            </div>
          </button>

          {posts.map((post, index) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setSelectedPostId(post.id)}
              className={`aspect-square bg-primary-background ${
                index % 3 !== 2 ? "border-r border-accent-1" : ""
              } border-b border-accent-1`}
            >
              {post.image_url ? (
                <img src={post.image_url} alt="Profile post" className="h-full w-full object-cover" />
              ) : null}
            </button>
          ))}
        </div>

        {hasMorePosts ? (
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => {
                if (nextCursorPostId && !isLoadingMorePosts) {
                  void loadPosts(nextCursorPostId);
                }
              }}
              disabled={!nextCursorPostId || isLoadingMorePosts}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs font-medium text-accent-2 transition hover:text-foreground disabled:opacity-50"
            >
              {isLoadingMorePosts ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>

      {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}

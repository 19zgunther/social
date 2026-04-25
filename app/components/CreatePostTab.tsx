"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Image } from "lucide-react";
import { prepareImageForUpload, uploadPreparedImageToMainBucket } from "@/app/components/utils/client_file_storage_utils";
import { PostSectionComponentRenderer } from "@/app/components/PostSection";
import CachedImage from "@/app/components/utils/CachedImage";
import {
  ApiError,
  AuthUser,
  GroupsListResponse,
  PostCommentNode,
  PostGroupSection,
  PostItem,
  ThreadItem,
} from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "./utils/useSwipeBack";

type CreatePostTabProps = {
  isActive: boolean;
  onCancel: () => void;
  onPosted: () => void;
  authUser: AuthUser;
};

type UploadedImage = {
  id: string;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function CreatePostTab({ isActive, onCancel, onPosted, authUser }: CreatePostTabProps) {
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [postTextDraft, setPostTextDraft] = useState("");
  const [isEditingPostText, setIsEditingPostText] = useState(true);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [imageGrantById, setImageGrantById] = useState<Record<string, string>>({});
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isPosting, setIsPosting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [groups, setGroups] = useState<ThreadItem[]>([]);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [rootCommentDraft, setRootCommentDraft] = useState("");
  const [isPostDateExpanded, setIsPostDateExpanded] = useState(false);

  const allPostImageIds = useMemo(() => images.map((image) => image.id), [images]);
  const activeSection: PostGroupSection | null = null;
  const rootTextCommentEntries: [string, PostCommentNode][] = [];

  const previewPost: PostItem = useMemo(
    () => ({
      id: "__create_post_draft__",
      created_at: new Date().toISOString(),
      created_by: authUser.user_id,
      image_id: allPostImageIds[0] ?? null,
      image_url: null,
      text: postTextDraft,
      data: null,
      username: authUser.username,
      email: authUser.email,
      author_profile_image_id: authUser.profile_image_id,
      author_profile_image_url: authUser.profile_image_url,
      group_sections: undefined,
      image_access_grant: allPostImageIds[0] ? imageGrantById[allPostImageIds[0]] ?? null : null,
      like_count: 0,
      is_liked_by_viewer: false,
      post_comments: {},
      post_comments_count: 0,
    }),
    [allPostImageIds, authUser, imageGrantById, postTextDraft],
  );

  useEffect(() => {
    if (!isActive) {
      return;
    }
    setIsEditingPostText(true);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const loadThreads = async () => {
      const response = await postWithAuth("/api/groups-list", {});
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as GroupsListResponse;
      setGroups(payload.threads);
    };
    void loadThreads();
  }, [isActive]);

  const selectedThreadIdSet = useMemo(() => new Set(selectedThreadIds), [selectedThreadIds]);
  const canSubmitPost = (images.length > 0 || postTextDraft.trim().length > 0)
    && selectedThreadIds.length > 0
    && selectedThreadIds.length <= 3
    && !isPosting;

  const onToggleThreadSelection = (threadId: string) => {
    setStatusMessage("");
    setSelectedThreadIds((previous) => {
      if (previous.includes(threadId)) {
        return previous.filter((id) => id !== threadId);
      }
      if (previous.length >= 3) {
        setStatusMessage("You can select up to 3 groups.");
        return previous;
      }
      return [...previous, threadId];
    });
  };

  const fetchImageAccessGrants = async (imageIds: string[]): Promise<Record<string, string>> => {
    const response = await postWithAuth("/api/image-access-grants", {
      image_ids: imageIds,
      owner_user_id: authUser.user_id,
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as { grants_by_id?: Record<string, string | null> };
    const grants: Record<string, string> = {};
    for (const [imageId, grant] of Object.entries(payload.grants_by_id ?? {})) {
      if (grant) {
        grants[imageId] = grant;
      }
    }
    return grants;
  };

  const onSelectPostImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (fileList.length === 0) {
      return;
    }

    setStatusMessage("");
    try {
      const uploadedImageIds = await Promise.all(
        fileList.map(async (file) => {
          const preparedImage = await prepareImageForUpload(file);
          const payload = await uploadPreparedImageToMainBucket(preparedImage, postWithAuth);
          return payload.image_id;
        }),
      );
      const grants = await fetchImageAccessGrants(uploadedImageIds);
      setImageGrantById((previous) => ({ ...previous, ...grants }));
      setImages((previous) => [...previous, ...uploadedImageIds.map((id) => ({ id }))]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onPost = async () => {
    const trimmedPostText = postTextDraft.trim();
    if ((images.length === 0 && trimmedPostText.length === 0) || isPosting) {
      return;
    }
    if (selectedThreadIds.length === 0) {
      setStatusMessage("Select at least one group.");
      return;
    }
    if (selectedThreadIds.length > 3) {
      setStatusMessage("You can select up to 3 groups.");
      return;
    }

    setIsPosting(true);
    setStatusMessage("");
    try {
      const uploadedImageIds = images.map((image) => image.id);
      const [primaryImageId, ...otherImageIds] = uploadedImageIds;
      const createResponse = await postWithAuth("/api/post-create", {
        ...(trimmedPostText ? { text: trimmedPostText } : {}),
        thread_ids: selectedThreadIds,
        ...(primaryImageId ? { image_id: primaryImageId } : {}),
        ...(otherImageIds.length > 0 ? { data: { other_image_ids: otherImageIds } } : {}),
      });
      if (!createResponse.ok) {
        setStatusMessage(await readErrorMessage(createResponse));
        return;
      }

      setPostTextDraft("");
      setRootCommentDraft("");
      setImages([]);
      setImageGrantById({});
      setActiveImageIndex(0);
      onPosted();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create post.");
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className={`flex h-full min-h-0 w-full flex-col bg-primary-background ${DONT_SWIPE_TABS_CLASSNAME}`}>
      <div className="flex items-center border-b border-accent-1 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="shrink-0 bg-primary-background px-2 pt-2">
          <input
            ref={createInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onSelectPostImages}
            className="hidden"
          />

          <PostSectionComponentRenderer
            className="!mb-0 rounded-lg border border-accent-1"
            hasMultipleImages={allPostImageIds.length > 1}
            post={previewPost}
            isPostDateExpanded={isPostDateExpanded}
            setIsPostDateExpanded={setIsPostDateExpanded}
            activeSection={activeSection}
            setActiveSectionId={(_sectionId) => {}}
            allPostImageIds={allPostImageIds}
            onCarouselScroll={(event) => {
              const width = event.currentTarget.clientWidth;
              if (width <= 0) {
                return;
              }
              setActiveImageIndex(Math.round(event.currentTarget.scrollLeft / width));
            }}
            loadAdditionalImages={() => {}}
            imageGrantById={imageGrantById}
            isLoadingAdditionalImages={false}
            activeImageIndex={activeImageIndex}
            canEditPostText
            postTextDraft={postTextDraft}
            setPostTextDraft={setPostTextDraft}
            isSavingPostText={false}
            postTextStatusMessage={statusMessage}
            isEditingPostText={isEditingPostText}
            setIsEditingPostText={setIsEditingPostText}
            onSavePostText={() => {
              setIsEditingPostText(false);
            }}
            rootCommentDraft={rootCommentDraft}
            setRootCommentDraft={setRootCommentDraft}
            isSubmittingComment={false}
            onToggleLike={() => {}}
            isUpdatingLike={false}
            isLikedByViewer={false}
            likeCount={0}
            rootEmojiReactions={[]}
            customEmojiByUuid={{}}
            showComments={false}
            onSubmitComment={() => {}}
            setPostTextStatusMessage={setStatusMessage}
            rootTextCommentEntries={rootTextCommentEntries}
            handlePostEmojiReply={() => {}}
            onDeleteComment={(_path) => {}}
            toggleReplies={(_pathKey) => {}}
            currentUserId={authUser.user_id}
            expandedReplyPaths={[]}
            activeReplyPath={null}
            replyDraftByPath={{}}
            isDeletingCommentPath={null}
            aboutToDeleteCommentPath={null}
            setAboutToDeleteCommentPath={(_value) => {}}
            setActiveReplyPath={(_value) => {}}
            setReplyDraftByPath={(_value) => {}}
            setIsDeletingCommentPath={(_value) => {}}
            onAddPostImage={() => createInputRef.current?.click()}
            onRemovePostImage={
              images.length > 0
                ? () => {
                  const removeIndex = Math.min(activeImageIndex, images.length - 1);
                  const imageToRemove = images[removeIndex];
                  if (!imageToRemove) {
                    return;
                  }
                  setImages((previous) => previous.filter((image) => image.id !== imageToRemove.id));
                  setImageGrantById((previous) => {
                    const next = { ...previous };
                    delete next[imageToRemove.id];
                    return next;
                  });
                  setActiveImageIndex((previous) => Math.max(0, Math.min(previous, images.length - 2)));
                }
                : undefined
            }
          />
        </div>

        <div className="shrink-0 px-3 py-3">
          <div className="overflow-hidden rounded-2xl border border-accent-1/60 bg-secondary-background/30 backdrop-blur-md">
            <div className="border-b border-accent-1/50 bg-secondary-background/40 px-3 py-2">
              <p className="text-sm font-semibold text-foreground">
                Group Selection
                <span className="text-xs text-accent-2 pl-2 ml-2">
                  ({selectedThreadIds.length} selected, 3 max)
                </span>
              </p>
              
            </div>
            {groups.length === 0 ? (
              <p className="px-3 py-3 text-xs text-accent-2">No groups available.</p>
            ) : (
              <div className="divide-y divide-accent-1/30">
                {groups.map((thread) => {
                  const isSelected = selectedThreadIdSet.has(thread.id);
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => {
                        onToggleThreadSelection(thread.id);
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
                        isSelected ? "bg-secondary-background/60" : "bg-primary-background/30 hover:bg-secondary-background/40"
                      }`}
                    >
                      {thread.image_id && (thread.image_url || thread.image_access_grant) ? (
                        <CachedImage
                          signedUrl={thread.image_url ?? null}
                          imageAccessGrant={thread.image_access_grant ?? null}
                          imageThreadId={thread.id}
                          imageId={thread.image_id ?? null}
                          alt={`${thread.name} image`}
                          className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-1/30">
                          <Image className="h-5 w-5 text-accent-2" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{thread.name}</p>
                        <p className="truncate text-xs text-accent-2">Members: {thread.participant_count ?? 1}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          onToggleThreadSelection(thread.id);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        aria-label={`Select ${thread.name}`}
                        className="h-4 w-4 accent-accent-3"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {statusMessage ? (
          <p className="shrink-0 border-t border-accent-1 px-3 py-2 text-xs text-accent-2">{statusMessage}</p>
        ) : null}
      </div>

      <div className="flex justify-end border-t border-accent-1 px-3 py-3">
        <button
          type="button"
          onClick={() => {
            void onPost();
          }}
          disabled={!canSubmitPost}
          className="rounded-xl bg-accent-3 px-6 py-3 text-base font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
        >
          {isPosting ? "Posting..." : "Post ->"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import CachedImage from "@/app/components/utils/CachedImage";
import UserProfileImage from "@/app/components/UserProfileImage";
import ThreadPictureEditor from "@/app/components/ThreadPictureEditor";
import BackButton from "@/app/components/utils/BackButton";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import AllThreadEvents from "@/app/components/AllThreadEvents";
import {
  ApiError,
  FriendSearchResponse,
  ThreadEventItem,
  ThreadItem,
  ThreadMember,
  ThreadMembersResponse,
} from "@/app/types/interfaces";

type ThreadSettingsProps = {
  thread: ThreadItem;
  currentUserId: string;
  isActive?: boolean;
  onBack: () => void;
  onThreadImageUpdated: (imageId: string | null, imageUrl: string | null) => void;
  onThreadRenamed: (name: string) => void;
  onThreadDeleted: () => void;
  onViewUserProfile: (userId: string) => void;
  onOpenThreadEvent: (event: ThreadEventItem) => void;
  onThreadEventCreated: (event: ThreadEventItem) => void;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export default function ThreadSettings({
  thread,
  currentUserId,
  isActive,
  onBack,
  onThreadImageUpdated,
  onThreadRenamed,
  onThreadDeleted,
  onViewUserProfile,
  onOpenThreadEvent,
  onThreadEventCreated,
}: ThreadSettingsProps) {
  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isUpdatingMembers, setIsUpdatingMembers] = useState(false);
  const [memberIdentifier, setMemberIdentifier] = useState("");
  const [memberFormError, setMemberFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isPictureEditorOpen, setIsPictureEditorOpen] = useState(false);
  const [localImageId, setLocalImageId] = useState<string | null>(thread.image_id ?? null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(thread.image_url ?? null);
  const [localName, setLocalName] = useState(thread.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmedRemoveMember, setConfirmedRemoveMember] = useState<string | null>(null);
  const [confirmDeleteThread, setConfirmDeleteThread] = useState(false);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [sendingFriendUserId, setSendingFriendUserId] = useState<string | null>(null);

  const isOwner = currentUserId === thread.owner_user_id;

  const loadMembers = useCallback(async () => {
    setIsLoadingMembers(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/thread-members", { thread_id: thread.id });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        setMembers([]);
        return;
      }

      const payload = (await response.json()) as ThreadMembersResponse;
      setMembers(payload.members);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load members.");
      setMembers([]);
    } finally {
      setIsLoadingMembers(false);
    }
  }, [thread.id]);


  useEffect(() => {
    setLocalImageId(thread.image_id ?? null);
  }, [thread.image_id]);

  useEffect(() => {
    setLocalImageUrl(thread.image_url ?? null);
  }, [thread.image_url]);

  useEffect(() => {
    setLocalName(thread.name);
  }, [thread.name]);

  useEffect(() => {
    setConfirmDeleteThread(false);
    setConfirmedRemoveMember(null);
  }, [thread.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const searchThreadMemberOptions = async (query: string): Promise<UserSearchOption[]> => {
    const response = await postWithAuth("/api/friend-search", { query });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as FriendSearchResponse;
    return payload.users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
    }));
  };

  const onAddMember = async () => {
    if (!memberIdentifier.trim()) {
      return;
    }

    setIsUpdatingMembers(true);
    setMemberFormError("");
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-member-add", {
        thread_id: thread.id,
        identifier: memberIdentifier,
      });
      if (!response.ok) {
        setMemberFormError(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { member: ThreadMember };
      setMembers((previousMembers) => {
        const exists = previousMembers.some((member) => member.user_id === payload.member.user_id);
        if (exists) {
          return previousMembers;
        }
        return [...previousMembers, payload.member];
      });
      setMemberIdentifier("");
      setMemberFormError("");
    } catch (error) {
      setMemberFormError(error instanceof Error ? error.message : "Failed to add member.");
    } finally {
      setIsUpdatingMembers(false);
    }
  };

  const onSendFriendRequest = async (userId: string) => {
    setSendingFriendUserId(userId);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/friend-request-create", {
        other_user_id: userId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        if (response.status === 409) {
          await loadMembers();
        }
        return;
      }
      setMembers((previousMembers) =>
        previousMembers.map((member) =>
          member.user_id === userId ? { ...member, friendship_status: "pending_sent" } : member,
        ),
      );
      setStatusMessage("Friend request sent.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send friend request.");
    } finally {
      setSendingFriendUserId(null);
    }
  };

  const onRemoveMember = async (userId: string) => {
    if (confirmedRemoveMember !== userId) {
      setConfirmedRemoveMember(userId);
      return;
    }
    setIsUpdatingMembers(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-member-remove", {
        thread_id: thread.id,
        user_id: userId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      setMembers((previousMembers) =>
        previousMembers.filter((member) => member.user_id !== userId),
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to remove member.");
    } finally {
      setIsUpdatingMembers(false);
      setConfirmedRemoveMember(null);
    }
  };

  const onDeleteThread = async () => {
    if (!isOwner || isDeletingThread) {
      return;
    }

    if (!confirmDeleteThread) {
      setConfirmDeleteThread(true);
      return;
    }

    setIsDeletingThread(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-delete", { thread_id: thread.id });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        setConfirmDeleteThread(false);
        return;
      }

      onThreadDeleted();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to delete group.");
      setConfirmDeleteThread(false);
    } finally {
      setIsDeletingThread(false);
    }
  };

  const onRenameGroup = async () => {
    const nextName = localName.trim();
    if (!nextName || nextName === thread.name || isRenaming) {
      return;
    }

    setIsRenaming(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-rename", {
        thread_id: thread.id,
        name: nextName,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      setStatusMessage("Group name updated.");
      onThreadRenamed(nextName);
      setIsEditingName(false);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to rename group.");
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background"
    >
      <ThreadPictureEditor
        threadId={thread.id}
        isOpen={isPictureEditorOpen}
        onClose={() => setIsPictureEditorOpen(false)}
        onSaved={(nextImageId, nextImageUrl) => {
          setLocalImageId(nextImageId);
          setLocalImageUrl(nextImageUrl);
          onThreadImageUpdated(nextImageId, nextImageUrl);
          setStatusMessage(nextImageUrl ? "Group photo updated." : "Group photo removed.");
        }}
      />

      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <BackButton onBack={onBack} backLabel="" textOnly />
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold text-foreground">Group Settings</p>
        </div>
        <div className="w-[72px]" />
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 touch-pan-y">
        <section className="rounded-xl border border-accent-1 bg-secondary-background p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setIsPictureEditorOpen(true);
              }}
              className="overflow-hidden rounded-full border border-accent-1 bg-primary-background"
              aria-label="Edit group photo"
            >
              {localImageUrl ? (
                <CachedImage
                  signedUrl={localImageUrl}
                  imageId={localImageId}
                  alt="Group photo"
                  className="h-16 w-16 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center text-xs text-accent-2">
                  Add group photo
                </div>
              )}
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              {isEditingName ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onRenameGroup();
                  }}
                  className="relative block w-full"
                >
                  <input
                    type="text"
                    value={localName}
                    onChange={(event) => setLocalName(event.target.value)}
                    className="min-w-0 w-full rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
                    placeholder="Group name"
                    autoFocus
                  />

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLocalName(thread.name);
                        setIsEditingName(false);
                      }}
                      className="flex-1 rounded-xl border border-accent-1 px-3 py-1.5 text-xs font-semibold text-accent-2 transition hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={
                        isRenaming ||
                        !localName.trim() ||
                        localName.trim() === thread.name
                      }
                      className="flex-1 rounded-xl bg-accent-3 px-3 py-1.5 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
                    >
                      {isRenaming ? "Saving..." : "Save"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {thread.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalName(thread.name);
                      setIsEditingName(true);
                    }}
                    className="shrink-0 rounded-xl border border-accent-1 px-3 py-1.5 text-xs font-semibold text-accent-2 transition hover:text-foreground"
                  >
                    Edit
                  </button>
                </div>
              )}

              <p className="truncate text-xs text-accent-2">
                Owner: {thread.owner_username}
              </p>
            </div>
          </div>
        </section>

        <AllThreadEvents
          threadId={thread.id}
          currentUserId={currentUserId}
          isActive={isActive}
          onOpenEvent={onOpenThreadEvent}
          onThreadEventCreated={onThreadEventCreated}
          onStatusMessage={(message) => {
            setStatusMessage(message);
          }}
        />

        <section className="rounded-xl border border-accent-1 bg-secondary-background p-3">
          <div className="space-y-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onAddMember();
              }}
              className="flex items-center gap-2"
            >
              <div className="flex-1">
                <UserSearch
                  value={memberIdentifier}
                  onValueChange={(value) => {
                    setMemberIdentifier(value);
                    if (memberFormError) {
                      setMemberFormError("");
                    }
                  }}
                  onSelect={(option) => {
                    setMemberIdentifier(option.username);
                    if (memberFormError) {
                      setMemberFormError("");
                    }
                  }}
                  searchUsers={searchThreadMemberOptions}
                  placeholder="Username or email"
                  inputClassName="w-full rounded-xl border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
                />
                {memberFormError ? (
                  <p className="mt-1 text-xs text-accent-2">{memberFormError}</p>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={isUpdatingMembers}
                className="rounded-xl bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
              >
                Add
              </button>
            </form>

            <div className="space-y-2">
              {isLoadingMembers ? <p className="text-xs text-accent-2">Loading members...</p> : null}

              {!isLoadingMembers && members.length === 0 ? (
                <p className="text-xs text-accent-2">No members found.</p>
              ) : null}

              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-accent-1 bg-secondary-background py-2 pl-3 pr-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onViewUserProfile(member.user_id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:bg-primary-background/60 active:bg-primary-background/80"
                  >
                    <UserProfileImage
                      userId={member.user_id}
                      sizePx={40}
                      alt={`${member.username} profile`}
                      signedUrl={member.profile_image_url}
                      imageId={member.profile_image_id}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {member.username} {member.is_owner ? "(owner)" : ""}
                      </p>
                      <p className="text-xs text-accent-2">{member.email ?? "No email"}</p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {member.friendship_status !== "self" &&
                    member.friendship_status !== "friends" ? (
                      member.friendship_status === "none" ||
                      member.friendship_status === "rejected" ? (
                        <button
                          type="button"
                          onClick={() => {
                            void onSendFriendRequest(member.user_id);
                          }}
                          disabled={
                            sendingFriendUserId === member.user_id || isUpdatingMembers
                          }
                          className="rounded-lg border border-accent-1 px-2 py-1 text-[11px] font-semibold text-accent-2 transition hover:text-foreground disabled:opacity-50"
                        >
                          {sendingFriendUserId === member.user_id ? "Sending…" : "Add Friend"}
                        </button>
                      ) : member.friendship_status === "pending_sent" ? (
                        <span className="max-w-[5.5rem] text-center text-[11px] text-accent-2">
                          Request sent
                        </span>
                      ) : member.friendship_status === "pending_received" ? (
                        <span className="max-w-[6rem] text-center text-[11px] text-accent-2">
                          Respond in Profile
                        </span>
                      ) : null
                    ) : null}

                    {!member.is_owner ? (
                      <button
                        type="button"
                        onClick={() => {
                          void onRemoveMember(member.user_id);
                        }}
                        disabled={isUpdatingMembers}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-accent-2 transition hover:bg-primary-background/60 hover:text-foreground disabled:opacity-60"
                        aria-label={
                          confirmedRemoveMember === member.user_id
                            ? "Tap again to confirm remove from group"
                            : `Remove ${member.username} from group`
                        }
                      >
                        <Trash2
                          className={`h-4 w-4 ${
                            confirmedRemoveMember === member.user_id
                              ? "text-red-400"
                              : "opacity-50"
                          }`}
                          aria-hidden
                        />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {isOwner ? (
          <section className="rounded-xl border border-accent-1 border-red-500/40 bg-secondary-background p-3 mt-[10rem]">
            <p className="text-xs font-semibold text-foreground">Admin</p>
            <p className="mt-1 text-xs text-accent-2">
              Permanently delete this group and all of its messages. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => {
                void onDeleteThread();
              }}
              disabled={isDeletingThread}
              className="mt-3 w-full rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60"
              style={{
                borderColor: confirmDeleteThread ? "rgb(239 68 68)" : undefined,
                color: confirmDeleteThread ? "rgb(239 68 68)" : undefined,
              }}
            >
              {isDeletingThread
                ? "Deleting…"
                : confirmDeleteThread
                  ? "Tap again to confirm — cannot be undone"
                  : "Delete group"}
            </button>
            {confirmDeleteThread && !isDeletingThread ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteThread(false);
                }}
                className="mt-2 w-full rounded-xl border border-accent-1 px-3 py-2 text-xs font-semibold text-accent-2 transition hover:text-foreground"
              >
                Cancel
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      {statusMessage ? (
        <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p>
      ) : null}
    </div>
  );
}


"use client";

import { useEffect, useState } from "react";
import CachedImage from "@/app/components/utils/CachedImage";
import ThreadPictureEditor from "@/app/components/ThreadPictureEditor";
import BackButton from "@/app/components/utils/BackButton";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import {
  ApiError,
  FriendSearchResponse,
  ThreadItem,
  ThreadMember,
  ThreadMembersResponse,
} from "@/app/types/interfaces";

type ThreadSettingsProps = {
  thread: ThreadItem;
  currentUserId: string;
  onBack: () => void;
  onThreadImageUpdated: (imageId: string | null, imageUrl: string | null) => void;
  onThreadRenamed: (name: string) => void;
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
  onBack,
  onThreadImageUpdated,
  onThreadRenamed,
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
    const loadMembers = async () => {
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
    };

    void loadMembers();
  }, [thread.id]);

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

  const onRemoveMember = async (userId: string) => {
    if (!confirmedRemoveMember) {
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
        <BackButton onBack={onBack} backLabel="Thread" />
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
                  className="flex items-center justify-between rounded-lg border border-accent-1 bg-secondary-background px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      {member.username} {member.is_owner ? "(owner)" : ""}
                    </p>
                    <p className="text-xs text-accent-2">{member.email ?? "No email"}</p>
                  </div>
                  
                  {!member.is_owner ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onRemoveMember(member.user_id);
                      }}
                      disabled={isUpdatingMembers}
                      className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 transition hover:text-foreground disabled:opacity-60"
                      style={{ borderColor: confirmedRemoveMember === member.user_id ? "red" : undefined }}
                    >
                      {confirmedRemoveMember === member.user_id ? "Confirm Remove" : "Remove"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {statusMessage ? (
        <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p>
      ) : null}
    </div>
  );
}


"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import UserProfileImage from "@/app/components/UserProfileImage";
import {
  AcceptedFriend,
  ApiError,
  PostGroup,
  PostGroupsData,
  PostGroupsGetResponse,
  PostGroupsSetResponse,
} from "@/app/types/interfaces";
import { POST_GROUPS_MAX_GROUPS, POST_GROUPS_NAME_MAX_LENGTH } from "@/app/lib/postGroups";

type PostGroupsTabProps = {
  isActive: boolean;
  acceptedFriends: AcceptedFriend[];
  isLoadingFriends: boolean;
  onGoToFriendsTab: () => void;
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

const ALL_FILTER = "all" as const;

export default function PostGroupsTab({
  isActive,
  acceptedFriends,
  isLoadingFriends,
  onGoToFriendsTab,
}: PostGroupsTabProps) {
  const [groups, setGroups] = useState<PostGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>(ALL_FILTER);
  const [friendSearch, setFriendSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const acceptedFriendsRef = useRef(acceptedFriends);
  acceptedFriendsRef.current = acceptedFriends;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGenerationRef = useRef(0);
  const pendingPersistRef = useRef<PostGroup[] | null>(null);

  const withFriendMembersOnly = useCallback((nextGroups: PostGroup[]): PostGroup[] => {
    const friendIds = new Set(acceptedFriendsRef.current.map((friend) => friend.user_id));
    return nextGroups.map((group) => ({
      ...group,
      member_ids: group.member_ids.filter((id) => friendIds.has(id)),
    }));
  }, []);

  const selectedGroup = useMemo(
    () => (selectedFilter === ALL_FILTER ? null : groups.find((g) => g.id === selectedFilter) ?? null),
    [groups, selectedFilter],
  );

  const filteredFriends = useMemo(() => {
    const query = friendSearch.trim().toLowerCase();
    if (!query) {
      return acceptedFriends;
    }
    return acceptedFriends.filter((friend) => {
      const username = friend.username.toLowerCase();
      const email = (friend.email ?? "").toLowerCase();
      return username.includes(query) || email.includes(query);
    });
  }, [acceptedFriends, friendSearch]);

  const loadGroups = useCallback(async () => {
    setIsLoadingGroups(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/post-groups-get", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as PostGroupsGetResponse;
      setGroups(payload.groups);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load groups.");
    } finally {
      setIsLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadGroups();
  }, [isActive, loadGroups]);

  useEffect(() => {
    if (selectedFilter !== ALL_FILTER && !groups.some((g) => g.id === selectedFilter)) {
      setSelectedFilter(ALL_FILTER);
      setIsRenaming(false);
      setConfirmDelete(false);
    }
  }, [groups, selectedFilter]);

  const persistGroups = useCallback(async (nextGroups: PostGroup[]) => {
    const generation = ++saveGenerationRef.current;
    const cleanedGroups = withFriendMembersOnly(nextGroups);
    setIsSaving(true);
    setStatusMessage("");
    try {
      const body: PostGroupsData = { groups: cleanedGroups };
      const response = await postWithAuth("/api/post-groups-set", body);
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        void loadGroups();
        return;
      }
      if (generation !== saveGenerationRef.current) {
        return;
      }
      const payload = (await response.json()) as PostGroupsSetResponse;
      setGroups(payload.groups);
      groupsRef.current = payload.groups;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save groups.");
      void loadGroups();
    } finally {
      if (generation === saveGenerationRef.current) {
        setIsSaving(false);
      }
    }
  }, [loadGroups, withFriendMembersOnly]);

  const persistGroupsRef = useRef(persistGroups);
  persistGroupsRef.current = persistGroups;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingPersistRef.current;
      if (pending) {
        pendingPersistRef.current = null;
        void persistGroupsRef.current(pending);
      }
    };
  }, []);

  const schedulePersist = useCallback(
    (nextGroups: PostGroup[]) => {
      const cleanedGroups = withFriendMembersOnly(nextGroups);
      groupsRef.current = cleanedGroups;
      pendingPersistRef.current = cleanedGroups;
      setGroups(cleanedGroups);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const toSave = pendingPersistRef.current;
        pendingPersistRef.current = null;
        if (toSave) {
          void persistGroups(toSave);
        }
      }, 300);
    },
    [persistGroups, withFriendMembersOnly],
  );

  const flushPersist = useCallback(
    (nextGroups: PostGroup[]) => {
      const cleanedGroups = withFriendMembersOnly(nextGroups);
      groupsRef.current = cleanedGroups;
      pendingPersistRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setGroups(cleanedGroups);
      void persistGroups(cleanedGroups);
    },
    [persistGroups, withFriendMembersOnly],
  );

  const toggleMembership = (groupId: string, friendUserId: string) => {
    const nextGroups = groupsRef.current.map((group) => {
      if (group.id !== groupId) {
        return group;
      }
      const isMember = group.member_ids.includes(friendUserId);
      return {
        ...group,
        member_ids: isMember
          ? group.member_ids.filter((id) => id !== friendUserId)
          : [...group.member_ids, friendUserId],
      };
    });
    schedulePersist(nextGroups);
  };

  const setGroupMembers = (groupId: string, memberIds: string[]) => {
    const nextGroups = groupsRef.current.map((group) =>
      group.id === groupId ? { ...group, member_ids: memberIds } : group,
    );
    schedulePersist(nextGroups);
  };

  const onCreateGroup = () => {
    const name = newGroupName.trim();
    if (!name) {
      setStatusMessage("Enter a group name.");
      return;
    }
    if (name.length > POST_GROUPS_NAME_MAX_LENGTH) {
      setStatusMessage(`Names can be at most ${POST_GROUPS_NAME_MAX_LENGTH} characters.`);
      return;
    }
    if (groupsRef.current.length >= POST_GROUPS_MAX_GROUPS) {
      setStatusMessage(`You can have at most ${POST_GROUPS_MAX_GROUPS} groups.`);
      return;
    }
    const nameKey = name.toLowerCase();
    if (groupsRef.current.some((g) => g.name.toLowerCase() === nameKey)) {
      setStatusMessage("That group name is already used.");
      return;
    }

    const newGroup: PostGroup = {
      id: crypto.randomUUID(),
      name,
      member_ids: [],
    };
    const nextGroups = [...groupsRef.current, newGroup];
    setIsCreating(false);
    setNewGroupName("");
    setSelectedFilter(newGroup.id);
    setFriendSearch("");
    setIsRenaming(false);
    setConfirmDelete(false);
    flushPersist(nextGroups);
  };

  const onRenameGroup = () => {
    if (!selectedGroup) {
      return;
    }
    const name = renameValue.trim();
    if (!name) {
      setStatusMessage("Enter a group name.");
      return;
    }
    if (name.length > POST_GROUPS_NAME_MAX_LENGTH) {
      setStatusMessage(`Names can be at most ${POST_GROUPS_NAME_MAX_LENGTH} characters.`);
      return;
    }
    const nameKey = name.toLowerCase();
    if (
      groupsRef.current.some(
        (g) => g.id !== selectedGroup.id && g.name.toLowerCase() === nameKey,
      )
    ) {
      setStatusMessage("That group name is already used.");
      return;
    }

    const nextGroups = groupsRef.current.map((group) =>
      group.id === selectedGroup.id ? { ...group, name } : group,
    );
    setIsRenaming(false);
    flushPersist(nextGroups);
  };

  const onDeleteGroup = () => {
    if (!selectedGroup) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const nextGroups = groupsRef.current.filter((group) => group.id !== selectedGroup.id);
    setConfirmDelete(false);
    setIsRenaming(false);
    setSelectedFilter(ALL_FILTER);
    flushPersist(nextGroups);
  };

  const chipClass = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-2.5 text-xs font-semibold transition ${
      active
        ? "border-accent-3 bg-accent-3 text-primary-background"
        : "border-accent-1 bg-primary-background text-accent-2 hover:text-foreground"
    }`;

  const membershipChipClass = (isMember: boolean) =>
    `rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
      isMember
        ? "border-accent-3 bg-accent-3 text-primary-background"
        : "border-accent-1 bg-primary-background text-accent-2 hover:text-foreground"
    }`;

  if (!isActive) {
    return null;
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-accent-1 px-3 py-3 w-full">
      <p className="text-xs text-accent-2">
        Private friend lists used as post audiences. Choose a group when you create a post.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSelectedFilter(ALL_FILTER);
            setIsRenaming(false);
            setConfirmDelete(false);
            setIsCreating(false);
          }}
          className={chipClass(selectedFilter === ALL_FILTER)}
        >
          All
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => {
              setSelectedFilter(group.id);
              setIsRenaming(false);
              setConfirmDelete(false);
              setIsCreating(false);
              setRenameValue(group.name);
            }}
            className={chipClass(selectedFilter === group.id)}
          >
            {group.name} · {group.member_ids.length}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setNewGroupName("");
            setStatusMessage("");
          }}
          disabled={groups.length >= POST_GROUPS_MAX_GROUPS}
          className={`${chipClass(false)} disabled:opacity-50`}
          aria-label="Create group"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {isCreating ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCreateGroup();
              }
              if (event.key === "Escape") {
                setIsCreating(false);
              }
            }}
            maxLength={POST_GROUPS_NAME_MAX_LENGTH}
            placeholder="Group name"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          />
          <button
            type="button"
            onClick={onCreateGroup}
            className="rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            className="rounded-lg border border-accent-1 px-2 py-2 text-accent-2 hover:text-foreground"
            aria-label="Cancel create"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {selectedGroup ? (
        <div className="mt-3 border-b border-accent-1/50 bg-primary-background px-3 py-0 pb-3">
          {isRenaming ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onRenameGroup();
                  }
                  if (event.key === "Escape") {
                    setIsRenaming(false);
                    setRenameValue(selectedGroup.name);
                  }
                }}
                maxLength={POST_GROUPS_NAME_MAX_LENGTH}
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-accent-1 bg-secondary-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent-2"
              />
              <button
                type="button"
                onClick={onRenameGroup}
                className="rounded-lg bg-accent-3 px-2 py-1.5 text-xs font-semibold text-primary-background"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(false);
                  setRenameValue(selectedGroup.name);
                }}
                className="rounded-lg border border-accent-1 px-2 py-1.5 text-accent-2"
                aria-label="Cancel rename"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {selectedGroup.name}
                <span className="ml-2 text-xs font-normal text-accent-2">
                  {selectedGroup.member_ids.length} member
                  {selectedGroup.member_ids.length === 1 ? "" : "s"}
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(true);
                  setRenameValue(selectedGroup.name);
                  setConfirmDelete(false);
                }}
                className="rounded-lg border border-accent-1 p-1.5 text-accent-2 hover:text-foreground"
                aria-label="Rename group"
              >
                <Pencil className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onDeleteGroup}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                  confirmDelete
                    ? "border-red-400 bg-red-500/15 text-red-400"
                    : "border-accent-1 text-accent-2 hover:text-foreground"
                }`}
                aria-label={confirmDelete ? "Confirm delete group" : "Delete group"}
              >
                {confirmDelete ? "Delete?" : <Trash2 className="h-5 w-5" />}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3">
        <input
          type="search"
          value={friendSearch}
          onChange={(event) => setFriendSearch(event.target.value)}
          placeholder="Search friends"
          className="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 pt-2">
        {isLoadingGroups || isLoadingFriends ? (
          <p className="text-xs text-accent-2">Loading...</p>
        ) : null}

        {!isLoadingFriends && acceptedFriends.length === 0 ? (
          <div className="border-b border-accent-1/50 bg-primary-background px-3 py-0 pb-4">
            <p className="text-sm text-foreground">Add friends first</p>
            <p className="mt-1 text-xs text-accent-2">
              Groups are lists of your friends used when sharing posts.
            </p>
            <button
              type="button"
              onClick={onGoToFriendsTab}
              className="mt-3 rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background"
            >
              Go to Friends
            </button>
          </div>
        ) : null}

        {!isLoadingFriends &&
        acceptedFriends.length > 0 &&
        !isLoadingGroups &&
        groups.length === 0 &&
        !isCreating ? (
          <div className="border-b border-accent-1/50 bg-primary-background px-3 py-0 pb-4">
            <p className="text-sm text-foreground">Create a group for selective posts</p>
            <p className="mt-1 text-xs text-accent-2">
              Then pick that group as the audience when creating a post. You can still post to all
              friends without a group.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsCreating(true);
                setNewGroupName("");
              }}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background"
            >
              <Plus className="h-3.5 w-3.5" />
              New group
            </button>
          </div>
        ) : null}

        {!isLoadingFriends &&
        acceptedFriends.length > 0 &&
        groups.length > 0 &&
        filteredFriends.length === 0 ? (
          <p className="text-xs text-accent-2">No friends match that search.</p>
        ) : null}

        {selectedFilter === ALL_FILTER && groups.length > 0
          ? filteredFriends.map((friend) => (
              <div
                key={friend.id}
                className="w-full border-b border-accent-1/50 bg-primary-background px-3 py-0 pb-3"
              >
                <div className="flex items-center gap-4">
                  <UserProfileImage
                    userId={friend.user_id}
                    sizePx={50}
                    alt={`${friend.username} profile`}
                    signedUrl={friend.profile_image_url}
                    imageAccessGrant={friend.profile_image_access_grant}
                    imageStorageUserId={friend.user_id}
                    imageId={friend.profile_image_id}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{friend.username}</p>
                    {friend.email ? (
                      <p className="truncate text-xs text-accent-2">{friend.email}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-[66px]">
                  {groups.map((group) => {
                    const isMember = group.member_ids.includes(friend.user_id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => toggleMembership(group.id, friend.user_id)}
                        className={membershipChipClass(isMember)}
                      >
                        {group.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          : null}

        {selectedGroup
          ? filteredFriends.map((friend) => {
              const isMember = selectedGroup.member_ids.includes(friend.user_id);
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => toggleMembership(selectedGroup.id, friend.user_id)}
                  className="flex w-full items-center gap-4 border-b border-accent-1/50 bg-primary-background px-3 py-0 pb-3 text-left transition hover:bg-secondary-background"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      isMember
                        ? "border-accent-3 bg-accent-3 text-primary-background"
                        : "border-accent-1 bg-primary-background text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <UserProfileImage
                    userId={friend.user_id}
                    sizePx={50}
                    alt={`${friend.username} profile`}
                    signedUrl={friend.profile_image_url}
                    imageAccessGrant={friend.profile_image_access_grant}
                    imageStorageUserId={friend.user_id}
                    imageId={friend.profile_image_id}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{friend.username}</p>
                    {friend.email ? (
                      <p className="truncate text-xs text-accent-2">{friend.email}</p>
                    ) : null}
                  </div>
                </button>
              );
            })
          : null}
      </div>

      {isSaving ? <p className="mt-2 text-xs text-accent-2">Saving...</p> : null}
      {statusMessage ? <p className="mt-2 text-xs text-accent-2">{statusMessage}</p> : null}
    </section>
  );
}

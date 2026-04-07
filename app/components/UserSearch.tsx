"use client";

import { useEffect, useRef, useState } from "react";
import UserProfileImage from "@/app/components/UserProfileImage";

export type UserSearchOption = {
  id: string;
  username: string;
  email: string | null;
  hint?: string;
  friendshipStatus?: "self" | "friends" | "none" | "pending_sent" | "pending_received" | "rejected";
  profile_image_id?: string | null;
  profile_image_url?: string | null;
  profile_image_access_grant?: string | null;
};

type UserSearchProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (option: UserSearchOption) => void;
  searchUsers: (query: string) => Promise<UserSearchOption[]>;
  placeholder?: string;
  disabled?: boolean;
  inputClassName?: string;
  dropdownClassName?: string;
  noResultsText?: string;
  getOptionActionLabel?: (option: UserSearchOption) => string | null;
  isOptionActionDisabled?: (option: UserSearchOption) => boolean;
  onOptionAction?: (option: UserSearchOption) => Promise<UserSearchOption | void> | UserSearchOption | void;
};

export default function UserSearch({
  value,
  onValueChange,
  onSelect,
  searchUsers,
  placeholder = "Search users",
  disabled = false,
  inputClassName,
  dropdownClassName,
  noResultsText = "No matching users.",
  getOptionActionLabel,
  isOptionActionDisabled,
  onOptionAction,
}: UserSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<UserSearchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeActionUserId, setActiveActionUserId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (disabled || !isOpen) {
      return;
    }

    const query = value.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const runSearch = () => {
      setIsLoading(true);
      void searchUsers(query)
        .then((nextResults) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setResults(nextResults);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setResults([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setIsLoading(false);
          }
        });
    };

    if (!query) {
      runSearch();
      return;
    }

    const timeoutId = window.setTimeout(runSearch, 180);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [disabled, isOpen, searchUsers, value]);

  const shouldShowDropdown = isOpen;

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          blurTimeoutRef.current = window.setTimeout(() => {
            setIsOpen(false);
          }, 120);
        }}
        disabled={disabled}
        placeholder={placeholder}
        className={
          inputClassName ??
          "w-full rounded-xl border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
        }
      />

      {shouldShowDropdown ? (
        <div className={`absolute z-30 mt-1 w-full overflow-y-auto rounded-lg border border-accent-1 bg-primary-background shadow-lg shadow-black/25 ${dropdownClassName ?? "max-h-[40vh]"}`}>
          {isLoading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-accent-2">Loading users…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-accent-2">{noResultsText}</p>
          ) : (
            <ul>
              {results.map((option) => (
                <li key={option.id}>
                  <div className="w-full border-b border-accent-1/60 px-3 py-2 last:border-b-0 hover:bg-secondary-background">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onSelect(option);
                          setIsOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-3">
                          <UserProfileImage
                            userId={option.id}
                            sizePx={40}
                            alt={`${option.username} profile`}
                            signedUrl={option.profile_image_url}
                            imageAccessGrant={option.profile_image_access_grant}
                            imageStorageUserId={option.id}
                            imageId={option.profile_image_id ?? null}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{option.username}</p>
                            {option.email && (
                              <p className="truncate text-xs text-accent-2">{option.email}</p>
                            )}
                            {option.hint ? <p className="text-xs text-accent-2">{option.hint}</p> : null}
                          </div>
                        </div>
                      </button>
                      {getOptionActionLabel && onOptionAction ? (() => {
                        const actionLabel = getOptionActionLabel(option);
                        if (!actionLabel) {
                          return null;
                        }
                        const isActionDisabled = Boolean(isOptionActionDisabled?.(option)) || activeActionUserId === option.id;
                        return (
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              if (isActionDisabled) {
                                return;
                              }
                              setActiveActionUserId(option.id);
                              Promise.resolve(onOptionAction(option))
                                .then((updatedOption) => {
                                  if (!updatedOption) {
                                    return;
                                  }
                                  setResults((previous) =>
                                    previous.map((existing) => (existing.id === option.id ? updatedOption : existing)),
                                  );
                                })
                                .finally(() => {
                                  setActiveActionUserId(null);
                                });
                            }}
                            disabled={isActionDisabled}
                            className="shrink-0 rounded-lg border border-accent-1 px-2 py-1 text-xs font-semibold text-accent-2 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {activeActionUserId === option.id ? "..." : actionLabel}
                          </button>
                        );
                      })() : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

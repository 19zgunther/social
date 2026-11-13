"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Loader from "@/app/components/Loader";
import UserProfileImage from "@/app/components/UserProfileImage";
import { TextField, cn } from "@/app/ui-components";

export type UserSearchOption = {
  id: string;
  username: string;
  email: string | null;
  hint?: string;
  friendshipStatus?: "self" | "friends" | "none" | "pending_sent" | "pending_received" | "rejected";
};

type UserSearchProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (option: UserSearchOption) => void;
  searchUsers: (query: string) => Promise<UserSearchOption[]>;
  placeholder?: string;
  disabled?: boolean;
  /** `dropdown` overlays results under the input. `panel` fills remaining height below a sticky input. */
  variant?: "dropdown" | "panel";
  inputClassName?: string;
  dropdownClassName?: string;
  noResultsText?: string;
  autoFocus?: boolean;
  trailingAction?: ReactNode;
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
  variant = "dropdown",
  inputClassName,
  dropdownClassName,
  noResultsText = "No matching users.",
  autoFocus = false,
  trailingAction,
  getOptionActionLabel,
  isOptionActionDisabled,
  onOptionAction,
}: UserSearchProps) {
  const isPanel = variant === "panel";
  const [isOpen, setIsOpen] = useState(isPanel);
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
    if (isPanel) {
      setIsOpen(true);
    }
  }, [isPanel]);

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

  const shouldShowResults = isOpen;

  const resultsBody = !shouldShowResults ? null : isLoading && results.length === 0 ? (
    <div className="flex justify-center px-3 py-3">
      <Loader scale={0.55} animateHeight={false} />
    </div>
  ) : results.length === 0 ? (
    <p className="px-3 py-2 text-xs text-muted">{noResultsText}</p>
  ) : (
    <ul>
      {results.map((option) => (
        <li key={option.id}>
          <div className="w-full border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-surface/70">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(option);
                  if (!isPanel) {
                    setIsOpen(false);
                  }
                }}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-3">
                  <UserProfileImage
                    userId={option.id}
                    sizePx={40}
                    alt={`${option.username} profile`}
                    username={option.username}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{option.username}</p>
                    {option.email && (
                      <p className="truncate text-xs text-muted">{option.email}</p>
                    )}
                    {option.hint ? <p className="text-xs text-muted">{option.hint}</p> : null}
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
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
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
  );

  const input = (
    <TextField
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onFocus={() => setIsOpen(true)}
      onBlur={
        isPanel
          ? undefined
          : () => {
              blurTimeoutRef.current = window.setTimeout(() => {
                setIsOpen(false);
              }, 120);
            }
      }
      disabled={disabled}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={inputClassName}
    />
  );

  if (isPanel) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1">{input}</div>
          {trailingAction}
        </div>
        <div className={cn("mt-3 min-h-0 flex-1 overflow-y-auto", dropdownClassName)}>
          {resultsBody}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {input}
      {shouldShowResults ? (
        <div
          className={cn(
            "absolute z-30 mt-1 w-full overflow-y-auto rounded-lg border border-border bg-bg shadow-lg shadow-black/25",
            dropdownClassName ?? "max-h-[40vh]",
          )}
        >
          {resultsBody}
        </div>
      ) : null}
    </div>
  );
}

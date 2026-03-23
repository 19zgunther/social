"use client";

import { useEffect, useRef, useState } from "react";
import UserProfileImage from "@/app/components/UserProfileImage";

export type UserSearchOption = {
  id: string;
  username: string;
  email: string | null;
  hint?: string;
  profile_image_id?: string | null;
  profile_image_url?: string | null;
};

type UserSearchProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (option: UserSearchOption) => void;
  searchUsers: (query: string) => Promise<UserSearchOption[]>;
  placeholder?: string;
  disabled?: boolean;
  inputClassName?: string;
  noResultsText?: string;
};

export default function UserSearch({
  value,
  onValueChange,
  onSelect,
  searchUsers,
  placeholder = "Search users",
  disabled = false,
  inputClassName,
  noResultsText = "No matching users.",
}: UserSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<UserSearchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-accent-1 bg-primary-background shadow-lg shadow-black/25">
          {isLoading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-accent-2">Loading users…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-accent-2">{noResultsText}</p>
          ) : (
            <ul>
              {results.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelect(option);
                      setIsOpen(false);
                    }}
                    className="w-full border-b border-accent-1/60 px-3 py-2 text-left last:border-b-0 hover:bg-secondary-background flex items-center gap-3"
                  >
                    <UserProfileImage
                      userId={option.id}
                      sizePx={40}
                      alt={`${option.username} profile`}
                      signedUrl={option.profile_image_url}
                      imageId={option.profile_image_id ?? null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{option.username}</p>
                      {option.email && (
                        <p className="truncate text-xs text-accent-2">{option.email}</p>
                      )}
                      {option.hint ? <p className="text-xs text-accent-2">{option.hint}</p> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

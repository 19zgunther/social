"use client";

import { useEffect, useRef, useState } from "react";

export type UserSearchOption = {
  id: string;
  username: string;
  email: string | null;
  hint?: string;
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
    const query = value.trim();
    if (!query || disabled) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const timeoutId = window.setTimeout(() => {
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
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [disabled, searchUsers, value]);

  const shouldShowDropdown = isOpen && value.trim().length > 0;

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
          {results.length === 0 ? (
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
                    className="w-full border-b border-accent-1/60 px-3 py-2 text-left last:border-b-0 hover:bg-secondary-background"
                  >
                    <p className="truncate text-sm text-foreground">{option.username}</p>
                    <p className="truncate text-xs text-accent-2">{option.email ?? "No email"}</p>
                    {option.hint ? <p className="text-[11px] text-accent-2">{option.hint}</p> : null}
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

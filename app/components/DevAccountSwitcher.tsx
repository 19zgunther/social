"use client";

import { useEffect, useState } from "react";
import {
  AddIcon,
  CheckIcon,
  ChevronRightIcon,
  UserPlaceholderIcon,
} from "@/app/components/Icons";
import { DEFAULT_THEME, persistAndApplyTheme } from "@/app/lib/theme";
import { MAX_DEV_ACCOUNTS_PER_PRIMARY } from "@/app/lib/usernames";
import { Button, TextField } from "@/app/ui-components";
import type {
  AuthUser,
  DevAccountListItem,
  DevAccountsListResponse,
  LoginResponse,
} from "@/app/types/interfaces";

type DevAccountSwitcherProps = {
  authUser: AuthUser;
  setStatusMessage: (message: string) => void;
};

/** Whether Settings should show the Dev Account Switcher menu item. */
export function shouldShowDevAccountSwitcher(authUser: AuthUser): boolean {
  // Server sets this from the allowlist; never check developer IDs on the client.
  return Boolean(authUser.can_use_dev_account_switcher);
}

export default function DevAccountSwitcher({
  authUser,
  setStatusMessage,
}: DevAccountSwitcherProps) {
  const [devAccounts, setDevAccounts] = useState<DevAccountListItem[]>([]);
  const [isLoadingDevAccounts, setIsLoadingDevAccounts] = useState(false);
  const [isCreatingDevAccount, setIsCreatingDevAccount] = useState(false);
  const [isSwitchingDevAccount, setIsSwitchingDevAccount] = useState(false);
  const [resettingDevAccountId, setResettingDevAccountId] = useState<string | null>(null);
  const [newDevAccountUsername, setNewDevAccountUsername] = useState("");

  // Only the primary can create children (backend enforces the same).
  const canCreateDevAccount =
    Boolean(authUser.can_use_dev_account_switcher) && !authUser.primary_user_id;
  const childAccountCount = devAccounts.filter((account) => !account.is_primary).length;
  const atDevAccountLimit = childAccountCount >= MAX_DEV_ACCOUNTS_PER_PRIMARY;

  // Cookie is already set by the API; full reload clears user-scoped React state.
  const applySwitchedAccount = (payload: LoginResponse) => {
    persistAndApplyTheme(payload.user.theme_info ?? DEFAULT_THEME);
    window.location.assign("/");
  };

  const loadDevAccounts = async () => {
    setIsLoadingDevAccounts(true);
    try {
      const response = await fetch("/api/dev-accounts-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatusMessage(payload?.error?.message ?? "Failed to load accounts.");
        return;
      }
      const payload = (await response.json()) as DevAccountsListResponse;
      setDevAccounts(payload.accounts);
    } catch {
      setStatusMessage("Failed to load accounts.");
    } finally {
      setIsLoadingDevAccounts(false);
    }
  };

  useEffect(() => {
    void loadDevAccounts();
  }, []);

  const usernamePrefix = `${authUser.username}_`;

  // Create + auto-switch: API sets cookie for the new child, then we reload.
  const onCreateDevAccount = async () => {
    if (isCreatingDevAccount || !canCreateDevAccount || atDevAccountLimit) {
      return;
    }
    // Send suffix only; server composes `{primary}_{suffix}`.
    const username = newDevAccountUsername.trim();
    if (!username) {
      setStatusMessage("Enter a name for the dev account.");
      return;
    }
    setIsCreatingDevAccount(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/dev-account-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatusMessage(payload?.error?.message ?? "Failed to create account.");
        return;
      }
      const payload = (await response.json()) as LoginResponse;
      applySwitchedAccount(payload);
    } catch {
      setStatusMessage("Failed to create account.");
    } finally {
      setIsCreatingDevAccount(false);
    }
  };

  // Mint a new auth_token for the target family member, then hard-reload.
  const onSwitchDevAccount = async (targetUserId: string) => {
    if (isSwitchingDevAccount || targetUserId === authUser.user_id) {
      return;
    }
    if (!window.confirm("Switch to this account?")) {
      return;
    }
    setIsSwitchingDevAccount(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/dev-account-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatusMessage(payload?.error?.message ?? "Failed to switch account.");
        return;
      }
      const payload = (await response.json()) as LoginResponse;
      applySwitchedAccount(payload);
    } catch {
      setStatusMessage("Failed to switch account.");
    } finally {
      setIsSwitchingDevAccount(false);
    }
  };

  // Clears friends / leaves chats & events; does not delete the user row.
  const onResetDevAccount = async (targetUserId: string, username: string) => {
    if (resettingDevAccountId) {
      return;
    }
    if (
      !window.confirm(
        `Reset @${username}? This removes their friends and leaves chats/events they joined. It does not delete chats or events they own, or their posts.`,
      )
    ) {
      return;
    }
    setResettingDevAccountId(targetUserId);
    setStatusMessage("");
    try {
      const response = await fetch("/api/dev-account-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatusMessage(payload?.error?.message ?? "Failed to reset account.");
        return;
      }
      setStatusMessage(`Reset @${username}.`);
      if (targetUserId === authUser.user_id) {
        window.location.assign("/");
        return;
      }
      void loadDevAccounts();
    } catch {
      setStatusMessage("Failed to reset account.");
    } finally {
      setResettingDevAccountId(null);
    }
  };

  return (
    <section className="space-y-3">
      {canCreateDevAccount ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-3">
          <p className="text-sm font-medium text-foreground">Create a dev account</p>
          {atDevAccountLimit ? (
            <p className="text-sm text-muted">
              You already have {MAX_DEV_ACCOUNTS_PER_PRIMARY} dev accounts (the maximum).
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                Username will be{" "}
                <span className="font-mono text-foreground">
                  {usernamePrefix}
                  {newDevAccountUsername.trim() || "…"}
                </span>
                . Password is random and never shown — use the switcher to enter.
              </p>
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-sm text-muted">{usernamePrefix}</span>
                <TextField
                  type="text"
                  value={newDevAccountUsername}
                  onChange={(event) => setNewDevAccountUsername(event.target.value)}
                  placeholder="devname"
                  className="min-w-0 flex-1"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="inline-flex shrink-0 items-center gap-1"
                  onClick={() => {
                    void onCreateDevAccount();
                  }}
                  disabled={isCreatingDevAccount || isSwitchingDevAccount}
                >
                  <AddIcon className="h-4 w-4" />
                  {isCreatingDevAccount ? "…" : "Create"}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Switch between your primary account and linked child accounts. Create new ones from the
          primary developer account.
        </p>
      )}

      {isLoadingDevAccounts ? <p className="text-sm text-muted">Loading accounts…</p> : null}
      {!isLoadingDevAccounts && devAccounts.length === 0 ? (
        <p className="text-sm text-muted">No accounts found.</p>
      ) : null}

      {devAccounts.map((account) => (
        <div
          key={account.user_id}
          className={
            account.is_current
              ? "rounded-lg border-2 border-accent bg-accent/10 px-4 py-3"
              : "rounded-lg border border-border bg-surface px-4 py-3"
          }
        >
          <button
            type="button"
            onClick={() => {
              void onSwitchDevAccount(account.user_id);
            }}
            disabled={account.is_current || isSwitchingDevAccount || isCreatingDevAccount}
            className="flex w-full items-center justify-between text-left text-sm text-foreground disabled:cursor-default"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={
                  account.is_current
                    ? "relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-accent bg-bg"
                    : "relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-bg"
                }
              >
                {account.profile_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={account.profile_image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted">
                    <UserPlaceholderIcon className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">@{account.username}</span>
                  {account.is_current ? (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-accent">
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted">
                  {account.is_primary ? "Primary" : "Dev account"}
                  {account.is_current ? " · signed in as this account" : " · tap to switch"}
                </span>
              </span>
            </span>
            {account.is_current ? (
              <CheckIcon className="h-5 w-5 shrink-0 text-accent" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
            )}
          </button>
          {!account.is_primary ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="mt-3"
              disabled={
                resettingDevAccountId !== null ||
                isSwitchingDevAccount ||
                isCreatingDevAccount
              }
              onClick={() => {
                void onResetDevAccount(account.user_id, account.username);
              }}
            >
              {resettingDevAccountId === account.user_id ? "Resetting…" : "Reset Dev Account"}
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

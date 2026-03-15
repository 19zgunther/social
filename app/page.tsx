"use client";

import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { House, UserRound, Users } from "lucide-react";
import Feed from "@/app/components/Feed";
import Groups from "@/app/components/Groups";
import Profile from "@/app/components/Profile";

type AuthUser = {
  user_id: string;
  username: string;
  email: string | null;
  profile_image_url: string | null;
  minted_at: number;
};

type Mode = "login" | "signup";
type AppTab = "feed" | "groups" | "profile";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

const AUTH_TOKEN_KEY = "auth_token";
const MOBILE_FRAME_STYLE: CSSProperties = {
  width: "100vw",
  maxWidth: "32rem",
};
const APP_VIEWPORT_STYLE: CSSProperties = {
  height: "100dvh",
  minHeight: "100svh",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("login");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("feed");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [groupsUnreadCount, setGroupsUnreadCount] = useState(0);
  const [profileIncomingRequestCount, setProfileIncomingRequestCount] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const pageTitle = useMemo(() => (mode === "login" ? "Log in" : "Create account"), [mode]);

  useEffect(() => {
    const runAuthCheck = async () => {
      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setIsCheckingSession(false);
        return;
      }

      const response = await fetch("/api/auth-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        window.localStorage.removeItem(AUTH_TOKEN_KEY);
        setIsCheckingSession(false);
        return;
      }

      const sessionUser = (await response.json()) as AuthUser;
      setAuthUser(sessionUser);
      setIsCheckingSession(false);
    };

    void runAuthCheck();
  }, []);

  const readApiError = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  const onLogout = () => {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    document.cookie = "auth_token=; Max-Age=0; path=/";
    setAuthUser(null);
    setActiveTab("feed");
    setGroupsUnreadCount(0);
    setProfileIncomingRequestCount(0);
    setStatusMessage("Logged out.");
  };

  const refreshGroupsUnreadCount = useCallback(async () => {
    try {
      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        return;
      }

      const response = await fetch("/api/groups-unread-count", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        unread_threads_count?: number;
      };
      setGroupsUnreadCount(payload.unread_threads_count ?? 0);
    } catch {
      // Silent failure keeps last known unread count.
    }
  }, []);

  useEffect(() => {
    if (!authUser) {
      setGroupsUnreadCount(0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      if (cancelled) {
        return;
      }
      await refreshGroupsUnreadCount();
    };

    void run();
    const intervalId = window.setInterval(() => {
      void run();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser, refreshGroupsUnreadCount]);

  useEffect(() => {
    if (!authUser) {
      setProfileIncomingRequestCount(0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
        if (!token) {
          return;
        }

        const response = await fetch("/api/friend-requests-list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          incoming_requests?: Array<unknown>;
        };
        if (!cancelled) {
          setProfileIncomingRequestCount(payload.incoming_requests?.length ?? 0);
        }
      } catch {
        // Silent failure: nav badge can remain stale until next refresh.
      }
    };

    void run();
    const intervalId = window.setInterval(() => {
      void run();
    }, 12_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser]);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });

      if (!response.ok) {
        setStatusMessage(await readApiError(response));
        return;
      }

      const payload = (await response.json()) as { token: string; user: AuthUser };
      window.localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
      setAuthUser(payload.user);
      setStatusMessage("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      if (!response.ok) {
        setStatusMessage(await readApiError(response));
        return;
      }

      const payload = (await response.json()) as { token: string; user: AuthUser };
      window.localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
      setAuthUser(payload.user);
      setStatusMessage("");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0">
        <section
          style={MOBILE_FRAME_STYLE}
          className="flex h-full items-center justify-center border border-accent-1 bg-secondary-background px-6"
        >
          <p className="text-sm text-accent-2">Checking your session...</p>
        </section>
      </main>
    );
  }

  if (authUser) {
    return (
      <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0">
        <section
          style={MOBILE_FRAME_STYLE}
          className="flex h-full max-h-dvh flex-col overflow-hidden border border-accent-1 shadow-xl shadow-black/25"
        >
          {activeTab === "feed" ? (
            <header className="border-b border-accent-1 px-4 py-3">
              <h1 className="text-sm font-semibold text-foreground text-center w-full">Your friends posted...</h1>
            </header>
          ) : null}

          <div className="flex-1 min-h-0 overflow-hidden px-0 py-0">
            {activeTab === "feed" ? (
              <Feed />
            ) : activeTab === "groups" ? (
              <Groups
                currentUserId={authUser.user_id}
                onThreadRead={() => {
                  void refreshGroupsUnreadCount();
                }}
              />
            ) : (
              <Profile
                userId={authUser.user_id}
                username={authUser.username}
                email={authUser.email}
                profileImageUrl={authUser.profile_image_url}
                onProfileImageUpdated={(profileImageUrl) => {
                  setAuthUser((previous) =>
                    previous ? { ...previous, profile_image_url: profileImageUrl } : previous,
                  );
                }}
                onLogout={onLogout}
              />
            )}
          </div>

          <nav className="grid grid-cols-3 border-t border-accent-1 bg-primary-background">
            <button
              type="button"
              onClick={() => setActiveTab("feed")}
              className={`flex items-center justify-center gap-2 py-3 text-sm font-medium transition ${
                activeTab === "feed"
                  ? "text-accent-3"
                  : "text-accent-2 hover:text-foreground"
              }`}
            >
              <House aria-hidden className="h-4 w-4" />
              <span>Feed</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("groups")}
              className={`flex items-center justify-center gap-2 py-3 text-sm font-medium transition ${
                activeTab === "groups"
                  ? "text-accent-3"
                  : "text-accent-2 hover:text-foreground"
              }`}
            >
              <Users aria-hidden className="h-4 w-4" />
              <span>{`Groups (${groupsUnreadCount})`}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`flex items-center justify-center gap-2 py-3 text-sm font-medium transition ${
                activeTab === "profile"
                  ? "text-accent-3"
                  : "text-accent-2 hover:text-foreground"
              }`}
            >
              <UserRound aria-hidden className="h-4 w-4" />
              <span>{`Profile (${profileIncomingRequestCount})`}</span>
            </button>
          </nav>
        </section>
      </main>
    );
  }

  return (
    <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0">
      <section
        style={MOBILE_FRAME_STYLE}
        className="flex h-full flex-col justify-center border border-accent-1 bg-secondary-background px-6 shadow-lg shadow-black/20"
      >
        <h1 className="text-2xl font-semibold text-foreground">{pageTitle}</h1>
        <p className="mt-1 text-sm text-accent-2">Single-page auth flow for mobile-first layout.</p>

        {mode === "login" ? (
          <form className="mt-6 flex flex-col gap-3" onSubmit={submitLogin}>
            <input
              className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
              placeholder="Username or email"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              required
            />
            <input
              className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 rounded-xl bg-accent-3 px-4 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
            >
              {isSubmitting ? "Logging in..." : "Log in"}
            </button>
          </form>
        ) : (
          <form className="mt-6 flex flex-col gap-3" onSubmit={submitSignup}>
            <input
              className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
              placeholder="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              required
            />
            <input
              className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
              placeholder="Email (optional)"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoCapitalize="none"
              autoComplete="email"
            />
            <input
              className="rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-sm text-foreground outline-none focus:border-accent-2"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 rounded-xl bg-accent-3 px-4 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
            >
              {isSubmitting ? "Creating account..." : "Sign up"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode((previousMode) => (previousMode === "login" ? "signup" : "login"));
            setStatusMessage("");
          }}
          className="mt-4 text-sm text-accent-2 underline underline-offset-4 hover:text-foreground"
        >
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>

        {statusMessage ? <p className="mt-4 text-sm text-accent-2">{statusMessage}</p> : null}
      </section>
    </main>
  );
}

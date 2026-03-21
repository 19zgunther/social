"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { House, UserRound, Users } from "lucide-react";
import Feed from "@/app/components/Feed";
import Groups from "@/app/components/Groups";
import { Profile, ProfileOtherUser } from "@/app/components/Profile";
import ProfileSettings from "@/app/components/ProfileSettings";
import {
  AuthCheckResponse,
  AuthUser,
  ThreadItem,
} from "@/app/types/interfaces";
import {
  MOBILE_FRAME_STYLE,
  APP_VIEWPORT_STYLE,
  parseDeepLinkFromLocation,
  AppTab,
} from "@/app/components/utils";
import { AutoNotificationPrompt } from "./components/utils/AutoNotificationPrompt";
import SignUpPage from "./components/SignupPage";
import NavRowButton from "./components/utils/NavRowButton";
import Thread from "./components/Thread";
import ThreadSettings from "./components/ThreadSettings";
import useSwipeBack from "./components/utils/useSwipeBack";


const TAB_TO_BACK: { [key in AppTab]: { forward: AppTab, back: AppTab } } = {
  thread_settings: { forward: "profile", back: "thread" },
  thread: { forward: "thread_settings", back: "groups" },
  groups: { forward: "profile", back: "feed" },
  feed: { forward: "groups", back: "profile" },
  profile: { forward: "profile_settings", back: "groups" },
  profile_settings: { forward: "feed", back: "profile" },
  other_user_profile: { forward: "feed", back: "profile" },
}


export default function Home() {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("feed");
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [pendingDeepLinkThreadId, setPendingDeepLinkThreadId] = useState<string | null>(null);
  const [groupsUnreadCount, setGroupsUnreadCount] = useState(0);
  const [profileIncomingRequestCount, setProfileIncomingRequestCount] = useState(0);
  const [showNotificationsPrompt, setShowNotificationsPrompt] = useState(false);
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null);

  const onLogout = () => {
    const token = undefined;
    if ("serviceWorker" in navigator) {
      void (async () => {
        try {
          const registration =
            (await navigator.serviceWorker.getRegistration("/sw.js")) ??
            (await navigator.serviceWorker.getRegistration());
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) {
            await fetch("/api/push-unsubscribe", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                endpoint: subscription.endpoint,
              }),
            });
            await subscription.unsubscribe();
          }
        } catch {
          // Silent cleanup failure: logout still proceeds.
        }
      })();
    }

    document.cookie = "auth_token=; Max-Age=0; path=/";
    setAuthUser(null);
    setActiveTab("feed");
    setViewingUserId(null);
    setPendingDeepLinkThreadId(null);
    setShowNotificationsPrompt(false);
    setGroupsUnreadCount(0);
    setProfileIncomingRequestCount(0);
  };

  const onViewUserProfile = useCallback((userId: string) => {
    setViewingUserId(userId);
    setActiveTab("other_user_profile");
  }, []);

  const refreshGroupsUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/groups-unread-count", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

  const onDeepLinkThreadHandled = useCallback(() => {
    setPendingDeepLinkThreadId(null);
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.delete("thread_id");
    nextParams.set("tab", "groups");
    const nextQuery = nextParams.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
    );
  }, []);

  const onProfileImageUpdated = useCallback((profileImageId: string | null, profileImageUrl: string | null) => {
    setAuthUser((previous) =>
      previous
        ? {
          ...previous,
          profile_image_id: profileImageId,
          profile_image_url: profileImageUrl,
        }
        : previous,
    );
  }, [authUser]);

  // Perform an initial auth check on mount to hydrate session user state.
  useEffect(() => {
    const runAuthCheck = async () => {
      const response = await fetch("/api/auth-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        setIsCheckingSession(false);
        return;
      }

      const sessionUser = (await response.json()) as AuthCheckResponse;
      setAuthUser(sessionUser);
      setIsCheckingSession(false);
    };

    void runAuthCheck();
  }, []);

  // Initialize tab/thread state from URL and keep it in sync with browser history.
  useEffect(() => {
    const applyDeepLinkState = () => {
      const deepLink = parseDeepLinkFromLocation();
      if (deepLink.tab) {
        setActiveTab(deepLink.tab);
      }
      if (deepLink.threadId) {
        setPendingDeepLinkThreadId(deepLink.threadId);
      }
    };

    applyDeepLinkState();
    window.addEventListener("popstate", applyDeepLinkState);
    return () => {
      window.removeEventListener("popstate", applyDeepLinkState);
    };
  }, []);

  // Poll groups unread count at an interval while user is authenticated.
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

  // Poll incoming friend request count at an interval while user is authenticated.
  useEffect(() => {
    if (!authUser) {
      setProfileIncomingRequestCount(0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/friend-requests-list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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

  const onBackRef = useRef<() => void>(() => { console.error("onBackRef not set"); });
  const onForwardRef = useRef<() => void>(() => { console.error("onForwardRef not set"); });
  const { onTouchStart, onTouchEnd, onTouchMove, swipingBackPercent, swipingForwardPercent } =
    useSwipeBack({ onBack: onBackRef.current, onForward: onForwardRef.current });


  // Early return for loading state if session is still being checked.
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

  // Early return for signup page if user is not authenticated.
  if (!authUser) { return (<SignUpPage setAuthUser={setAuthUser} />); }

  const isSwipingForward = !!swipingForwardPercent;
  const isSwipingBack = !!swipingBackPercent;

  const ACTIVE_STYLE = {
    zIndex: 1000,
    left: isSwipingBack ? (swipingBackPercent ?? 0) * 100 + "%" : undefined,
    right: isSwipingForward ? (swipingForwardPercent ?? 0) * 100 + "%" : undefined,
  }
  const BACK_SWIPE_TAB: React.CSSProperties = { zIndex: isSwipingBack ? 999 : 998 };
  const FORWARD_SWIPE_TAB: React.CSSProperties = { zIndex: isSwipingForward ? 999 : 998 };
  const DEFAULT_TAB: React.CSSProperties = { display: "none" };

  let TAB_TO_STYLE: { [key in AppTab]: React.CSSProperties } = {
    feed: DEFAULT_TAB,
    groups: DEFAULT_TAB,
    thread: DEFAULT_TAB,
    thread_settings: DEFAULT_TAB,
    profile: DEFAULT_TAB,
    profile_settings: DEFAULT_TAB,
    other_user_profile: DEFAULT_TAB,
  }

  const { forward, back } = TAB_TO_BACK[activeTab] ?? { forward: "profile", back: "feed" };
  TAB_TO_STYLE[forward] = FORWARD_SWIPE_TAB;
  TAB_TO_STYLE[back] = BACK_SWIPE_TAB;
  TAB_TO_STYLE[activeTab] = ACTIVE_STYLE;

  onBackRef.current = () => { setActiveTab(back); }
  onForwardRef.current = () => { setActiveTab(forward); }

  const feedStyle = TAB_TO_STYLE["feed"];
  const groupsStyle = TAB_TO_STYLE["groups"];
  const threadStyle = TAB_TO_STYLE["thread"];
  const threadSettingsStyle = TAB_TO_STYLE["thread_settings"];
  const profileStyle = TAB_TO_STYLE["profile"];
  const profileSettingsStyle = TAB_TO_STYLE["profile_settings"];
  const otherUserProfileStyle = TAB_TO_STYLE["other_user_profile"];

  return (
    <main style={APP_VIEWPORT_STYLE} className="flex w-screen justify-center p-0 pt-[2rem]">
      <section
        style={MOBILE_FRAME_STYLE}
        className="flex h-full max-h-dvh flex-col overflow-hidden shadow-xl shadow-black/25 relative"
      >
        <AutoNotificationPrompt authUser={authUser} showNotificationsPrompt={showNotificationsPrompt} setShowNotificationsPrompt={setShowNotificationsPrompt} />

        {/** Main Content Container */}
        <div
          className="relative flex-1 min-h-0 overflow-hidden px-0 py-0"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchMove}
        >
          <div className="absolute w-full h-full" style={groupsStyle}>
            <Groups
              currentUserId={authUser.user_id}
              deepLinkThreadId={pendingDeepLinkThreadId}
              onDeepLinkThreadHandled={onDeepLinkThreadHandled}
              onThreadRead={refreshGroupsUnreadCount}
              selectedThread={selectedThread}
              setSelectedThread={setSelectedThread}
              setActiveTab={setActiveTab}
              isActiveTab={true}
            />
          </div>

          <div className="absolute w-full h-full" style={feedStyle}>
            <Feed onViewUserProfile={onViewUserProfile} />
          </div>

          {selectedThread && <div className="absolute w-full h-full" style={threadStyle}>
            <Thread
              selectedThread={selectedThread}
              setSelectedThread={setSelectedThread}
              currentUserId={authUser.user_id}
              onBack={() => { setSelectedThread(null); }}
              setThreadSettingsOpen={() => { setActiveTab("thread_settings") }}
            />
          </div>}

          {selectedThread && <div className="absolute w-full h-full" style={threadSettingsStyle}>
            <ThreadSettings
              thread={selectedThread}
              currentUserId={authUser.user_id}
              onBack={() => setActiveTab("thread")}
              onThreadImageUpdated={(imageId, imageUrl) => {
                setSelectedThread((previous) => ({
                  ...previous as ThreadItem,
                  image_id: imageId,
                  image_url: imageUrl,
                }));
              }}
              onThreadRenamed={(name) => {
                setSelectedThread((previous: ThreadItem | null) => ({
                  ...previous as ThreadItem,
                  name,
                }));
              }}
            />
          </div>}

          <div className="absolute w-full h-full" style={profileStyle}>
            <Profile
              userId={authUser.user_id}
              username={authUser.username}
              email={authUser.email}
              profileImageId={authUser.profile_image_id}
              profileImageUrl={authUser.profile_image_url}
              onProfileImageUpdated={onProfileImageUpdated}
              onOpenSettings={() => setActiveTab("profile_settings")}
              onViewUserProfile={onViewUserProfile}
            />
          </div>

          <div className="absolute w-full h-full" style={profileSettingsStyle}>
            <ProfileSettings
              onBack={() => setActiveTab("profile")}
              onLogout={onLogout}
            />
          </div>

          {viewingUserId && <div className="absolute w-full h-full" style={otherUserProfileStyle}>
            <ProfileOtherUser
              userId={viewingUserId}
              currentUserId={authUser.user_id}
              onBack={() => setActiveTab("profile")}
            />
          </div>}

        </div>

        {/** Bottom Navigation Bar */}
        <div className="w-full h-fit flex justify-between border-t border-accent-1 bg-primary-background z-[1000]">
          <NavRowButton
            icon={<House aria-hidden className="h-4 w-4" />}
            isActive={activeTab === "feed"}
            showCircle={false}
            onClick={() => setActiveTab("feed")}
          />
          <NavRowButton
            icon={<Users aria-hidden className="h-4 w-4" />}
            isActive={activeTab === "groups"}
            showCircle={groupsUnreadCount > 0}
            onClick={() => setActiveTab("groups")}
          />
          <NavRowButton
            icon={<UserRound aria-hidden className="h-4 w-4" />}
            isActive={activeTab === "profile"}
            showCircle={profileIncomingRequestCount > 0}
            onClick={() => {
              setActiveTab("profile");
            }}
          />
        </div>
      </section>
    </main>
  );
}

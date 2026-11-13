"use client";

import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import Feed from "@/app/components/Feed";
import Messages from "@/app/components/Messages";
import {
  NavFeedIcon,
  NavEventsIcon,
  NavFeedbackIcon,
  NavProfileIcon,
  NavMessagesIcon,
} from "@/app/components/Icons";
import { Profile, ProfileOtherUser } from "@/app/components/Profile";
import ProfileSettings from "@/app/components/ProfileSettings";
import {
  AuthCheckResponse,
  AuthUser,
  ThreadEventItem,
  ThreadItem,
  UserUpcomingEventListItem,
} from "@/app/types/interfaces";
import {
  MOBILE_FRAME_STYLE,
  APP_VIEWPORT_STYLE,
  parseDeepLinkFromLocation,
  AppTab,
} from "@/app/components/utils";
import { AutoNotificationPrompt } from "./components/utils/AutoNotificationPrompt";
import SignUpPage from "./components/SignupPage";
import CheckingSessionPage from "./components/CheckingSessionPage";
import NavRowButton from "./components/utils/NavRowButton";
import Thread from "./components/Thread";
import ThreadSettings from "./components/ThreadSettings";
import ThreadEventPage from "./components/ThreadEventPage";
import UpcomingEventsTab from "./components/UpcomingEventsTab";
import { useTabNavigation } from "./components/utils/useTabNavigation";
import { useDevActiveTabPersistence } from "./components/utils/useDevActiveTabPersistence";
import AnimatedModal, { useAnimatedModal } from "./components/utils/AnimatedModal";
import CreatePostTab from "./components/CreatePostTab";
import Feedback from "./components/Feedback";
import { UserSessionSyncProvider } from "./components/UserSessionSyncContext";
import {
  DEFAULT_THEME,
  persistAndApplyTheme,
  resetThemeToDefault,
} from "@/app/lib/theme";

const TAB_TO_BACK_BASE: { [key in AppTab]: { forward: AppTab | null; back: AppTab | null } } = {
  thread_event: { forward: null, back: "thread_settings" },
  thread_settings: { forward: null, back: "thread" },
  thread: { forward: null, back: "messages" },
  messages: { forward: "events", back: "feed" },
  events: { forward: "profile", back: "messages" },
  feed: { forward: "messages", back: null },
  profile: { forward: null, back: "events" },
  feedback: { forward: "profile_settings", back: "profile" },
  profile_settings: { forward: null, back: "profile" },
  other_user_profile: { forward: null, back: "profile" },
};

/** Main top pad; stack overlays extend upward by this so Thread stays full-bleed. */
const CHROME_TOP_PAD = "2rem";

export default function Home() {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("feed");
  useDevActiveTabPersistence(activeTab, setActiveTab);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [pendingDeepLinkThreadId, setPendingDeepLinkThreadId] = useState<string | null>(null);
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);
  const [profileIncomingRequestCount, setProfileIncomingRequestCount] = useState(0);
  const [showNotificationsPrompt, setShowNotificationsPrompt] = useState(false);
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null);
  const [threadEventFocus, setThreadEventFocus] = useState<ThreadEventItem | null>(null);
  const [threadEventReturnTab, setThreadEventReturnTab] = useState<"thread_settings" | "events">(
    "thread_settings",
  );
  const [threadReturnTab, setThreadReturnTab] = useState<
    "messages" | "thread_event" | "other_user_profile"
  >("messages");
  const [eventsRefreshNonce, setEventsRefreshNonce] = useState(0); // events tab hidden; nonce kept for thread_event delete refresh
  const [messagesListRefreshNonce, setMessagesListRefreshNonce] = useState(0);
  const [profileReloadSignal, setProfileReloadSignal] = useState(0);
  const {
    isPresented: isCreatePostPresented,
    isClosing: isCreatePostClosing,
    isActive: isCreatePostActive,
    open: openCreatePost,
    close: closeCreatePost,
  } = useAnimatedModal();

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
    resetThemeToDefault();
    setAuthUser(null);
    setActiveTab("feed");
    setViewingUserId(null);
    setPendingDeepLinkThreadId(null);
    setShowNotificationsPrompt(false);
    setMessagesUnreadCount(0);
    setProfileIncomingRequestCount(0);
  };

  const refreshMessagesUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/messages-unread-count", {
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
      setMessagesUnreadCount(payload.unread_threads_count ?? 0);
    } catch {
      // Silent failure keeps last known unread count.
    }
  }, []);

  const onDeepLinkThreadHandled = useCallback(() => {
    setPendingDeepLinkThreadId(null);
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.delete("thread_id");
    nextParams.set("tab", "messages");
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

  const previousTabRef = useRef<AppTab | null>(null);
  useEffect(() => {
    const prev = previousTabRef.current;
    if (
      prev === "thread_event" &&
      (activeTab === "thread_settings" || activeTab === "events")
    ) {
      setThreadEventFocus(null);
    }
    previousTabRef.current = activeTab;
  }, [activeTab]);

  const tabNavigation = useMemo(
    () => ({
      ...TAB_TO_BACK_BASE,
      thread_event: { forward: null, back: threadEventReturnTab },
    }),
    [threadEventReturnTab],
  );

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
      persistAndApplyTheme(sessionUser.theme_info ?? DEFAULT_THEME);
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
      if (deepLink.openCreatePost) {
        openCreatePost();
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
  }, [openCreatePost]);

  // Poll messages unread count at an interval while user is authenticated.
  useEffect(() => {
    if (!authUser) {
      setMessagesUnreadCount(0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      if (cancelled) {
        return;
      }
      await refreshMessagesUnreadCount();
    };

    void run();
    const intervalId = window.setInterval(() => {
      void run();
    }, 7_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser, refreshMessagesUnreadCount]);

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
  const swipeBackOverrideRef = useRef<(() => void) | null>(null);
  const tabNeighbors = tabNavigation[activeTab] ?? { forward: null, back: null };
  const {
    goToTab,
    getTabStyle,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onTouchCancel,
  } = useTabNavigation({
    activeTab,
    setActiveTab,
    neighbors: tabNeighbors,
    onEdgeBack: () => onBackRef.current(),
    onEdgeForward: () => onForwardRef.current(),
  });

  const onViewUserProfile = useCallback((userId: string) => {
    if (authUser && userId === authUser.user_id) {
      goToTab("profile");
      return;
    }
    setViewingUserId(userId);
    goToTab("other_user_profile");
  }, [authUser, goToTab]);

  const onThreadBack = useCallback(() => {
    if (threadReturnTab === "thread_event" && threadEventFocus) {
      goToTab("thread_event");
      return;
    }
    if (threadReturnTab === "other_user_profile") {
      goToTab("other_user_profile");
      return;
    }
    goToTab("messages", {
      mode: "uncover",
      onSettled: () => {
        setSelectedThread(null);
      },
    });
  }, [goToTab, threadEventFocus, threadReturnTab]);

  // Early return for loading state if session is still being checked.
  if (isCheckingSession) {
    return <CheckingSessionPage />;
  }

  // Early return for signup page if user is not authenticated.
  if (!authUser) { return (<SignUpPage setAuthUser={setAuthUser} />); }

  const { forward, back } = tabNeighbors;

  onBackRef.current = () => {
    if (swipeBackOverrideRef.current) {
      swipeBackOverrideRef.current();
      return;
    }
    // Edge-swipe already dragged the panel; finish without a second animation.
    if (activeTab === "thread") {
      if (threadReturnTab === "thread_event" && threadEventFocus) {
        goToTab("thread_event", { immediate: true });
        return;
      }
      if (threadReturnTab === "other_user_profile") {
        goToTab("other_user_profile", { immediate: true });
        return;
      }
      setSelectedThread(null);
      goToTab("messages", { immediate: true });
      return;
    }
    if (back) {
      goToTab(back, { immediate: true });
    }
  };
  onForwardRef.current = () => {
    if (forward) {
      goToTab(forward, { immediate: true });
    }
  };

  const onOpenUpcomingEvent = (item: UserUpcomingEventListItem) => {
    setSelectedThread({
      ...item.thread,
      event_background_image_id: item.event.background_image_id,
      event_background_image_access_grant: item.event.background_image_access_grant ?? null,
    });
    setThreadEventFocus(item.event);
    setThreadEventReturnTab("events");
    goToTab("thread_event");
  };

  const feedStyle = getTabStyle("feed");
  const messagesStyle = getTabStyle("messages");
  const eventsStyle = getTabStyle("events");
  // Stack screens sit on the section (over nav + into top pad) so underlays never resize.
  const stackFrameStyle = { top: `-${CHROME_TOP_PAD}`, bottom: 0, height: "auto" as const };
  const threadStyle = { ...getTabStyle("thread"), ...stackFrameStyle };
  const threadSettingsStyle = { ...getTabStyle("thread_settings"), ...stackFrameStyle };
  const threadEventStyle = { ...getTabStyle("thread_event"), ...stackFrameStyle };
  const profileStyle = getTabStyle("profile");
  const profileSettingsStyle = getTabStyle("profile_settings");
  const otherUserProfileStyle = getTabStyle("other_user_profile");
  const feedbackStyle = getTabStyle("feedback");

  const createPostModal = (
    <AnimatedModal
      isPresented={isCreatePostPresented}
      isClosing={isCreatePostClosing}
      onClose={closeCreatePost}
      ariaLabel="Create Post"
      hideHeader
      panelClassName="h-[80dvh] max-w-md bg-bg shadow-xl"
    >
      <CreatePostTab
        isActive={isCreatePostActive}
        currentUserId={authUser.user_id}
        username={authUser.username}
        profileImageId={authUser.profile_image_id}
        profileImageUrl={authUser.profile_image_url}
        onCancel={closeCreatePost}
        onPosted={() => {
          setProfileReloadSignal((previous) => previous + 1);
          closeCreatePost();
        }}
      />
    </AnimatedModal>
  );

  return (
    <main
      style={APP_VIEWPORT_STYLE}
      className="flex w-screen justify-center p-0 pt-[2rem]"
    >
      <UserSessionSyncProvider currentUserId={authUser.user_id}>
      <section
        style={MOBILE_FRAME_STYLE}
        className="relative flex h-full max-h-dvh flex-col overflow-hidden shadow-xl shadow-black/25"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchCancel={onTouchCancel}
      >
        <AutoNotificationPrompt authUser={authUser} showNotificationsPrompt={showNotificationsPrompt} setShowNotificationsPrompt={setShowNotificationsPrompt} />

        {/** Primary tabs — layout size stays fixed; stack screens overlay below. */}
        <div className="relative min-h-0 flex-1 overflow-hidden px-0 py-0">
          <div className="absolute h-full w-full" style={messagesStyle}>
            <Messages
              currentUserId={authUser.user_id}
              deepLinkThreadId={pendingDeepLinkThreadId}
              onDeepLinkThreadHandled={onDeepLinkThreadHandled}
              onThreadRead={refreshMessagesUnreadCount}
              selectedThread={selectedThread}
              setSelectedThread={setSelectedThread}
              setActiveTab={(tab) => {
                goToTab(tab);
              }}
              isActiveTab={activeTab === "messages"}
              messagesListRefreshNonce={messagesListRefreshNonce}
              onOpenThreadFromMessages={() => {
                setThreadReturnTab("messages");
              }}
            />
          </div>

          <div className="absolute h-full w-full" style={feedStyle}>
            <Feed
              onViewUserProfile={onViewUserProfile}
              onOpenCreatePost={openCreatePost}
              swipeBackOverrideRef={swipeBackOverrideRef}
            />
          </div>

          <div className="absolute h-full w-full" style={eventsStyle}>
            <UpcomingEventsTab
              currentUserId={authUser.user_id}
              isActive={activeTab === "events"}
              refreshNonce={eventsRefreshNonce}
              onOpenEvent={onOpenUpcomingEvent}
              onEventCreated={onOpenUpcomingEvent}
            />
          </div>

          <div className="absolute h-full w-full" style={feedbackStyle}>
            <Feedback currentUserId={authUser.user_id} isActive={activeTab === "feedback"} />
          </div>

          <div className="absolute h-full w-full" style={profileStyle}>
            <Profile
              userId={authUser.user_id}
              username={authUser.username}
              email={authUser.email}
              profileImageId={authUser.profile_image_id}
              profileImageUrl={authUser.profile_image_url}
              reloadSignal={profileReloadSignal}
              onProfileImageUpdated={onProfileImageUpdated}
              onOpenSettings={() => goToTab("profile_settings")}
              onViewUserProfile={onViewUserProfile}
              onOpenCreatePost={openCreatePost}
              swipeBackOverrideRef={swipeBackOverrideRef}
            />
          </div>

          <div className="absolute h-full w-full" style={profileSettingsStyle}>
            <ProfileSettings
              authUser={authUser}
              onBack={() => goToTab("profile", { mode: "uncover" })}
              onLogout={onLogout}
              swipeBackOverrideRef={swipeBackOverrideRef}
            />
          </div>

          {viewingUserId && <div className="absolute h-full w-full" style={otherUserProfileStyle}>
            <ProfileOtherUser
              isActive={activeTab === "other_user_profile"}
              userId={viewingUserId}
              currentUserId={authUser.user_id}
              onBack={() => goToTab("profile", { mode: "uncover" })}
              swipeBackOverrideRef={swipeBackOverrideRef}
              onViewUserProfile={onViewUserProfile}
              onOpenDirectThread={(thread) => {
                setSelectedThread(thread);
                setThreadReturnTab("other_user_profile");
                setMessagesListRefreshNonce((previous) => previous + 1);
                goToTab("thread");
              }}
            />
          </div>}
        </div>

        {createPostModal}

        <div
          className="nav-rgb-row relative z-[500] flex h-fit w-full justify-between border-t border-border bg-bg"
          style={{
            boxShadow:
              "0 0 20px 10px color-mix(in srgb, var(--black) 60%, transparent)",
          }}
        >
          <NavRowButton
            icon={<NavFeedIcon active={activeTab === "feed"} />}
            active={activeTab === "feed"}
            showCircle={false}
            onClick={() => goToTab("feed")}
          />
          <NavRowButton
            icon={<NavMessagesIcon active={activeTab === "messages"} />}
            active={activeTab === "messages"}
            showCircle={messagesUnreadCount > 0}
            onClick={() => goToTab("messages")}
          />
          <NavRowButton
            icon={<NavEventsIcon active={activeTab === "events"} />}
            active={activeTab === "events"}
            showCircle={false}
            onClick={() => goToTab("events")}
          />
          <NavRowButton
            icon={<NavProfileIcon active={activeTab === "profile"} />}
            active={activeTab === "profile"}
            showCircle={profileIncomingRequestCount > 0}
            onClick={() => goToTab("profile")}
          />
          <NavRowButton
            icon={<NavFeedbackIcon active={activeTab === "feedback"} />}
            active={activeTab === "feedback"}
            showCircle={false}
            onClick={() => goToTab("feedback")}
            className="max-w-[2rem] opacity-30"
          />
        </div>

        {selectedThread && (
          <div className="absolute left-0 right-0" style={threadStyle}>
            <Thread
              key={selectedThread.id}
              selectedThread={selectedThread}
              setSelectedThread={setSelectedThread}
              currentUserId={authUser.user_id}
              currentUsername={authUser.username}
              onBack={onThreadBack}
              setThreadSettingsOpen={() => {
                goToTab("thread_settings");
              }}
            />
          </div>
        )}

        {selectedThread && (
          <div className="absolute left-0 right-0" style={threadSettingsStyle}>
            <ThreadSettings
              thread={selectedThread}
              currentUserId={authUser.user_id}
              onBack={() => goToTab("thread", { mode: "uncover" })}
              onViewUserProfile={onViewUserProfile}
              onThreadImageUpdated={(imageId, imageUrl, imageAccessGrant) => {
                setSelectedThread((previous) => ({
                  ...previous as ThreadItem,
                  image_id: imageId,
                  image_url: imageUrl,
                  image_access_grant: imageAccessGrant,
                }));
              }}
              onThreadRenamed={(name) => {
                setSelectedThread((previous: ThreadItem | null) => ({
                  ...previous as ThreadItem,
                  name,
                }));
              }}
              onThreadDeleted={() => {
                setMessagesListRefreshNonce((previous) => previous + 1);
                setSelectedThread(null);
                setThreadEventFocus(null);
                goToTab("messages", { immediate: true });
              }}
              onThreadPinnedChange={(pinned) => {
                setSelectedThread((previous) =>
                  previous ? { ...previous, user_pinned_thread: pinned } : previous,
                );
                setMessagesListRefreshNonce((previous) => previous + 1);
              }}
            />
          </div>
        )}

        {selectedThread && threadEventFocus ? (
          <div className="absolute left-0 right-0" style={threadEventStyle}>
            <ThreadEventPage
              thread={selectedThread}
              event={threadEventFocus}
              currentUserId={authUser.user_id}
              onBack={() => {
                setThreadEventFocus(null);
                goToTab(threadEventReturnTab, { mode: "uncover" });
              }}
              onOpenThread={() => {
                setSelectedThread((previous) =>
                  previous
                    ? {
                        ...previous,
                        event_background_image_id: threadEventFocus.background_image_id,
                        event_background_image_access_grant:
                          threadEventFocus.background_image_access_grant ?? null,
                      }
                    : previous,
                );
                setThreadReturnTab("thread_event");
                goToTab("thread");
              }}
              onEventUpdated={(next) => {
                setThreadEventFocus(next);
              }}
              onEventDeleted={() => {
                setThreadEventFocus(null);
                setEventsRefreshNonce((previous) => previous + 1);
                goToTab(threadEventReturnTab, { immediate: true });
              }}
            />
          </div>
        ) : null}
      </section>
      </UserSessionSyncProvider>
    </main>
  );
}

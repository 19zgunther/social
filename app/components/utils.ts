import { CSSProperties } from "react";

type Mode = "login" | "signup";
type AppTab =
    | "feed"
    | "groups"
    | "events" // hidden from nav — tab UI commented out in page.tsx
    | "shared_event_posts"
    | "profile"
    | "feedback"
    | "thread"
    | "thread_settings"
    | "thread_event"
    | "profile_settings"
    | "other_user_profile";

const MOBILE_FRAME_STYLE: CSSProperties = {
    width: "100vw",
    maxWidth: "32rem",
};
const APP_VIEWPORT_STYLE: CSSProperties = {
    height: "100dvh",
    minHeight: "100svh",
};

const parseDeepLinkFromLocation = (): {
    tab: AppTab | null;
    threadId: string | null;
    openCreatePost: boolean;
} => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const threadIdParam = params.get("thread_id");
    const openCreatePost = tabParam === "create_post";
    let tab: AppTab | null =
        tabParam === "feed" ||
            tabParam === "groups" ||
            // tabParam === "events" || // events tab hidden
            tabParam === "shared_event_posts" ||
            tabParam === "profile" ||
            tabParam === "feedback"
            ? tabParam
            : null;
    if (openCreatePost) {
        tab = "profile";
    }
    if (!tab && threadIdParam) {
        tab = "groups";
    }

    return {
        tab,
        threadId: threadIdParam?.trim() || null,
        openCreatePost,
    };
};

export {
    MOBILE_FRAME_STYLE,
    APP_VIEWPORT_STYLE,
    parseDeepLinkFromLocation,
    type AppTab,
    type Mode,
}
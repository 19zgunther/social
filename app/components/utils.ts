import { CSSProperties } from "react";

type Mode = "login" | "signup";
type AppTab = "feed" | "groups" | "profile" | "thread" | "thread_settings" | "profile" | "profile_settings" | "other_user_profile";

const MOBILE_FRAME_STYLE: CSSProperties = {
    width: "100vw",
    maxWidth: "32rem",
};
const APP_VIEWPORT_STYLE: CSSProperties = {
    height: "100dvh",
    minHeight: "100svh",
};

const parseDeepLinkFromLocation = (): { tab: AppTab | null; threadId: string | null } => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const threadIdParam = params.get("thread_id");
    let tab: AppTab | null =
        tabParam === "feed" || tabParam === "groups" || tabParam === "profile" ? tabParam : null;
    if (!tab && threadIdParam) {
        tab = "groups";
    }

    return {
        tab,
        threadId: threadIdParam?.trim() || null,
    };
};

export {
    MOBILE_FRAME_STYLE,
    APP_VIEWPORT_STYLE,
    parseDeepLinkFromLocation,
    type AppTab,
    type Mode,
}
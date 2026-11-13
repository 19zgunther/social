"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AppTab } from "@/app/components/utils";
import { parseDeepLinkFromLocation } from "@/app/components/utils";

const DEV_ACTIVE_TAB_STORAGE_KEY = "dev_active_tab_v1";

const RESTORABLE_TABS = new Set<AppTab>([
  "feed",
  "messages",
  "events",
  "profile",
  "feedback",
  "profile_settings",
]);

function isLocalDevHost(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function isRestorableTab(value: string | null): value is AppTab {
  return value !== null && RESTORABLE_TABS.has(value as AppTab);
}

/** Persist/restore the main nav tab across reloads in local Next.js dev only. */
export function useDevActiveTabPersistence(
  activeTab: AppTab,
  setActiveTab: Dispatch<SetStateAction<AppTab>>,
): void {
  const skipNextPersistRef = useRef(false);

  useLayoutEffect(() => {
    if (!isLocalDevHost()) {
      return;
    }
    const deepLink = parseDeepLinkFromLocation();
    if (deepLink.tab) {
      return;
    }
    try {
      const saved = window.localStorage.getItem(DEV_ACTIVE_TAB_STORAGE_KEY);
      // Legacy: messaging tab was previously persisted as "groups".
      const normalized = saved === "groups" ? "messages" : saved;
      if (isRestorableTab(normalized)) {
        skipNextPersistRef.current = true;
        setActiveTab(normalized);
      }
    } catch {
      // Ignore localStorage read failures.
    }
  }, [setActiveTab]);

  useEffect(() => {
    if (!isLocalDevHost()) {
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (!isRestorableTab(activeTab)) {
      return;
    }
    try {
      window.localStorage.setItem(DEV_ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Ignore localStorage write failures.
    }
  }, [activeTab]);
}
